import { collectCandidates, estimateTokens, fitState, goalFromItems, type CompactCandidate } from "./compact-state.ts";
import type {
  Answer,
  CompactDecision,
  CompactItem,
  CompactResult,
  CompactStats,
  NoulQuestion,
  SystemOneRequest,
  SystemOneResponse,
} from "./types.ts";

export const DEFAULT_COMPACT_OPTIONS = {
  keepThreshold: 0.5,
  preserveRecentMessages: 6,
  truncateHeadChars: 300,
  maxStateTokens: 25_000,
  maxRequestTokens: 30_000,
} as const;

export type CompactOptions = {
  goal?: string;
  keepThreshold?: number;
  preserveRecentMessages?: number;
  truncateHeadChars?: number;
  maxStateTokens?: number;
  maxRequestTokens?: number;
};

export type CompactDecider = (req: SystemOneRequest) => Promise<SystemOneResponse> | SystemOneResponse;

const REQUEST_OVERHEAD_TOKENS = 20;

function finite(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function resolveOptions(options: CompactOptions = {}) {
  return {
    goal: options.goal ?? "",
    keepThreshold: finite(options.keepThreshold, DEFAULT_COMPACT_OPTIONS.keepThreshold),
    preserveRecentMessages: Math.max(
      0,
      Math.floor(finite(options.preserveRecentMessages, DEFAULT_COMPACT_OPTIONS.preserveRecentMessages)),
    ),
    truncateHeadChars: Math.max(
      0,
      Math.floor(finite(options.truncateHeadChars, DEFAULT_COMPACT_OPTIONS.truncateHeadChars)),
    ),
    maxStateTokens: Math.max(1, finite(options.maxStateTokens, DEFAULT_COMPACT_OPTIONS.maxStateTokens)),
    maxRequestTokens: Math.max(1, finite(options.maxRequestTokens, DEFAULT_COMPACT_OPTIONS.maxRequestTokens)),
  };
}

function answerFor(answers: Record<string, Answer>, id: string): number {
  const answer = answers[id];
  return answer?.type === "noul" ? answer.noul : 0;
}

export function questionsFor(candidate: CompactCandidate): Record<string, NoulQuestion> {
  const questions: Record<string, NoulQuestion> = {};
  for (const item of candidate.items) {
    if (item.kind === "tool_call") {
      questions[`call_${item.id}`] = {
        type: "noul",
        instructions: `Keep call ${item.id} (${item.tool ?? ""}).`,
      };
    } else if (item.kind === "summary") {
      questions[`summary_${item.id}`] = {
        type: "noul",
        instructions: `Keep summary ${item.id}.`,
      };
    } else {
      questions[`result_${item.id}`] = {
        type: "noul",
        instructions: `Keep result ${item.id} (${item.chars}ch) verbatim.`,
      };
    }
  }
  return questions;
}

export function decideCall(
  candidate: CompactCandidate,
  answers: Record<string, Answer>,
  keepThreshold = DEFAULT_COMPACT_OPTIONS.keepThreshold,
): CompactDecision[] {
  if (candidate.pinned) {
    return candidate.items.map((item) => ({ id: item.id, action: "keep", pinned: true }));
  }
  if (candidate.items.length === 2) {
    const call = candidate.items.find((item) => item.kind === "tool_call")!;
    const result = candidate.items.find((item) => item.kind === "tool_result")!;
    const keepResult = answerFor(answers, `result_${result.id}`) >= keepThreshold;
    const keepCall = answerFor(answers, `call_${call.id}`) >= keepThreshold;
    if (keepResult) {
      return [
        { id: call.id, action: "keep", pinned: false },
        { id: result.id, action: "keep", pinned: false },
      ];
    }
    if (keepCall) {
      return [
        { id: call.id, action: "keep", pinned: false },
        { id: result.id, action: "truncate", pinned: false },
      ];
    }
    return [
      { id: call.id, action: "drop", pinned: false },
      { id: result.id, action: "drop", pinned: false },
    ];
  }
  const item = candidate.items[0]!;
  if (item.kind === "summary") {
    const keep = answerFor(answers, `summary_${item.id}`) >= keepThreshold;
    return [{ id: item.id, action: keep ? "keep" : "drop", pinned: false }];
  }
  const keep = answerFor(answers, `result_${item.id}`) >= keepThreshold;
  return [{ id: item.id, action: keep ? "keep" : "truncate", pinned: false }];
}

export function charsAfter(
  item: CompactItem,
  action: CompactDecision["action"],
  truncateHeadChars: number,
): number {
  return action === "keep" ? item.chars : action === "drop" ? 0 : Math.min(item.chars, truncateHeadChars);
}

export function reductionFromDecisions(
  items: CompactItem[],
  decisions: CompactDecision[],
  truncateHeadChars = DEFAULT_COMPACT_OPTIONS.truncateHeadChars,
): CompactStats {
  const byId = new Map(decisions.map((decision) => [decision.id, decision]));
  const stats: CompactStats = {
    charsBefore: 0,
    charsAfter: 0,
    charsDropped: 0,
    kept: 0,
    truncated: 0,
    dropped: 0,
    pinned: 0,
    items: items.length,
    stateTokens: 0,
    stateStage: "",
    requests: 0,
  };
  for (const item of items) {
    const decision = byId.get(item.id) ?? { id: item.id, action: "keep" as const, pinned: false };
    stats.charsBefore += item.chars;
    stats.charsAfter += charsAfter(item, decision.action, truncateHeadChars);
    if (decision.action === "keep") stats.kept += 1;
    else if (decision.action === "truncate") stats.truncated += 1;
    else stats.dropped += 1;
    if (decision.pinned) stats.pinned += 1;
  }
  stats.charsDropped = stats.charsBefore - stats.charsAfter;
  return stats;
}

export function batchCalls(
  calls: readonly CompactCandidate[],
  stateTokens: number,
  options: { maxRequestTokens: number },
): CompactCandidate[][] {
  const budget = options.maxRequestTokens - stateTokens - REQUEST_OVERHEAD_TOKENS;
  const batches: CompactCandidate[][] = [];
  let current: CompactCandidate[] = [];
  let currentTokens = 0;
  for (const call of calls) {
    const tokens = estimateTokens(JSON.stringify(questionsFor(call)));
    if (current.length > 0 && currentTokens + tokens > budget) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    if (current.length === 0 && tokens > budget) {
      throw new Error(
        `state leaves no room for questions (~${stateTokens} of ${options.maxRequestTokens} tokens)`,
      );
    }
    current.push(call);
    currentTokens += tokens;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function keepAll(items: CompactItem[], candidates: CompactCandidate[]): CompactDecision[] {
  const pinnedIds = new Set(
    candidates.filter((candidate) => candidate.pinned).flatMap((candidate) => candidate.items.map((item) => item.id)),
  );
  return items.map((item) => ({ id: item.id, action: "keep" as const, pinned: pinnedIds.has(item.id) }));
}

export function compact(
  items: CompactItem[],
  answers: Record<string, Answer>,
  options = DEFAULT_COMPACT_OPTIONS,
): CompactResult {
  const candidates = collectCandidates(items, options.preserveRecentMessages);
  const decisions = candidates.flatMap((candidate) => decideCall(candidate, answers, options.keepThreshold));
  return {
    decisions,
    stats: reductionFromDecisions(items, decisions, options.truncateHeadChars),
  };
}

export async function compactItems(
  input: { items: CompactItem[] } & CompactOptions,
  decide: CompactDecider,
): Promise<CompactResult> {
  const resolved = resolveOptions(input);
  const items = input.items;
  const candidates = collectCandidates(items, resolved.preserveRecentMessages);
  const scored = candidates.filter((candidate) => !candidate.pinned);
  const goal = resolved.goal || goalFromItems(items);

  let stateTokens = 0;
  let stateStage = "";
  let requests = 0;
  const answers: Record<string, Answer> = {};

  if (scored.length > 0) {
    try {
      const fitted = fitState(items, candidates, {
        maxStateTokens: resolved.maxStateTokens,
        preserveRecentMessages: resolved.preserveRecentMessages,
        goal,
      });
      stateTokens = fitted.tokens;
      stateStage = fitted.stage;
      const batches = batchCalls(scored, fitted.tokens, resolved);
      const settled = await Promise.all(
        batches.map(async (batch) => {
          const questions = Object.assign({}, ...batch.map(questionsFor)) as SystemOneRequest["questions"];
          return decide({ state: fitted.state, questions });
        }),
      );
      requests = settled.length;
      for (const res of settled) Object.assign(answers, res.answers);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const decisions = keepAll(items, candidates);
      const stats = reductionFromDecisions(items, decisions, resolved.truncateHeadChars);
      stats.stateStage = /too large|no room/i.test(message) ? "unfitted" : "error";
      stats.stateTokens = stateTokens;
      stats.requests = 0;
      return { decisions, stats };
    }
  }

  const decisions = candidates.flatMap((candidate) => decideCall(candidate, answers, resolved.keepThreshold));
  const stats = reductionFromDecisions(items, decisions, resolved.truncateHeadChars);
  stats.stateTokens = stateTokens;
  stats.stateStage = stateStage;
  stats.requests = requests;
  return { decisions, stats };
}
