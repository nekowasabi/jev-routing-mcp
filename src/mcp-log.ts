import { narrateAction, type McpActivity } from "./narrate.ts";

const MAX = 40;
const log: McpActivity[] = [];
let seq = 0;

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
