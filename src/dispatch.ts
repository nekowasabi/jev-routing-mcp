import { DEFAULT_SKILLS, DEFAULT_TOOLS, GROK_TOOLS } from "./catalog.ts";
import { choiceOf, decideLocal, noulOf } from "./engine.ts";
import {
  actionQuestions,
  gateQuestions,
  loopQuestions,
  modelQuestions,
  outputQuestions,
  screenQuestions,
  skillQuestions,
  toolQuestions,
} from "./questions.ts";
import { gateFlags, outputFlags, toolLoopFlags } from "./signals.ts";
import {
  applyModelPolicy,
  costFor,
  detectOverride,
  mergePolicy,
  modelIdFor,
  normalizePinned,
} from "./policy.ts";
import type {
  ActionOp,
  Answer,
  GateCallInput,
  GateVerdict,
  Harness,
  JudgeOutputInput,
  JudgeOutputResult,
  LoopDecision,
  ModelTier,
  RouteActionInput,
  RouteActionResult,
  RouteTurnInput,
  RouteTurnResult,
  ScreenInput,
  ScreenResult,
  SkillDecision,
  SystemOneRequest,
  SystemOneResponse,
  VerifyInput,
  VerifyResult,
} from "./types.ts";

export type EngineKind = "local" | "live";

type Decider = (req: SystemOneRequest) => Promise<SystemOneResponse> | SystemOneResponse;

function effortFrom(choice: string | undefined): RouteTurnResult["effort"] {
  if (choice === "high" || choice === "none" || choice === "low") return choice;
  return "low";
}

function asTier(choice: string | undefined): ModelTier {
  if (choice === "luna" || choice === "sol" || choice === "astra") return choice;
  return "sol";
}

function asHarness(value: unknown): Harness {
  return value === "grok" || value === "codex" || value === "claude" ? value : "claude";
}

function clipText(value: unknown, max = 600): string {
  const s = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function actionsTakenOf(input: RouteTurnInput): { tool: string; result: string }[] {
  const rows = (input.actionsTaken ?? [])
    .map((a) => ({ tool: String(a.tool ?? ""), result: clipText(a.result ?? "") }))
    .filter((a) => a.tool);
  if (input.lastTool) {
    const last = { tool: input.lastTool, result: clipText(input.lastOutput ?? "") };
    const tail = rows[rows.length - 1];
    if (!tail || tail.tool !== last.tool || tail.result !== last.result) rows.push(last);
  }
  return rows.slice(-12);
}

function loopDecision(
  phase: RouteTurnInput["phase"],
  answers: RouteTurnResult["answers"],
  nextTool: string | null,
): LoopDecision {
  if (phase !== "tool_loop") {
    return { continue: true, action: "call_tool", nextTool, gated: false };
  }
  const raw = choiceOf(answers, "next_action")?.choice;
  const action =
    raw === "answer" || raw === "ask_user" || raw === "stop" || raw === "call_tool" ? raw : "call_tool";
  const continueNoul = noulOf(answers, "continue_loop");
  // Why: Instead of trusting next_action=answer alone, adopted continue_loop as a veto. Reason: Jev can pick respond while requested steps are still missing (jev-eval-agent done-gate).
  if (action === "answer" && continueNoul >= 0.5 && nextTool) {
    return { continue: true, action: "call_tool", nextTool, gated: true };
  }
  const keepGoing = action === "call_tool" && continueNoul >= 0.45 && Boolean(nextTool);
  return {
    continue: keepGoing,
    action: keepGoing ? "call_tool" : action === "call_tool" ? "answer" : action,
    nextTool: keepGoing ? nextTool : null,
    gated: false,
  };
}

export async function routeTurn(
  input: RouteTurnInput,
  decide: Decider,
  engine: EngineKind = "local",
): Promise<RouteTurnResult> {
  const harness = asHarness(input.harness);
  const tools = input.tools.length ? input.tools : harness === "grok" ? GROK_TOOLS : DEFAULT_TOOLS;
  const skills = input.skills?.length ? input.skills : DEFAULT_SKILLS;
  const policy = mergePolicy(input.policy);
  const phase = input.phase ?? "user_turn";
  const pinned = normalizePinned(input.pinnedModel);
  const skipModel = phase === "tool_loop" && Boolean(pinned);
  const state = {
    request: input.request,
    phase,
    pinned_model: pinned ?? null,
    last_tool: input.lastTool ?? null,
    last_output: input.lastOutput ? String(input.lastOutput).slice(0, 4000) : null,
    actions_taken: actionsTakenOf(input),
    flags: toolLoopFlags(input.request),
    harness,
  };
  const req: SystemOneRequest = {
    state,
    questions: {
      ...(skipModel ? {} : modelQuestions()),
      ...toolQuestions(tools),
      ...(phase === "tool_loop" ? loopQuestions() : skillQuestions(skills)),
    },
  };
  const res = await decide(req);
  const modelAns = skipModel ? null : choiceOf(res.answers, "model_tier");
  const effortAns = skipModel ? null : choiceOf(res.answers, "effort");
  const primary = choiceOf(res.answers, "primary_tool");
  const requested = skipModel && pinned ? pinned : asTier(modelAns?.choice);
  const applied = applyModelPolicy({
    requested,
    confidence: modelAns?.confidence ?? (skipModel ? 1 : 0),
    phase,
    pinned,
    override: detectOverride(input.request),
    policy,
  });

  const ranked = tools
    .map((t) => {
      const noul = noulOf(res.answers, `need_${t.name}`);
      const isPrimary = primary?.choice === t.name;
      return { name: t.name, noul, primary: isPrimary, load: false };
    })
    .sort((a, b) => b.noul - a.noul);
  const keep = new Set<string>();
  const first = ranked.find((t) => t.primary) ?? ranked[0];
  if (first) keep.add(first.name);
  for (const t of ranked) {
    if (keep.size >= 3) break;
    if (t.noul >= 0.58) keep.add(t.name);
  }
  const loaded = tools.map((t) => {
    const row = ranked.find((r) => r.name === t.name);
    return {
      name: t.name,
      load: keep.has(t.name),
      noul: row?.noul ?? 0,
      primary: row?.primary ?? false,
    };
  });

  const needSkill = noulOf(res.answers, "skill_needed");
  const skillChoice = choiceOf(res.answers, "skill");
  const ambiguous = noulOf(res.answers, "ambiguous");
  const skillName = skillChoice?.choice;
  let skill: SkillDecision;
  if (needSkill < 0.45 || skillName === "none-needed" || !skillName) {
    skill = { action: "none", confidence: skillChoice?.confidence ?? 0.7, noul: needSkill };
  } else if (
    ambiguous > 0.55 ||
    (skillChoice?.confidence ?? 0) < policy.minConfidence
  ) {
    skill = {
      action: "review",
      name: skillName,
      confidence: skillChoice?.confidence ?? 0,
      noul: needSkill,
    };
  } else {
    skill = {
      action: "route",
      name: skillName,
      confidence: skillChoice?.confidence ?? 0,
      noul: needSkill,
    };
  }

  const toolsToLoad = loaded.filter((t) => t.load);
  const nextTool =
    loaded.find((t) => t.primary && t.load)?.name ?? loaded.find((t) => t.load)?.name ?? null;
  return {
    harness,
    model: {
      tier: applied.tier,
      id: modelIdFor(harness, applied.tier),
      requested,
      confidence: modelAns?.confidence ?? (skipModel ? 1 : 0),
      pinned: applied.pinned,
      policyNotes: applied.notes,
    },
    effort: skipModel ? "low" : effortFrom(effortAns?.choice),
    tools: loaded,
    skill:
      phase === "tool_loop"
        ? { action: "none", confidence: 1, noul: 0 }
        : skill,
    loop: loopDecision(phase, res.answers, nextTool),
    cost: costFor(applied.tier, Math.max(1, toolsToLoad.length), harness),
    latencyMs: res.latencyMs,
    engine,
    answers: res.answers,
  };
}

export async function gateCall(
  input: GateCallInput,
  decide: Decider,
  engine: EngineKind = "local",
): Promise<GateVerdict> {
  const policy = mergePolicy(input.policy);
  const state = {
    tool: input.tool,
    args: input.args,
    request: input.request ?? "",
    flags: gateFlags(input.tool, input.args),
  };
  const res = await decide({ state, questions: gateQuestions() });
  const destructive = noulOf(res.answers, "destructive");
  const exfil = noulOf(res.answers, "exfil");
  const outOfScope = noulOf(res.answers, "out_of_scope");
  const rev = res.answers.reversibility;
  const reversibility = rev && rev.type === "score" ? rev.score / Math.max(1, rev.legend.length - 1) : 0.5;
  const confs = ["destructive", "exfil", "out_of_scope"]
    .map((id) => res.answers[id])
    .filter((a): a is NonNullable<typeof a> => Boolean(a))
    .map((a) => a.confidence);
  const confidence = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0.5;

  const reasons: string[] = [];
  if (destructive >= policy.reviewNoul) reasons.push("destructive");
  if (exfil >= policy.reviewNoul) reasons.push("exfil");
  if (outOfScope >= policy.reviewNoul) reasons.push("out_of_scope");

  const shouldBlock =
    (destructive >= policy.destructiveBlock || exfil >= policy.autoActNoul) &&
    confidence >= policy.minConfidence;

  const notes: string[] = [];
  let allow = true;
  const mode: GateVerdict["mode"] = shouldBlock ? "enforce" : "shadow";
  if (shouldBlock) {
    allow = false;
    notes.push("enforce:block");
  } else if (reasons.length) {
    notes.push("shadow:report");
  } else {
    notes.push("clear");
  }
  if (!shouldBlock && policy.failOpen) notes.push("fail_open");

  return {
    allow,
    mode,
    destructive,
    exfil,
    outOfScope,
    reversibility,
    confidence,
    reasons,
    policyNotes: notes,
    latencyMs: res.latencyMs,
    engine,
  };
}

export async function judgeOutput(
  input: JudgeOutputInput,
  decide: Decider,
  engine: EngineKind = "local",
): Promise<JudgeOutputResult> {
  const res = await decide({
    state: {
      tool: input.tool,
      output: input.output,
      is_error: Boolean(input.isError),
      flags: outputFlags(input.output),
    },
    questions: outputQuestions(),
  });
  const leaksSecret = noulOf(res.answers, "leaks_secret");
  const relevant = noulOf(res.answers, "relevant");
  const failure = choiceOf(res.answers, "failure_class")?.choice ?? "none";
  const confidence = choiceOf(res.answers, "failure_class")?.confidence ?? 0.5;
  let advice: string | null = null;
  if (leaksSecret > 0.8) advice = "Redact: credential-like text in the tool result.";
  else if (failure === "transient") advice = "Retry: failure looks transient.";
  else if (failure === "permanent") advice = "Stop retrying: permanent failure.";
  else if (relevant < 0.35) advice = "Ignore: output is not relevant.";
  return {
    leaksSecret,
    failureClass: failure,
    relevant,
    advice,
    confidence,
    latencyMs: res.latencyMs,
    engine,
  };
}

export async function routeAction(
  input: RouteActionInput,
  decide: Decider,
  engine: EngineKind = "local",
): Promise<RouteActionResult> {
  const res = await decide({
    state: {
      goal: input.goal,
      url: input.url ?? "",
      title: input.title ?? "",
      elements: input.elements,
    },
    questions: actionQuestions(input.elements),
  });
  const op = (choiceOf(res.answers, "operation")?.choice ?? "WAIT") as ActionOp;
  const targetKey =
    op === "CLICK" ? "click_target" : op === "TYPE_TEXT" ? "type_text_target" : op === "SELECT" ? "select_target" : null;
  const targetRaw = targetKey ? choiceOf(res.answers, targetKey)?.choice : null;
  const target = targetRaw ? Number(targetRaw) : null;
  const probabilities = choiceOf(res.answers, "operation")?.probabilities ?? {};
  return {
    operation: op,
    target: Number.isFinite(target) ? target : null,
    confidence: choiceOf(res.answers, "operation")?.confidence ?? 0,
    probabilities,
    latencyMs: res.latencyMs,
    engine,
  };
}

export async function screenText(
  input: ScreenInput,
  decide: Decider,
  engine: EngineKind = "local",
): Promise<ScreenResult> {
  const res = await decide({
    state: { text: input.text, purpose: input.purpose },
    questions: screenQuestions(input.purpose),
  });
  const injection = noulOf(res.answers, "injection");
  const substance = noulOf(res.answers, "substance");
  const relevance = noulOf(res.answers, "relevance");
  let action: ScreenResult["action"] = "pass";
  let reason = "Ordinary, on-topic content.";
  if (injection > 0.8) {
    action = "block";
    reason = "Looks like a prompt-injection attempt.";
  } else if (injection > 0.45) {
    action = "review";
    reason = "Injection-like phrasing. Keep a human in the loop.";
  } else if (substance < 0.25) {
    action = "skip";
    reason = "Low substance. Do not spend context on it.";
  } else if (relevance < 0.35) {
    action = "skip";
    reason = "Off-purpose for the current task.";
  }
  return { injection, substance, relevance, action, reason, latencyMs: res.latencyMs, engine };
}

export async function verifyClaims(
  input: VerifyInput,
  decide: Decider,
  engine: EngineKind = "local",
): Promise<VerifyResult> {
  const questions: SystemOneRequest["questions"] = {};
  input.claims.forEach((claim, i) => {
    questions[`claim_${i}`] = {
      type: "choice",
      instructions: `Given the evidence, how does this claim stand: ${claim}`,
      criteria: {
        verified: "The evidence supports the claim.",
        contradicted: "The evidence contradicts the claim.",
        unsupported: "The evidence does not mention this.",
        needs_review: "Ambiguous. A human should check.",
      },
    };
  });
  const res = await decide({
    state: { evidence: input.evidence, claims: input.claims },
    questions,
  });
  const results = input.claims.map((claim, i) => {
    const ans = choiceOf(res.answers, `claim_${i}`);
    const verdict = (ans?.choice ?? "needs_review") as VerifyResult["results"][number]["verdict"];
    const confidence = ans?.confidence ?? 0;
    return {
      claim,
      verdict,
      confidence,
      action: confidence >= 0.6 && verdict !== "needs_review" ? ("auto" as const) : ("review" as const),
    };
  });
  const summary = {
    verified: results.filter((r) => r.verdict === "verified").length,
    contradicted: results.filter((r) => r.verdict === "contradicted").length,
    unsupported: results.filter((r) => r.verdict === "unsupported").length,
    needs_review: results.filter((r) => r.verdict === "needs_review").length,
  };
  return { summary, results, latencyMs: res.latencyMs, engine };
}

export const localDecide = (req: SystemOneRequest) => decideLocal(req);

export async function evaluateRaw(req: SystemOneRequest, decide: Decider) {
  return decide(req);
}

export type { Answer };
