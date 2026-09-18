import type { CompactItem } from "./types.ts";

export const PREVIEW_CHARS = 200;

export type CompactCandidate = {
  items: CompactItem[];
  pinned: boolean;
};

export function estimateTokens(text: string): number {
  const words = text.match(/[A-Za-z]+/g)?.reduce((sum, word) => sum + word.length / 6, 0) ?? 0;
  const digits = text.match(/[0-9]/g)?.length ?? 0;
  const other = text.replace(/[A-Za-z0-9\s]/g, "").length;
  return words + digits * 0.5 + other * 0.9;
}

export function clipPreview(text: string): string {
  return text.slice(0, PREVIEW_CHARS);
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

  items.forEach((item, index) => {
    const pairIndexes = validPairs.get(index);
    if (pairIndexes) {
      const pair = pairIndexes.map((pairIndex) => items[pairIndex]);
      result.push({
        items: pair,
        pinned: pair.some((pairItem) => pairItem.pinned) || pairIndexes.some((pairIndex) => isPinned(pairIndex, items.length, preserveRecent)),
      });
      return;
    }
    if (item.kind === "text" || paired.has(index)) return;
    if (item.kind === "tool_call" && item.pairId) return;
    result.push({
      items: [item],
      pinned: Boolean(item.pinned) || isPinned(index, items.length, preserveRecent),
    });
  });
  return result;
}
