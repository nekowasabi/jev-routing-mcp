import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { handleMcpRpc } from "../src/handle-mcp.ts";
import { costFor, FRONTIER_USD, JEV_USD } from "../src/policy.ts";

test("grok model routing is zero", () => {
  const grok = costFor("sol", 1, "grok");
  assert.equal(grok.buckets.modelRoutingUsd, 0);
  assert.equal(grok.routedUsd, FRONTIER_USD + JEV_USD);
});

test("claude sol records model routing", () => {
  const claude = costFor("sol", 1, "claude");
  assert.equal(claude.buckets.modelRoutingUsd, FRONTIER_USD - 0.028);
  assert.ok(claude.buckets.modelRoutingUsd > 0);
});

test("route_turn compact omits answers and writes jsonl", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-metrics-"));
  const path = join(dir, "metrics.jsonl");
  process.env.JEV_ROUTING_METRICS_PATH = path;

  const rpc = await handleMcpRpc(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "route_turn",
        arguments: {
          request: "Rename User to user in src/auth.ts",
          engine: "local",
          harness: "grok",
        },
      },
    },
    { harness: "grok" },
  );

  assert.ok(rpc);
  const result = (rpc as { result: { content: { text: string }[] } }).result;
  const banner = result.content[0]?.text ?? "";
  const text = result.content[1]?.text ?? "";
  assert.match(banner, /^\[JEV EXECUTED\]/);
  assert.equal(text.includes("\n  "), false);
  const payload = JSON.parse(text) as {
    answers?: unknown;
    tools?: { name: string; load: boolean; primary: boolean; noul?: number }[];
    cost?: { buckets?: { modelRoutingUsd?: number } };
    loop?: unknown;
  };
  assert.equal(payload.answers, undefined);
  assert.ok(payload.loop);
  assert.ok(payload.tools?.every((t) => t.noul === undefined));
  assert.equal(payload.cost?.buckets?.modelRoutingUsd, 0);

  const lines = readFileSync(path, "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  const ev = JSON.parse(lines[0]) as {
    buckets: { modelRoutingUsd: number; mcpOverheadTokens: number };
    mcpResponseBytes: number;
    mcpUncompactedBytes: number;
    harness: string;
  };
  assert.equal(ev.harness, "grok");
  assert.equal(ev.buckets.modelRoutingUsd, 0);
  assert.ok(ev.mcpUncompactedBytes > ev.mcpResponseBytes);
  assert.ok(ev.buckets.mcpOverheadTokens > 0);
});

test("compact lists, omits answers, and writes compaction metrics", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-metrics-"));
  const path = join(dir, "metrics.jsonl");
  process.env.JEV_ROUTING_METRICS_PATH = path;

  const listed = await handleMcpRpc(
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    { harness: "grok" },
  );
  const names = (
    listed as { result: { tools: { name: string }[] } }
  ).result.tools.map((t) => t.name);
  assert.ok(names.includes("compact"));

  const preview = "p".repeat(250);
  const rpc = await handleMcpRpc(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "compact",
        arguments: {
          engine: "local",
          items: [
            { id: "s", kind: "summary", chars: 100, preview },
            { id: "c", kind: "tool_call", chars: 10, pairId: "p", tool: "Read", preview: "a.ts" },
            { id: "r", kind: "tool_result", chars: 500, pairId: "p", preview },
          ],
        },
      },
    },
    { harness: "grok" },
  );

  assert.ok(rpc);
  const result = (rpc as { result: { content: { text: string }[] } }).result;
  const text = result.content[1]?.text ?? "";
  assert.equal(text.includes(preview), false);
  const payload = JSON.parse(text) as {
    answers?: unknown;
    decisions?: { id: string; action: string }[];
    stats?: { charsDropped?: number; charsBefore?: number; charsAfter?: number };
  };
  assert.equal(payload.answers, undefined);
  assert.ok(Array.isArray(payload.decisions));
  assert.ok(payload.stats);
  const expectedDropped =
    (payload.stats.charsBefore ?? 0) - (payload.stats.charsAfter ?? 0);
  assert.equal(payload.stats.charsDropped, expectedDropped);

  const lines = readFileSync(path, "utf8").trim().split("\n");
  const ev = JSON.parse(lines[lines.length - 1]!) as {
    tool: string;
    compaction?: { netTokensEst: number; charsDropped: number };
  };
  assert.equal(ev.tool, "compact");
  assert.equal(typeof ev.compaction?.netTokensEst, "number");
  assert.equal(ev.compaction?.charsDropped, payload.stats.charsDropped);
});
