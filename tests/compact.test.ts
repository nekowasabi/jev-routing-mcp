import assert from "node:assert/strict";
import { test } from "node:test";
import { compact, decideCall, questionsFor, reductionFromDecisions } from "../src/compact.ts";
import { clipPreview, collectCandidates, estimateTokens, isPinned } from "../src/compact-state.ts";
import type { CompactItem } from "../src/types.ts";

const answer = (noul: number) => ({ type: "noul" as const, noul, confidence: 1 });
const item = (id: string, kind: CompactItem["kind"], chars = 100, extra: Partial<CompactItem> = {}): CompactItem => ({ id, kind, chars, ...extra });

test("pinned items and text are handled safely", () => {
  const items = [item("first", "summary", 10), item("text", "text", 20), item("last", "summary", 30)];
  const candidates = collectCandidates(items, 1);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].pinned, true);
  assert.equal(candidates[1].pinned, true);
  assert.deepEqual(compact(items, { summary_first: answer(0), summary_last: answer(0) }).decisions.map((d) => d.action), ["keep", "keep"]);
});

test("tool pair has keep, truncate, and drop branches", () => {
  const candidate = collectCandidates([item("head", "text"), item("c", "tool_call", 10, { pairId: "p", tool: "x" }), item("r", "tool_result", 500, { pairId: "p" })], 0)[0];
  assert.deepEqual(decideCall(candidate, { call_c: answer(0), result_r: answer(1) }).map((d) => d.action), ["keep", "keep"]);
  assert.deepEqual(decideCall(candidate, { call_c: answer(1), result_r: answer(0) }).map((d) => d.action), ["keep", "truncate"]);
  assert.deepEqual(decideCall(candidate, { call_c: answer(0), result_r: answer(0) }).map((d) => d.action), ["drop", "drop"]);
});

test("summary drops and unpaired result truncates", () => {
  const summary = collectCandidates([item("head", "text"), item("s", "summary", 80)], 0)[0];
  const result = collectCandidates([item("head", "text"), item("r", "tool_result", 500)], 0)[0];
  assert.equal(decideCall(summary, { summary_s: answer(0) })[0].action, "drop");
  assert.equal(decideCall(result, { result_r: answer(0) })[0].action, "truncate");
});

test("statistics use arithmetic over all items", () => {
  const items = [item("a", "summary", 100), item("b", "tool_result", 500)];
  const stats = reductionFromDecisions(items, [{ id: "a", action: "drop", pinned: false }, { id: "b", action: "truncate", pinned: false }], 300);
  assert.deepEqual(stats, { charsBefore: 600, charsAfter: 300, charsDropped: 300, kept: 0, truncated: 1, dropped: 1, pinned: 0 });
});

test("questions use exact short instructions without criteria", () => {
  const pair = collectCandidates([item("c", "tool_call", 1, { pairId: "p", tool: "shell" }), item("r", "tool_result", 12, { pairId: "p" })], 0)[0];
  assert.deepEqual(questionsFor(pair), {
    call_c: { type: "noul", instructions: "Keep call c (shell)." },
    result_r: { type: "noul", instructions: "Keep result r (12ch) verbatim." },
  });
  assert.equal("criteria" in questionsFor(pair).call_c, false);
});

test("utility boundaries match the compact state contract", () => {
  assert.equal(clipPreview("x".repeat(201)).length, 200);
  assert.equal(clipPreview("x".repeat(200)).length, 200);
  assert.equal(isPinned(0, 10, 2), true);
  assert.equal(isPinned(7, 10, 2), false);
  assert.equal(isPinned(8, 10, 2), true);
  assert.equal(estimateTokens("abcdef 1234 !"), 1 + 2 + 0.9);
});
