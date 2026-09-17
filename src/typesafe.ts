import { normalizeAnswers, type JsonAnswer } from "./answers.ts";
import type { Question, SystemOneRequest, SystemOneResponse } from "./types.ts";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MODELS = "https://api.typesafe.ai/v1/models";

function compactQuestions(questions: Record<string, Question>) {
  const out: Record<string, unknown> = {};
  for (const [id, q] of Object.entries(questions)) {
    if (q.type === "noul") {
      out[id] = {
        type: "noul",
        instructions: q.instructions,
        ...(q.criteria ? { criteria: q.criteria } : {}),
      };
    } else if (q.type === "choice") {
      out[id] = { type: "choice", instructions: q.instructions, criteria: q.criteria };
    } else {
      out[id] = { type: "score", instructions: q.instructions, criteria: q.criteria };
    }
  }
  return out;
}

function redact(message: string) {
  return message.replace(/ts_[A-Za-z0-9_-]+/g, "ts_…").replace(/Bearer\s+\S+/gi, "Bearer …");
}

export async function pingJev(apiKey: string): Promise<{ ok: true; model: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(MODELS, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return { ok: false, error: res.status === 401 ? "キーが無効です" : `Jev HTTP ${res.status}` };
    }
    const json = (await res.json()) as { models?: { id?: string; name?: string }[] };
    const names = (json.models ?? []).map((m) => m.id ?? m.name ?? "").filter(Boolean);
    return { ok: true, model: names.find((n) => n.includes("jev")) ?? names[0] ?? "jev-latest" };
  } catch (e) {
    return { ok: false, error: redact(e instanceof Error ? e.message : "network") };
  }
}

export async function decideJev(req: SystemOneRequest, apiKey: string): Promise<SystemOneResponse> {
  const started = performance.now();
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: req.model ?? "jev-latest",
      state: req.state,
      questions: compactQuestions(req.questions),
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = redact((await res.text()).slice(0, 240));
    throw new Error(
      res.status === 401 ? "TypeSafe キーが無効です" : `Jev HTTP ${res.status}${body ? `: ${body}` : ""}`,
    );
  }
  const json = (await res.json()) as {
    model?: string;
    answers?: Record<string, JsonAnswer>;
  };
  const raw = json.answers ?? {};
  return {
    model: json.model ?? "jev-latest",
    answers: normalizeAnswers(req.questions, raw),
    latencyMs: performance.now() - started,
  };
}
