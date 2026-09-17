import type { Answer, Question } from "./types.ts";

export type JsonAnswer = {
  type?: string;
  noul?: number;
  choice?: string;
  probabilities?: Record<string, number> | number[];
  score?: number;
  legend?: string[] | Record<string, string>;
  confidence?: number;
};

function asNumber(n: unknown, fallback = 0) {
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function clamp01(n: number, lo = 0.01, hi = 0.99) {
  return Math.min(hi, Math.max(lo, n));
}

export function normalizeAnswers(
  questions: Record<string, Question>,
  raw: Record<string, JsonAnswer>,
): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  for (const [id, q] of Object.entries(questions)) {
    const a = raw[id] ?? {};
    if (q.type === "noul") {
      const noul = clamp01(asNumber(a.noul, 0.5));
      out[id] = {
        type: "noul",
        noul,
        confidence: clamp01(asNumber(a.confidence, Math.abs(noul - 0.5) * 2 || 0.5), 0.05),
      };
      continue;
    }
    if (q.type === "choice") {
      const keys = Object.keys(q.criteria);
      const probs: Record<string, number> = {};
      const src = a.probabilities && !Array.isArray(a.probabilities) ? a.probabilities : {};
      let sum = 0;
      for (const k of keys) {
        const v = Math.max(0, asNumber(src[k], k === a.choice ? 0.7 : 0.1));
        probs[k] = v;
        sum += v;
      }
      if (sum <= 0) {
        keys.forEach((k) => {
          probs[k] = 1 / Math.max(1, keys.length);
        });
      } else {
        keys.forEach((k) => {
          probs[k] = (probs[k] ?? 0) / sum;
        });
      }
      const choice =
        typeof a.choice === "string" && keys.includes(a.choice)
          ? a.choice
          : keys.sort((x, y) => (probs[y] ?? 0) - (probs[x] ?? 0))[0] ?? keys[0] ?? "";
      out[id] = {
        type: "choice",
        choice,
        probabilities: probs,
        confidence: clamp01(asNumber(a.confidence, probs[choice] ?? 0.5), 0.05),
      };
      continue;
    }
    const legend = Array.isArray(a.legend)
      ? a.legend.map(String)
      : a.legend && typeof a.legend === "object"
        ? Object.keys(a.legend)
            .sort((x, y) => Number(x) - Number(y))
            .map((k) => String((a.legend as Record<string, string>)[k]))
        : q.criteria;
    const n = legend.length;
    let probabilities: number[];
    if (Array.isArray(a.probabilities)) {
      const arr = a.probabilities;
      probabilities = legend.map((_, i) => Math.max(0, asNumber(arr[i], 0)));
    } else if (a.probabilities && typeof a.probabilities === "object") {
      const obj = a.probabilities as Record<string, number>;
      probabilities = legend.map((_, i) => Math.max(0, asNumber(obj[String(i)], 0)));
    } else {
      const nearest = Math.round(asNumber(a.score, 0));
      probabilities = legend.map((_, i) => (i === nearest ? 0.6 : 0.1));
    }
    const s = probabilities.reduce((x, y) => x + y, 0) || 1;
    const norm = probabilities.map((p) => p / s);
    out[id] = {
      type: "score",
      score: Math.min(n - 1, Math.max(0, asNumber(a.score, norm.reduce((acc, p, i) => acc + p * i, 0)))),
      legend,
      probabilities: norm,
      confidence: clamp01(asNumber(a.confidence, 0.5), 0.05),
    };
  }
  return out;
}
