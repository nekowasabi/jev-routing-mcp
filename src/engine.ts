import { clamp } from "./clamp.ts";
import type {
  Answer,
  ChoiceAnswer,
  Question,
  ScoreAnswer,
  SystemOneRequest,
  SystemOneResponse,
} from "./types.ts";

const STOP = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "is",
  "this",
  "that",
  "it",
  "be",
  "as",
  "at",
  "by",
  "from",
  "are",
  "was",
  "not",
  "no",
  "yes",
  "do",
  "does",
  "can",
  "into",
  "your",
  "you",
  "we",
  "they",
  "i",
  "me",
  "my",
  "our",
]);

function flatten(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function tokenize(text: string): string[] {
  const lowered = text.toLowerCase();
  const parts = lowered.split(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf+._/-]+/g);
  const out: string[] = [];
  for (const raw of parts) {
    const t = raw.trim();
    if (t.length < 2 || STOP.has(t)) continue;
    out.push(t);
    if (t.length >= 6) out.push(t.slice(0, 4));
  }
  return out;
}

function bag(text: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokenize(text)) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

function overlap(stateBag: Map<string, number>, optionText: string): number {
  const opt = bag(optionText);
  let score = 0;
  for (const [t, n] of opt) {
    const hit = stateBag.get(t) ?? 0;
    if (hit > 0) score += Math.min(2.4, hit) * (0.55 + Math.min(n, 3) * 0.2);
  }
  return score;
}

function softmax(logits: number[], temperature = 0.72): number[] {
  const t = Math.max(0.15, temperature);
  const max = Math.max(...logits);
  const exps = logits.map((x) => Math.exp((x - max) / t));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

function entropy(ps: number[]): number {
  let h = 0;
  for (const p of ps) {
    if (p > 1e-12) h -= p * Math.log2(p);
  }
  return h;
}

function confidenceFrom(ps: number[]): number {
  const sorted = [...ps].sort((a, b) => b - a);
  const top = sorted[0] ?? 0;
  const second = sorted[1] ?? 0;
  const margin = clamp(top - second, 0, 1);
  const maxH = Math.log2(Math.max(2, ps.length));
  const peaked = 1 - entropy(ps) / maxH;
  return clamp(0.28 + 0.46 * peaked + 0.42 * margin, 0.08, 0.98);
}

function priorLogit(id: string, instructions: string, state: string): number {
  const s = state.toLowerCase();
  const blob = `${id} ${instructions}`.toLowerCase();
  let z = 0.15;

  const flag = (re: RegExp, needle: RegExp, w: number) => {
    if (id === "false") return;
    if (re.test(s) && needle.test(blob)) z += w;
  };

  flag(/"mechanical":true/, /luna|mechanical|trivial|typo|rename/, 2.8);
  flag(/"hard":true/, /astra|hard|race|deadlock|security/, 3.0);
  flag(/"standard":true/, /sol|standard|feature|implement/, 2.2);
  flag(/"pdf":true/, /pdf/, 3.4);
  flag(/"csv":true/, /csv/, 3.0);
  flag(/"docker":true/, /docker/, 3.0);
  flag(/"looks_rm_rf":true|"looks_drop":true|"looks_force_push":true/, /destruct|rm|drop|force/, 4.5);
  flag(/"looks_exfil":true/, /exfil|secret|off-machine|curl/, 4.4);
  flag(/"looks_secret":true/, /secret|credential|key/, 4.4);
  flag(/"needs_edit":true/, /\bedit\b|search_replace|rename|typo|replace/, 2.6);
  flag(/"needs_shell":true/, /\bbash\b|run_terminal_command|shell|git |npm /, 2.6);
  flag(/"needs_search":true/, /\bgrep\b|search/, 2.4);
  flag(/"needs_read":true/, /\bread\b|read_file|diagnose|open /, 2.0);
  flag(/"needs_write":true/, /\bwrite\b|create file|new file/, 2.4);
  flag(/"needs_web":true/, /web_search|web_fetch|https?:/, 2.2);
  flag(/"needs_mcp":true/, /search_tool|use_tool|mcp/, 2.0);
  flag(/"needs_browser":true/, /browser|click|type_text|flight/, 2.4);
  flag(/ignore previous instructions|developer mode|jailbreak/, /injection|jailbreak|override/, 4.0);

  if (/"mechanical":false/.test(s) && /luna|trivial/.test(blob)) z -= 1.6;
  if (/"hard":false/.test(s) && /astra|heisenbug/.test(blob)) z -= 1.4;
  if (/"standard":false/.test(s) && /\bsol\b/.test(blob)) z -= 0.8;
  if (id === "none" && /"mechanical":false/.test(s)) z -= 2.2;
  if (id === "high" && /"hard":true/.test(s)) z += 1.5;
  return z;
}

function choiceAnswer(
  q: Extract<Question, { type: "choice" }>,
  stateText: string,
  stateBag: Map<string, number>,
): ChoiceAnswer {
  const keys = Object.keys(q.criteria);
  const logits = keys.map((k) => {
    const desc = q.criteria[k] ?? "";
    const ov = overlap(stateBag, `${k} ${desc}`);
    const prior = priorLogit(k, `${q.instructions} ${desc}`, stateText);
    return ov + prior;
  });
  const probabilitiesArr = softmax(logits);
  const probabilities: Record<string, number> = {};
  keys.forEach((k, i) => {
    probabilities[k] = probabilitiesArr[i] ?? 0;
  });
  const choice = keys[probabilitiesArr.indexOf(Math.max(...probabilitiesArr))] ?? keys[0] ?? "";
  return {
    type: "choice",
    choice,
    probabilities,
    confidence: confidenceFrom(probabilitiesArr),
  };
}

function noulAnswer(
  q: Extract<Question, { type: "noul" }>,
  stateText: string,
  stateBag: Map<string, number>,
): Answer {
  const trueText = q.criteria?.true ?? q.instructions;
  const falseText = q.criteria?.false ?? `not: ${q.instructions}`;
  const t = overlap(stateBag, trueText) + priorLogit("true", trueText, stateText);
  const f = overlap(stateBag, falseText) + priorLogit("false", falseText, stateText) + 0.95;
  const [pTrue] = softmax([t, f], 0.62);
  const noul = clamp(pTrue ?? 0.5, 0.01, 0.99);
  const confidence = clamp(Math.abs(noul - 0.5) * 1.7 + 0.18, 0.12, 0.97);
  return { type: "noul", noul, confidence };
}

function scoreAnswer(
  q: Extract<Question, { type: "score" }>,
  stateText: string,
  stateBag: Map<string, number>,
): ScoreAnswer {
  const levels = q.criteria;
  const logits = levels.map((level, i) => {
    const ov = overlap(stateBag, level);
    const prior = priorLogit(level, q.instructions, stateText);
    return ov + prior + i * 0.05;
  });
  const probabilities = softmax(logits, 0.8);
  const expected = probabilities.reduce((acc, p, i) => acc + p * i, 0);
  return {
    type: "score",
    score: expected,
    legend: levels,
    probabilities,
    confidence: confidenceFrom(probabilities),
  };
}

export function decideLocal(req: SystemOneRequest): SystemOneResponse {
  const started = performance.now();
  const stateText = flatten(req.state);
  const stateBag = bag(stateText);
  const answers: Record<string, Answer> = {};
  for (const [id, q] of Object.entries(req.questions)) {
    if (q.type === "choice") answers[id] = choiceAnswer(q, stateText, stateBag);
    else if (q.type === "noul") answers[id] = noulAnswer(q, stateText, stateBag);
    else answers[id] = scoreAnswer(q, stateText, stateBag);
  }
  return {
    model: req.model ?? "jev-routing-local",
    answers,
    latencyMs: performance.now() - started,
  };
}

export function noulOf(answers: Record<string, Answer>, id: string): number {
  const a = answers[id];
  if (a && a.type === "noul") return a.noul;
  return 0;
}

export function choiceOf(answers: Record<string, Answer>, id: string): ChoiceAnswer | null {
  const a = answers[id];
  if (a && a.type === "choice") return a;
  return null;
}

export function scoreOf(answers: Record<string, Answer>, id: string): ScoreAnswer | null {
  const a = answers[id];
  if (a && a.type === "score") return a;
  return null;
}
