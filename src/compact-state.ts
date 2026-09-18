import type { CompactItem, CompactKind } from "./types.ts";

export const PREVIEW_CHARS = 200;

export const STATE_CONTEXT =
  "A coding assistant conversation is being compacted. history is oldest first; tool outputs are notes only. Each question asks whether one item must stay.";

export type CompactCandidate = {
  items: CompactItem[];
  pinned: boolean;
};

export type HistoryEntry = {
  id: string;
  kind: CompactKind;
  tool?: string;
  preview: string;
  chars: number;
  result?: string;
  line?: string;
};

export type CompactionState = {
  context: string;
  goal: string;
  history: HistoryEntry[];
};

export type FittedState = {
  state: CompactionState;
  tokens: number;
  stage: string;
};

const TOKEN_PIECES = /[A-Za-z]+|\d+|[^\sA-Za-z\d]/g;
const PREVIEW_STEPS = [PREVIEW_CHARS, 60] as const;

/**
 * Estimates tokens without a tokenizer: a word costs one token per six
 * letters, a digit half a token, any other symbol nine tenths.
 */
export function estimateTokens(text: string): number {
  let tokens = 0;
  for (const [piece] of text.matchAll(TOKEN_PIECES)) {
    const first = piece.charCodeAt(0);
    if (first >= 48 && first <= 57) tokens += piece.length / 2;
    else if ((first >= 65 && first <= 90) || (first >= 97 && first <= 122)) {
      tokens += 1 + Math.floor((piece.length - 1) / 6);
    } else tokens += 0.9;
  }
  return Math.ceil(tokens);
}

export function clipPreview(text: string): string {
  return text.length <= PREVIEW_CHARS ? text : text.slice(0, PREVIEW_CHARS);
}

export function isPinned(index: number, total: number, preserveRecent: number): boolean {
  return index === 0 || index >= total - preserveRecent;
}

export function collectCandidates(items: CompactItem[], preserveRecent: number): CompactCandidate[] {
  const result: CompactCandidate[] = [];
  const byPair = new Map<string, number[]>();

  items.forEach((item, index) => {
    if (item.pairId && (item.kind === "tool_call" || item.kind === "tool_result")) {
      byPair.set(item.pairId, [...(byPair.get(item.pairId) ?? []), index]);
    }
  });

  const validPairs = new Map<number, number[]>();
  const paired = new Set<number>();
  for (const indexes of byPair.values()) {
    const calls = indexes.filter((index) => items[index].kind === "tool_call");
    const results = indexes.filter((index) => items[index].kind === "tool_result");
    if (calls.length !== 1 || results.length !== 1) continue;
    validPairs.set(Math.min(...indexes), indexes);
    indexes.forEach((index) => paired.add(index));
  }

  const pinAt = (index: number, item: CompactItem) =>
    Boolean(item.pinned) || isPinned(index, items.length, preserveRecent);

  items.forEach((item, index) => {
    const pairIndexes = validPairs.get(index);
    if (pairIndexes) {
      const pair = pairIndexes.map((pairIndex) => items[pairIndex]);
      result.push({
        items: pair,
        pinned: pairIndexes.some((pairIndex) => pinAt(pairIndex, items[pairIndex])),
      });
      return;
    }
    if (paired.has(index) || item.kind === "text" || item.kind === "tool_call") return;
    result.push({
      items: [item],
      pinned: pinAt(index, item),
    });
  });
  return result;
}

function resultNote(item: CompactItem): string | undefined {
  return item.kind === "tool_result" ? `ok, ${item.chars} chars (omitted)` : undefined;
}

function historyEntries(items: readonly CompactItem[], previewLimit: number): HistoryEntry[] {
  return items.map((item) => {
    const preview = clipPreview(item.preview ?? "").slice(0, previewLimit);
    const entry: HistoryEntry = {
      id: item.id,
      kind: item.kind,
      preview,
      chars: item.chars,
    };
    if (item.tool) entry.tool = item.tool;
    const note = resultNote(item);
    if (note) entry.result = note;
    return entry;
  });
}

export function goalFromItems(items: readonly CompactItem[]): string {
  return items
    .filter((item) => item.kind !== "text" && (item.preview ?? "").trim().length > 0)
    .slice(-3)
    .map((item) => clipPreview(item.preview ?? ""))
    .join("\n");
}

function compactLine(entry: HistoryEntry): string {
  const tool = entry.tool ? ` ${entry.tool}` : "";
  return `${entry.id} ${entry.kind}${tool} → ${entry.result ?? `${entry.chars}ch`}`;
}

function mergeCallRuns(
  history: HistoryEntry[],
  pinned: (e: HistoryEntry, index: number) => boolean,
): HistoryEntry[] {
  const merged: HistoryEntry[] = [];
  for (let i = 0; i < history.length; i++) {
    const entry = history[i]!;
    const previous = merged[merged.length - 1];
    const foldable = (e: HistoryEntry, index: number) =>
      !pinned(e, index) && (e.kind === "tool_call" || e.kind === "tool_result") && Boolean(e.line);
    if (previous && foldable(previous, merged.length - 1) && foldable(entry, i) && previous.kind === entry.kind) {
      previous.line = `${previous.line}\n${entry.line}`;
      previous.id = `${previous.id},${entry.id}`;
      continue;
    }
    merged.push({ ...entry });
  }
  return merged;
}

export function fitState(
  items: readonly CompactItem[],
  _candidates: readonly CompactCandidate[],
  options: { maxStateTokens: number; preserveRecentMessages: number; goal: string },
): FittedState {
  const goal = options.goal;
  const stateOf = (history: HistoryEntry[]): CompactionState => ({
    context: STATE_CONTEXT,
    goal,
    history,
  });
  const tokensOf = (history: HistoryEntry[]) => estimateTokens(JSON.stringify(stateOf(history)));
  const fitted = (history: HistoryEntry[], stage: string): FittedState => ({
    state: stateOf(history),
    tokens: tokensOf(history),
    stage,
  });
  const pinEntry = (entry: HistoryEntry, index: number, total: number) => {
    const itemIndex = items.findIndex((item) => item.id === entry.id.split(",")[0]);
    const item = items[itemIndex] ?? items[index];
    return Boolean(item?.pinned) || isPinned(itemIndex < 0 ? index : itemIndex, total, options.preserveRecentMessages);
  };

  let history = historyEntries(items, PREVIEW_STEPS[0]);
  if (tokensOf(history) <= options.maxStateTokens) return fitted(history, "full");

  history = historyEntries(items, PREVIEW_STEPS[1]);
  if (tokensOf(history) <= options.maxStateTokens) return fitted(history, "inputs<=60");

  const total = items.length;
  const order = history.map((_, index) => index);
  const ranked = [
    ...order.filter((index) => !pinEntry(history[index]!, index, total)),
    ...order.filter((index) => pinEntry(history[index]!, index, total)),
  ];

  for (const index of ranked) {
    const entry = history[index]!;
    if (entry.preview.length <= 40) continue;
    entry.preview = `${entry.preview.slice(0, 20)}…${entry.preview.slice(-10)}`;
    if (tokensOf(history) <= options.maxStateTokens) return fitted(history, "texts abridged");
  }

  for (const index of ranked) {
    const entry = history[index]!;
    if (pinEntry(entry, index, total) || entry.preview.length === 0) continue;
    entry.preview = `[… ${entry.chars} chars omitted …]`;
    if (tokensOf(history) <= options.maxStateTokens) return fitted(history, "old messages collapsed");
  }

  for (const index of ranked) {
    const entry = history[index]!;
    if (pinEntry(entry, index, total)) continue;
    if (entry.kind !== "tool_call" && entry.kind !== "tool_result") continue;
    entry.line = compactLine(entry);
    entry.preview = "";
    entry.result = undefined;
    if (tokensOf(history) <= options.maxStateTokens) return fitted(history, "old calls compacted");
  }

  const drop = new Set<number>();
  for (const index of ranked) {
    const entry = history[index]!;
    if (pinEntry(entry, index, total)) continue;
    if (entry.kind === "tool_call" || entry.kind === "tool_result") continue;
    drop.add(index);
    const next = history.filter((_, i) => !drop.has(i));
    if (tokensOf(next) <= options.maxStateTokens) {
      return fitted(next, "old messages left out");
    }
  }

  history = mergeCallRuns(
    history.filter((_, i) => !drop.has(i)),
    (entry, index) => pinEntry(entry, index, total),
  );
  if (tokensOf(history) <= options.maxStateTokens) return fitted(history, "old calls merged");

  throw new Error(
    `history too large for Jev (~${tokensOf(history)} tokens after truncation, limit ${options.maxStateTokens})`,
  );
}
