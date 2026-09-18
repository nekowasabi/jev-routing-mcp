import type { Answer, CompactDecision, CompactItem, CompactResult, NoulQuestion } from "./types.ts";
import { collectCandidates, type CompactCandidate } from "./compact-state.ts";

export const DEFAULT_COMPACT_OPTIONS = {
  keepThreshold: 0.5,
  preserveRecentMessages: 6,
  truncateHeadChars: 300,
  maxStateTokens: 25_000,
  maxRequestTokens: 30_000,
} as const;

function answerFor(answers: Record<string, Answer>, id: string): number {
  const answer = answers[id];
  return answer?.type === "noul" ? answer.noul : 0;
}

export function questionsFor(candidate: CompactCandidate): Record<string, NoulQuestion> {
  const questions: Record<string, NoulQuestion> = {};
  for (const item of candidate.items) {
    const id = item.kind === "tool_call" ? `call_${item.id}` : `result_${item.id}`;
    const instructions = item.kind === "tool_call"
      ? `Keep call ${item.id} (${item.tool ?? ""}).`
      : item.kind === "summary"
        ? `Keep summary ${item.id}.`
        : `Keep result ${item.id} (${item.chars}ch) verbatim.`;
    questions[id] = { type: "noul", instructions };
  }
  return questions;
}

export function decideCall(
  candidate: CompactCandidate,
  answers: Record<string, Answer>,
  keepThreshold = DEFAULT_COMPACT_OPTIONS.keepThreshold,
): CompactDecision[] {
  if (candidate.pinned) return candidate.items.map((item) => ({ id: item.id, action: "keep", pinned: true }));
  if (candidate.items.length === 2) {
    const call = candidate.items.find((item) => item.kind === "tool_call")!;
    const result = candidate.items.find((item) => item.kind === "tool_result")!;
    const keepResult = answerFor(answers, `result_${result.id}`) >= keepThreshold;
    const keepCall = answerFor(answers, `call_${call.id}`) >= keepThreshold;
    if (keepResult) return [{ id: call.id, action: "keep", pinned: false }, { id: result.id, action: "keep", pinned: false }];
    if (keepCall) return [{ id: call.id, action: "keep", pinned: false }, { id: result.id, action: "truncate", pinned: false }];
    return [{ id: call.id, action: "drop", pinned: false }, { id: result.id, action: "drop", pinned: false }];
  }
  const item = candidate.items[0];
  const keep = answerFor(answers, item.kind === "summary" ? `summary_${item.id}` : `result_${item.id}`) >= keepThreshold;
  return [{ id: item.id, action: item.kind === "summary" ? (keep ? "keep" : "drop") : (keep || item.kind === "tool_call" ? "keep" : "truncate"), pinned: false }];
}

export function charsAfter(item: CompactItem, action: CompactDecision["action"], truncateHeadChars: number): number {
  return action === "keep" ? item.chars : action === "drop" ? 0 : Math.min(item.chars, truncateHeadChars);
}

export function reductionFromDecisions(items: CompactItem[], decisions: CompactDecision[], truncateHeadChars = DEFAULT_COMPACT_OPTIONS.truncateHeadChars) {
  const byId = new Map(decisions.map((decision) => [decision.id, decision]));
  const stats = { charsBefore: 0, charsAfter: 0, charsDropped: 0, kept: 0, truncated: 0, dropped: 0, pinned: 0 };
  for (const item of items) {
    const decision = byId.get(item.id) ?? { id: item.id, action: "keep" as const, pinned: false };
    stats.charsBefore += item.chars;
    stats.charsAfter += charsAfter(item, decision.action, truncateHeadChars);
    stats[decision.action === "keep" ? "kept" : decision.action === "truncate" ? "truncated" : "dropped"]++;
    if (decision.pinned) stats.pinned++;
  }
  stats.charsDropped = stats.charsBefore - stats.charsAfter;
  return stats;
}

export function compact(items: CompactItem[], answers: Record<string, Answer>, options = DEFAULT_COMPACT_OPTIONS): CompactResult {
  const candidates = collectCandidates(items, options.preserveRecentMessages);
  const decisions = candidates.flatMap((candidate) => decideCall(candidate, answers, options.keepThreshold));
  return { decisions, stats: reductionFromDecisions(items, decisions, options.truncateHeadChars), questions: Object.assign({}, ...candidates.map(questionsFor)) };
}
