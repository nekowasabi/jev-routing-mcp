import { DEFAULT_SKILLS } from "./catalog.ts";
import {
  evaluateRaw,
  gateCall,
  judgeOutput,
  localDecide,
  routeAction,
  routeTurn,
  screenText,
  verifyClaims,
} from "./dispatch.ts";
import { recordMcpActivity } from "./mcp-log.ts";
import { executionBanner } from "./narrate.ts";
import { MCP_GUIDE, MCP_PROTOCOL_VERSION, MCP_SERVER_INFO, MCP_TOOLS } from "./mcp-tools.ts";
import { normalizePinned, parseHarness } from "./policy.ts";
import type { Harness, JevExecution, SystemOneRequest, SystemOneResponse, ToolDef } from "./types.ts";

type Rpc = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type McpCtx = {
  apiKey?: string;
  harness?: Harness;
};

function ok(id: Rpc["id"], result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function err(id: Rpc["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

function pickProtocolVersion(requested: unknown) {
  const value = String(requested ?? "");
  return PROTOCOL_VERSIONS.includes(value) ? value : MCP_PROTOCOL_VERSION;
}

function wrapToolResult(name: string, result: unknown, activity: ReturnType<typeof recordMcpActivity>) {
  // Why: Banner goes in MCP text (and stderr) instead of only GET /mcp. Reason: Grok TUI shows tool-result text, so that is the visual proof Jev replaced frontier judgement.
  const jev: JevExecution = {
    executed: true,
    replaced: "frontier_tool_judgment",
    tool: name,
    engine: activity.engine,
    summary: activity.summary,
    spokenJa: activity.spokenJa,
    spokenEn: activity.spokenEn,
  };
  const payload =
    result && typeof result === "object" ? { jev, ...(result as object) } : { jev, result };
  const banner = executionBanner(activity);
  process.stderr.write(`${banner}\n`);
  return {
    content: [
      { type: "text", text: banner },
      { type: "text", text: JSON.stringify(payload, null, 2) },
    ],
    structuredContent: payload,
  };
}

function summarize(name: string, result: unknown) {
  if (!result || typeof result !== "object") return name;
  const r = result as Record<string, unknown>;
  if (name === "route_turn") {
    const model = r.model as { id?: string; tier?: string } | undefined;
    const loop = r.loop as {
      continue?: boolean;
      nextTool?: string | null;
      gated?: boolean;
    } | undefined;
    const tools = Array.isArray(r.tools)
      ? (r.tools as { load?: boolean; name?: string }[])
          .filter((t) => t.load)
          .map((t) => t.name)
          .join(", ")
      : "";
    const loopBit =
      loop?.gated ? `next=${loop.nextTool ?? "?"} gated` : loop?.continue === false ? "loop=stop" : loop?.nextTool ? `next=${loop.nextTool}` : "loop=start";
    return `${model?.id ?? model?.tier ?? "?"} · ${r.effort ?? ""} · ${tools || "—"} · ${loopBit}`;
  }
  if (name === "gate_call") return r.allow ? "allow" : "block";
  if (name === "route_action") {
    return `${r.operation ?? ""}${r.target != null ? ` [${r.target}]` : ""}`;
  }
  if (name === "judge_output") return String(r.advice ?? r.failureClass ?? "");
  if (name === "screen") return String(r.action ?? "");
  if (name === "verify") {
    const summary = r.summary as { verified?: number } | undefined;
    return `${summary?.verified ?? 0} verified`;
  }
  return name;
}

async function decider(ctx: McpCtx, forceLocal: boolean) {
  if (!ctx.apiKey || forceLocal) return localDecide;
  const { decideJev } = await import("./typesafe.ts");
  const key = ctx.apiKey;
  return (req: SystemOneRequest): Promise<SystemOneResponse> => decideJev(req, key);
}

function parseActionsTaken(raw: unknown): { tool: string; result?: string }[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const rows = raw.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const tool = (row as { tool?: unknown }).tool;
    if (tool == null || tool === "") return [];
    const result = (row as { result?: unknown }).result;
    return [{ tool: String(tool), result: result == null ? undefined : String(result) }];
  });
  return rows.length ? rows : undefined;
}

async function callTool(name: string, args: Record<string, unknown>, ctx: McpCtx) {
  const forceLocal = args.engine === "local";
  const decide = await decider(ctx, forceLocal);
  const engine = ctx.apiKey && !forceLocal ? "live" : "local";
  switch (name) {
    case "route_turn":
      return routeTurn(
        {
          request: String(args.request ?? ""),
          tools: Array.isArray(args.tools) ? (args.tools as ToolDef[]) : [],
          skills: Array.isArray(args.skills) ? (args.skills as typeof DEFAULT_SKILLS) : [],
          phase: args.phase === "tool_loop" ? "tool_loop" : "user_turn",
          pinnedModel: normalizePinned(args.pinnedModel),
          harness: parseHarness(args.harness) ?? ctx.harness,
          lastTool: args.lastTool ? String(args.lastTool) : undefined,
          lastOutput: args.lastOutput ? String(args.lastOutput) : undefined,
          actionsTaken: parseActionsTaken(args.actionsTaken),
        },
        decide,
        engine,
      );
    case "gate_call":
      return gateCall(
        {
          tool: String(args.tool ?? ""),
          args: String(args.args ?? ""),
          request: args.request ? String(args.request) : undefined,
        },
        decide,
        engine,
      );
    case "judge_output":
      return judgeOutput(
        {
          tool: String(args.tool ?? ""),
          output: String(args.output ?? ""),
          isError: Boolean(args.isError),
        },
        decide,
        engine,
      );
    case "route_action":
      return routeAction(
        {
          goal: String(args.goal ?? ""),
          url: args.url ? String(args.url) : undefined,
          title: args.title ? String(args.title) : undefined,
          elements: Array.isArray(args.elements) ? (args.elements as never) : [],
        },
        decide,
        engine,
      );
    case "evaluate":
      return evaluateRaw(
        {
          state: args.state,
          questions: (args.questions ?? {}) as SystemOneRequest["questions"],
          model: args.model ? String(args.model) : undefined,
        },
        decide,
      );
    case "screen":
      return screenText(
        { text: String(args.text ?? ""), purpose: String(args.purpose ?? "") },
        decide,
        engine,
      );
    case "verify":
      return verifyClaims(
        {
          claims: Array.isArray(args.claims) ? args.claims.map(String) : [],
          evidence: String(args.evidence ?? ""),
        },
        decide,
        engine,
      );
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

let lastClientHarness: Harness | undefined;

function envHarness(): Harness | undefined {
  return parseHarness(process.env.JEV_ROUTING_HARNESS);
}

export async function handleMcpRpc(body: Rpc, ctx: McpCtx = {}) {
  const method = body.method ?? "";
  const id = body.id ?? null;
  const params = body.params ?? {};
  ctx = { ...ctx, harness: ctx.harness ?? envHarness() ?? lastClientHarness };

  if (method === "initialize") {
    const clientName = String((params.clientInfo as { name?: string } | undefined)?.name ?? "");
    lastClientHarness = detectHarness(clientName) ?? lastClientHarness;
    ctx.harness = lastClientHarness ?? ctx.harness;
    return ok(id, {
      protocolVersion: pickProtocolVersion(params.protocolVersion),
      capabilities: { tools: { listChanged: false }, resources: {} },
      serverInfo: MCP_SERVER_INFO,
    });
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return null;
  }
  if (method === "ping") return ok(id, {});
  if (method === "tools/list") {
    return ok(id, { tools: MCP_TOOLS });
  }
  if (method === "tools/call") {
    const name = String(params.name ?? "");
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await callTool(name, args, ctx);
      const engine = ctx.apiKey && args.engine !== "local" ? "live" : "local";
      const activity = recordMcpActivity({
        tool: name,
        engine,
        summary: summarize(name, result),
      });
      return ok(id, wrapToolResult(name, result, activity));
    } catch (e) {
      const activity = recordMcpActivity({
        tool: name,
        engine: ctx.apiKey ? "live" : "local",
        summary: e instanceof Error ? e.message : "tool error",
      });
      const banner = executionBanner(activity);
      process.stderr.write(`${banner}\n`);
      return ok(id, {
        isError: true,
        content: [
          { type: "text", text: banner },
          { type: "text", text: e instanceof Error ? e.message : "tool error" },
        ],
      });
    }
  }
  if (method === "resources/list") {
    return ok(id, {
      resources: [
        {
          uri: "jev-routing://guide",
          name: "jev-routing guide",
          mimeType: "text/markdown",
        },
      ],
    });
  }
  if (method === "resources/read") {
    return ok(id, {
      contents: [
        {
          uri: "jev-routing://guide",
          mimeType: "text/markdown",
          text: MCP_GUIDE,
        },
      ],
    });
  }
  return err(id, -32601, `Method not found: ${method}`);
}

export function detectHarness(userAgent?: string | null): Harness | undefined {
  if (!userAgent) return undefined;
  if (/grok/i.test(userAgent)) return "grok";
  if (/codex/i.test(userAgent)) return "codex";
  if (/claude/i.test(userAgent)) return "claude";
  return undefined;
}

export function readMcpKey(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  const header = request.headers.get("x-typesafe-key") ?? request.headers.get("x-jev-key");
  if (header?.trim()) return header.trim();
  return process.env.TYPESAFE_API_KEY?.trim() || undefined;
}
