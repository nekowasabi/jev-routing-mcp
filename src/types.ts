export type QuestionType = "noul" | "choice" | "score";

export type NoulQuestion = {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
};

export type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};

export type ScoreQuestion = {
  type: "score";
  instructions: string;
  /** Ordered levels, cheapest/lowest first. */
  criteria: string[];
};

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export type CompactKind = "text" | "summary" | "tool_call" | "tool_result";

export type CompactItem = {
  id: string;
  kind: CompactKind;
  chars: number;
  pairId?: string;
  tool?: string;
  preview?: string;
  pinned?: boolean;
};

export type CompactAction = "keep" | "truncate" | "drop";

export type CompactDecision = {
  id: string;
  action: CompactAction;
  pinned: boolean;
};

export type CompactStats = {
  charsBefore: number;
  charsAfter: number;
  charsDropped: number;
  kept: number;
  truncated: number;
  dropped: number;
  pinned: number;
  items: number;
  stateTokens: number;
  stateStage: string;
  requests: number;
};

export type CompactResult = {
  decisions: CompactDecision[];
  stats: CompactStats;
};

export type NoulAnswer = {
  type: "noul";
  noul: number;
  confidence: number;
};

export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};

export type ScoreAnswer = {
  type: "score";
  score: number;
  legend: string[];
  probabilities: number[];
  confidence: number;
};

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export type SystemOneRequest = {
  state: unknown;
  questions: Record<string, Question>;
  model?: string;
};

export type SystemOneResponse = {
  model: string;
  answers: Record<string, Answer>;
  latencyMs: number;
};

export type ToolDef = {
  name: string;
  description: string;
  mutating?: boolean;
};

export type SkillDef = {
  name: string;
  description: string;
};

export type ElementRow = {
  index: number;
  role: string;
  name: string;
  value: string;
};

export type ModelTier = "luna" | "sol" | "astra";

export type Harness = "claude" | "codex" | "grok";

export type GrokModelId = "grok-4.5" | "grok-4.6";

export type ClaudeModelId = "claude-haiku-4-5" | "claude-sonnet-5" | "claude-fable-5-1";

export type CodexModelId = "gpt-5.6-luna" | "gpt-5.6-sol" | "gpt-6-astra";

export type Policy = {
  minConfidence: number;
  uncertainCeiling: ModelTier;
  pinDuringToolLoop: boolean;
  autoActNoul: number;
  reviewNoul: number;
  destructiveBlock: number;
  failOpen: boolean;
};

export type TurnPhase = "user_turn" | "tool_loop";

export type ActionTaken = {
  tool: string;
  result?: string;
};

export type RouteTurnInput = {
  request: string;
  tools: ToolDef[];
  skills?: SkillDef[];
  phase?: TurnPhase;
  pinnedModel?: ModelTier | GrokModelId | ClaudeModelId | CodexModelId;
  harness?: Harness;
  lastTool?: string;
  lastOutput?: string;
  actionsTaken?: ActionTaken[];
  policy?: Partial<Policy>;
};

export type LoadedTool = {
  name: string;
  load: boolean;
  noul: number;
  primary: boolean;
};

export type SkillDecision =
  | { action: "route"; name: string; confidence: number; noul: number }
  | { action: "none"; confidence: number; noul: number }
  | { action: "review"; name?: string; confidence: number; noul: number };

export type CostBreakdown = {
  jevUsd: number;
  routedUsd: number;
  frontierUsd: number;
  savings: number;
  buckets: {
    modelRoutingUsd: number;
    judgementUsd: number;
  };
  speed: {
    frontierMs: number;
    routedMsHint: number;
    jevMsHint: number;
  };
};

export type LoopDecision = {
  continue: boolean;
  action: "call_tool" | "answer" | "ask_user" | "stop";
  nextTool: string | null;
  /** True when continue_loop vetoed a premature answer (jev-eval-agent done-gate). */
  gated: boolean;
};

export type JevExecution = {
  executed: true;
  replaced: "frontier_tool_judgment";
  tool: string;
  engine: "local" | "live";
  summary: string;
  spokenJa: string;
  spokenEn: string;
};

export type RouteTurnResult = {
  harness: Harness;
  model: {
    tier: ModelTier;
    id: string;
    requested: ModelTier;
    confidence: number;
    pinned: boolean;
    policyNotes: string[];
  };
  effort: "none" | "low" | "high";
  tools: LoadedTool[];
  skill: SkillDecision;
  loop: LoopDecision;
  cost: CostBreakdown;
  latencyMs: number;
  engine: "local" | "live";
  answers: Record<string, Answer>;
};

export type GateVerdict = {
  allow: boolean;
  mode: "enforce" | "shadow";
  destructive: number;
  exfil: number;
  outOfScope: number;
  reversibility: number;
  confidence: number;
  reasons: string[];
  policyNotes: string[];
  latencyMs: number;
  engine: "local" | "live";
};

export type GateCallInput = {
  tool: string;
  args: string;
  request?: string;
  policy?: Partial<Policy>;
};

export type JudgeOutputInput = {
  tool: string;
  output: string;
  isError?: boolean;
};

export type JudgeOutputResult = {
  leaksSecret: number;
  failureClass: string;
  relevant: number;
  advice: string | null;
  confidence: number;
  latencyMs: number;
  engine: "local" | "live";
};

export type ActionOp =
  | "CLICK"
  | "TYPE_TEXT"
  | "SELECT"
  | "SCROLL_UP"
  | "SCROLL_DOWN"
  | "WAIT"
  | "DONE"
  | "BLOCKED";

export type RouteActionInput = {
  goal: string;
  url?: string;
  title?: string;
  elements: ElementRow[];
};

export type RouteActionResult = {
  operation: ActionOp;
  target: number | null;
  confidence: number;
  probabilities: Record<string, number>;
  latencyMs: number;
  engine: "local" | "live";
};

export type ScreenInput = {
  text: string;
  purpose: string;
};

export type ScreenResult = {
  injection: number;
  substance: number;
  relevance: number;
  action: "pass" | "review" | "block" | "skip";
  reason: string;
  latencyMs: number;
  engine: "local" | "live";
};

export type VerifyInput = {
  claims: string[];
  evidence: string;
};

export type VerifyRow = {
  claim: string;
  verdict: "verified" | "contradicted" | "unsupported" | "needs_review";
  confidence: number;
  action: "auto" | "review";
};

export type VerifyResult = {
  summary: {
    verified: number;
    contradicted: number;
    unsupported: number;
    needs_review: number;
  };
  results: VerifyRow[];
  latencyMs: number;
  engine: "local" | "live";
};

export type TraceKind =
  | "route_turn"
  | "gate_call"
  | "judge_output"
  | "route_action"
  | "evaluate"
  | "screen"
  | "verify";

export type Trace = {
  id: string;
  at: number;
  kind: TraceKind;
  engine: "local" | "live";
  latencyMs: number;
  summary: string;
  payload: unknown;
};
