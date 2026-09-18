import type {
  ClaudeModelId,
  CodexModelId,
  CostBreakdown,
  GrokModelId,
  Harness,
  ModelTier,
  Policy,
} from "./types.ts";

export const DEFAULT_POLICY: Policy = {
  minConfidence: 0.6,
  uncertainCeiling: "sol",
  pinDuringToolLoop: true,
  autoActNoul: 0.85,
  reviewNoul: 0.55,
  destructiveBlock: 0.9,
  failOpen: true,
};

export const TIER_ORDER: ModelTier[] = ["luna", "sol", "astra"];

export const TIER_META: Record<
  ModelTier,
  { label: string; usdPerTurn: number; ms: number }
> = {
  luna: { label: "Luna", usdPerTurn: 0.004, ms: 900 },
  sol: { label: "Sol", usdPerTurn: 0.028, ms: 4200 },
  astra: { label: "Astra", usdPerTurn: 0.11, ms: 9800 },
};

export const FRONTIER_USD = TIER_META.astra.usdPerTurn;
export const FRONTIER_MS = TIER_META.astra.ms;
export const JEV_USD = 0.00003;
export const JEV_MS = 80;

// Why: Instead of luna/sol→grok-4.5 and astra→grok-4.6, adopted a single grok-4.6. Reason: Grok harness is pinned to 4.6; a per-tier map of identical IDs would be unused.
export const GROK_MODEL_ID: GrokModelId = "grok-4.6";

export const CLAUDE_MODEL: Record<ModelTier, ClaudeModelId> = {
  luna: "claude-haiku-4-5",
  sol: "claude-sonnet-5",
  astra: "claude-fable-5-1",
};

export const CODEX_MODEL: Record<ModelTier, CodexModelId> = {
  luna: "gpt-5.6-luna",
  sol: "gpt-5.6-sol",
  astra: "gpt-6-astra",
};

export function modelIdFor(harness: Harness, tier: ModelTier): string {
  if (harness === "grok") return GROK_MODEL_ID;
  if (harness === "codex") return CODEX_MODEL[tier];
  return CLAUDE_MODEL[tier];
}

export function parseHarness(value: unknown): Harness | undefined {
  if (value === "grok" || value === "codex" || value === "claude") return value;
  return undefined;
}

export function normalizePinned(value: unknown): ModelTier | undefined {
  if (value === "luna" || value === "sol" || value === "astra") return value;
  if (value === "grok-4.6" || value === "claude-fable-5-1" || value === "gpt-6-astra") return "astra";
  if (value === "grok-4.5" || value === "claude-sonnet-5" || value === "gpt-5.6-sol") return "sol";
  if (value === "claude-haiku-4-5" || value === "gpt-5.6-luna") return "luna";
  return undefined;
}

export function mergePolicy(partial?: Partial<Policy>): Policy {
  return { ...DEFAULT_POLICY, ...partial };
}

export function rank(tier: ModelTier) {
  return TIER_ORDER.indexOf(tier);
}

export function applyModelPolicy(opts: {
  requested: ModelTier;
  confidence: number;
  phase: "user_turn" | "tool_loop";
  pinned?: ModelTier;
  override?: ModelTier;
  policy: Policy;
}): { tier: ModelTier; pinned: boolean; notes: string[] } {
  const notes: string[] = [];
  if (opts.override) {
    notes.push(`override:${opts.override}`);
    return { tier: opts.override, pinned: true, notes };
  }
  if (opts.phase === "tool_loop" && opts.policy.pinDuringToolLoop && opts.pinned) {
    notes.push("pinned:tool_loop");
    return { tier: opts.pinned, pinned: true, notes };
  }
  if (opts.confidence < opts.policy.minConfidence) {
    const ceiling = opts.policy.uncertainCeiling;
    const tier = rank(opts.requested) > rank(ceiling) ? ceiling : opts.requested;
    notes.push("low_confidence:no_upgrade_past_ceiling");
    if (rank(opts.requested) < rank("sol") && rank(tier) < rank("sol")) {
      notes.push("low_confidence:no_downgrade");
      return { tier: "sol", pinned: opts.phase === "user_turn", notes };
    }
    return { tier, pinned: opts.phase === "user_turn", notes };
  }
  notes.push("confident:apply");
  return {
    tier: opts.requested,
    pinned: opts.phase === "user_turn",
    notes,
  };
}

const OVERRIDE_RE: { tier: ModelTier; re: RegExp }[] = [
  { tier: "astra", re: /\b(use|switch to|with|on)\s+(astra|opus|fable|frontier|grok-4\.6)\b/i },
  { tier: "sol", re: /\b(use|switch to|with|on)\s+(sol|sonnet|grok-4\.5)\b/i },
  { tier: "luna", re: /\b(use|switch to|with|on)\s+(luna|haiku)\b/i },
  { tier: "astra", re: /(アストラ|オーパス|最強モデル)/ },
  { tier: "luna", re: /(ルナ|ハイク|最安モデル)/ },
];

export function detectOverride(text: string): ModelTier | undefined {
  for (const row of OVERRIDE_RE) {
    if (row.re.test(text)) return row.tier;
  }
  return undefined;
}

export function costFor(tier: ModelTier, toolCount: number, harness: Harness): CostBreakdown {
  const thinkingTax = 0.018 * Math.max(0, toolCount - 1);
  // Why: Instead of using TIER_META usdPerTurn on Grok, adopted modelRoutingUsd=0. Reason: modelIdFor(grok) is always grok-4.6, so luna/sol/astra prices do not apply.
  const modelRoutingUsd =
    harness === "grok" ? 0 : Math.max(0, FRONTIER_USD - TIER_META[tier].usdPerTurn);
  const judgementUsd = thinkingTax;
  const routedUsd =
    harness === "grok" ? FRONTIER_USD + JEV_USD : TIER_META[tier].usdPerTurn + JEV_USD;
  const frontierUsd = FRONTIER_USD + thinkingTax;
  const savings = frontierUsd <= 0 ? 0 : (frontierUsd - routedUsd) / frontierUsd;
  const routedMsHint =
    harness === "grok" ? FRONTIER_MS + JEV_MS : TIER_META[tier].ms + JEV_MS;
  return {
    jevUsd: JEV_USD,
    routedUsd,
    frontierUsd,
    savings,
    buckets: { modelRoutingUsd, judgementUsd },
    speed: { frontierMs: FRONTIER_MS, routedMsHint, jevMsHint: JEV_MS },
  };
}
