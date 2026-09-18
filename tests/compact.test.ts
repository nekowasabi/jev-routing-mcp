import assert from "node:assert/strict";
import { test } from "node:test";
import {
  batchCalls,
  compact,
  compactItems,
  decideCall,
  questionsFor,
  reductionFromDecisions,
} from "../src/compact.ts";
import {
  clipPreview,
  collectCandidates,
  estimateTokens,
  fitState,
  isPinned,
} from "../src/compact-state.ts";
import type { CompactItem } from "../src/types.ts";

const answer = (noul: number) => ({ type: "noul" as const, noul, confidence: 1 });
const item = (
  id: string,
  kind: CompactItem["kind"],
  chars = 100,
  extra: Partial<CompactItem> = {},
): CompactItem => ({ id, kind, chars, ...extra });

test("pinned items and text are handled safely", () => {
  const items = [item("first", "summary", 10), item("text", "text", 20), item("last", "summary", 30)];
  const candidates = collectCandidates(items, 1);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0]!.pinned, true);
  assert.equal(candidates[1]!.pinned, true);
  assert.deepEqual(
    compact(items, { summary_first: answer(0), summary_last: answer(0) }).decisions.map((d) => d.action),
    ["keep", "keep"],
  );
});

test("text items are never candidates", () => {
  assert.deepEqual(collectCandidates([item("t1", "text"), item("t2", "text")], 0), []);
});

test("tool pair has keep, truncate, and drop branches", () => {
  const candidate = collectCandidates(
    [
      item("head", "text"),
      item("c", "tool_call", 10, { pairId: "p", tool: "x" }),
      item("r", "tool_result", 500, { pairId: "p" }),
    ],
    0,
  )[0]!;
  assert.deepEqual(
    decideCall(candidate, { call_c: answer(0), result_r: answer(1) }).map((d) => d.action),
    ["keep", "keep"],
  );
  assert.deepEqual(
    decideCall(candidate, { call_c: answer(1), result_r: answer(0) }).map((d) => d.action),
    ["keep", "truncate"],
  );
  assert.deepEqual(
    decideCall(candidate, { call_c: answer(0), result_r: answer(0) }).map((d) => d.action),
    ["drop", "drop"],
  );
});

test("summary drops and unpaired result truncates", () => {
  const summary = collectCandidates([item("head", "text"), item("s", "summary", 80)], 0)[0]!;
  const result = collectCandidates([item("head", "text"), item("r", "tool_result", 500)], 0)[0]!;
  assert.equal(decideCall(summary, { summary_s: answer(0) })[0]!.action, "drop");
  assert.equal(decideCall(result, { result_r: answer(0) })[0]!.action, "truncate");
});

test("a tool_call without its result is not a candidate", () => {
  const items = [item("head", "text"), item("c", "tool_call", 40, { pairId: "p", tool: "shell" })];
  assert.deepEqual(collectCandidates(items, 0), []);
});

test("statistics use arithmetic over all items", () => {
  const items = [item("a", "summary", 100), item("b", "tool_result", 500)];
  const stats = reductionFromDecisions(
    items,
    [
      { id: "a", action: "drop", pinned: false },
      { id: "b", action: "truncate", pinned: false },
    ],
    300,
  );
  assert.equal(stats.charsBefore, 600);
  assert.equal(stats.charsAfter, 300);
  assert.equal(stats.charsDropped, 300);
  assert.equal(stats.kept, 0);
  assert.equal(stats.truncated, 1);
  assert.equal(stats.dropped, 1);
  assert.equal(stats.pinned, 0);
  assert.equal(stats.items, 2);
});

test("questions use exact short instructions without criteria", () => {
  const pair = collectCandidates(
    [
      item("c", "tool_call", 1, { pairId: "p", tool: "shell" }),
      item("r", "tool_result", 12, { pairId: "p" }),
    ],
    0,
  )[0]!;
  assert.deepEqual(questionsFor(pair), {
    call_c: { type: "noul", instructions: "Keep call c (shell)." },
    result_r: { type: "noul", instructions: "Keep result r (12ch) verbatim." },
  });
  assert.equal("criteria" in questionsFor(pair).call_c!, false);

  const summary = collectCandidates([item("head", "text"), item("s", "summary", 9)], 0)[0]!;
  assert.deepEqual(questionsFor(summary), {
    summary_s: { type: "noul", instructions: "Keep summary s." },
  });
});

test("utility boundaries match the compact state contract", () => {
  assert.equal(clipPreview("x".repeat(201)).length, 200);
  assert.equal(clipPreview("x".repeat(200)).length, 200);
  assert.equal(isPinned(0, 10, 2), true);
  assert.equal(isPinned(7, 10, 2), false);
  assert.equal(isPinned(8, 10, 2), true);
  assert.equal(estimateTokens("abcdef"), 1);
  assert.equal(estimateTokens("1234"), 2);
  assert.equal(estimateTokens("!"), 1);
});

const noul = (value: number) => ({ type: "noul" as const, noul: value, confidence: 1 });

test("compactItems applies pair truncate and drop from fake decide", async () => {
  const items = [
    item("head", "text", 5, { preview: "goal" }),
    item("c", "tool_call", 10, { pairId: "p", tool: "Read", preview: "src/a.ts" }),
    item("r", "tool_result", 500, { pairId: "p", preview: "ok" }),
  ];
  const truncate = await compactItems({ items, preserveRecentMessages: 0 }, async (req) => ({
    model: "fake",
    answers: Object.fromEntries(
      Object.keys(req.questions).map((id) => [id, noul(id.startsWith("call_") ? 0.9 : 0.1)]),
    ),
    latencyMs: 0,
  }));
  assert.deepEqual(
    truncate.decisions.filter((d) => d.id === "c" || d.id === "r").map((d) => d.action),
    ["keep", "truncate"],
  );
  assert.equal("answers" in truncate, false);

  const dropped = await compactItems({ items, preserveRecentMessages: 0 }, async (req) => ({
    model: "fake",
    answers: Object.fromEntries(Object.keys(req.questions).map((id) => [id, noul(0.1)])),
    latencyMs: 0,
  }));
  assert.deepEqual(
    dropped.decisions.filter((d) => d.id === "c" || d.id === "r").map((d) => d.action),
    ["drop", "drop"],
  );
});

test("compactItems batches questions when the request budget is tight", async () => {
  const items = Array.from({ length: 8 }, (_, i) => item(`s${i}`, "summary", 20, { preview: `p${i}` }));
  const candidates = collectCandidates(items, 0).filter((c) => !c.pinned);
  const fitted = fitState(items, collectCandidates(items, 0), {
    maxStateTokens: 25_000,
    preserveRecentMessages: 0,
    goal: "g",
  });
  const one = estimateTokens(JSON.stringify(questionsFor(candidates[0]!)));
  let calls = 0;
  await compactItems(
    {
      items,
      goal: "g",
      preserveRecentMessages: 0,
      maxRequestTokens: fitted.tokens + 20 + one + 1,
    },
    async (req) => {
      calls += 1;
      return {
        model: "fake",
        answers: Object.fromEntries(Object.keys(req.questions).map((id) => [id, noul(0.9)])),
        latencyMs: 0,
      };
    },
  );
  assert.ok(calls >= 2);
  assert.equal(
    batchCalls(candidates, fitted.tokens, { maxRequestTokens: fitted.tokens + 20 + one + 1 }).length,
    calls,
  );
});

test("compactItems fail-opens when history cannot be fitted", async () => {
  const items = Array.from({ length: 12 }, (_, i) =>
    item(`s${i}`, "summary", 4000, { preview: "x".repeat(200) }),
  );
  let calls = 0;
  const result = await compactItems(
    { items, preserveRecentMessages: 0, maxStateTokens: 1 },
    async () => {
      calls += 1;
      return { model: "fake", answers: {}, latencyMs: 0 };
    },
  );
  assert.equal(calls, 0);
  assert.equal(result.stats.stateStage, "unfitted");
  assert.ok(result.decisions.every((d) => d.action === "keep"));
});
