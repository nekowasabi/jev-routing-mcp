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
