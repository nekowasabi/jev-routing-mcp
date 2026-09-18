import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { narrateAction, type McpActivity } from "./narrate.ts";
import type { CostBreakdown, Harness } from "./types.ts";

const MAX = 40;
const log: McpActivity[] = [];
let seq = 0;

export function metricsPath(): string {
  return process.env.JEV_ROUTING_METRICS_PATH || join(homedir(), ".jev-routing", "metrics.jsonl");
}

export function tokensEstFromBytes(bytes: number): number {
  return Math.ceil(bytes / 4);
}

export type MetricsEvent = {
  at: number;
  tool: string;
  engine: "local" | "live";
  harness?: Harness;
  phase?: string;
  latencyMs?: number;
  mcpRequestBytes: number;
  mcpResponseBytes: number;
  mcpUncompactedBytes: number;
  tokensEst: { request: number; response: number };
  buckets?: {
    modelRoutingUsd: number;
    judgementUsd: number;
    mcpOverheadTokens: number;
  };
  heuristicUsd?: Pick<CostBreakdown, "jevUsd" | "routedUsd" | "frontierUsd" | "savings">;
  speed?: { jevMs: number; frontierMs: number; routedMs: number };
  toolsCatalog?: number;
  toolsLoaded?: number;
  summary: string;
  compaction?: {
    items: number;
    charsBefore: number;
    charsAfter: number;
    charsDropped: number;
    kept: number;
    truncated: number;
    dropped: number;
    pinned: number;
    stateTokens: number;
    stateStage: string;
    jevRequests: number;
    netChars: number;
    netTokensEst: number;
  };
};

export function appendMetrics(event: MetricsEvent): void {
  // Why: Instead of throwing on log I/O, adopted fail-open. Reason: metrics must not fail the MCP call.
  try {
    const path = metricsPath();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(event)}\n`);
  } catch {
    /* ignore */
  }
}

export function recordMcpActivity(input: {
  tool: string;
  engine: "local" | "live";
  summary: string;
}): McpActivity {
  seq += 1;
  const item: McpActivity = {
    id: `${Date.now()}-${seq}`,
    at: Date.now(),
    tool: input.tool,
    engine: input.engine,
    summary: input.summary,
    spokenJa: narrateAction({
      locale: "ja",
      engine: input.engine,
      kind: input.tool,
      summary: input.summary,
    }),
    spokenEn: narrateAction({
      locale: "en",
      engine: input.engine,
      kind: input.tool,
      summary: input.summary,
    }),
  };
  log.unshift(item);
  if (log.length > MAX) log.length = MAX;
  return item;
}

export function listMcpActivity(since = 0): McpActivity[] {
  if (!since) return log.slice(0, 12);
  return log.filter((row) => row.at > since).slice(0, 12);
}
