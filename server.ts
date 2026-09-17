import http from "node:http";
import { detectHarness, handleMcpRpc, readMcpKey } from "./src/handle-mcp.ts";
import { listMcpActivity } from "./src/mcp-log.ts";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "content-type, authorization, mcp-session-id, mcp-protocol-version, x-typesafe-key, x-jev-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function applyCors(res: http.ServerResponse) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function toFetchRequest(req: http.IncomingMessage, body: string) {
  const host = req.headers.host ?? `${HOST}:${PORT}`;
  const url = new URL(req.url ?? "/", `http://${host}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
  }
  return new Request(url, {
    method: req.method ?? "GET",
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
  });
}

type RpcBody = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

let stdioFraming: "cl" | "ndjson" = "ndjson";

function writeStdio(msg: unknown) {
  const json = JSON.stringify(msg);
  if (stdioFraming === "ndjson") {
    process.stdout.write(json + "\n");
    return;
  }
  const payload = Buffer.from(json, "utf8");
  process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`);
  process.stdout.write(payload);
}

function takeStdioMessage(buf: Buffer): { msg: RpcBody; rest: Buffer } | null {
  let i = 0;
  while (i < buf.length && (buf[i] === 10 || buf[i] === 13 || buf[i] === 32)) i += 1;
  if (i > 0) buf = buf.subarray(i);
  if (buf.length === 0) return null;

  if (buf[0] === 123) {
    stdioFraming = "ndjson";
    const nl = buf.indexOf(10);
    if (nl === -1) return null;
    const line = buf.subarray(0, nl).toString("utf8").trim();
    if (!line) return { msg: {}, rest: buf.subarray(nl + 1) };
    return { msg: JSON.parse(line) as RpcBody, rest: buf.subarray(nl + 1) };
  }

  stdioFraming = "cl";
  const crlf = buf.indexOf("\r\n\r\n");
  const lf = buf.indexOf("\n\n");
  const headerEnd = crlf !== -1 && (lf === -1 || crlf <= lf) ? crlf : lf;
  if (headerEnd === -1) return null;
  const sepLen = buf[headerEnd] === 13 ? 4 : 2;
  const header = buf.subarray(0, headerEnd).toString("utf8");
  const match = /Content-Length:\s*(\d+)/i.exec(header);
  if (!match) return null;
  const len = Number(match[1]);
  const start = headerEnd + sepLen;
  if (buf.length < start + len) return null;
  const json = buf.subarray(start, start + len).toString("utf8");
  return { msg: JSON.parse(json) as RpcBody, rest: buf.subarray(start + len) };
}

async function serveStdio() {
  if (!process.env.JEV_ROUTING_HARNESS) process.env.JEV_ROUTING_HARNESS = "grok";
  const apiKey = process.env.TYPESAFE_API_KEY?.trim() || undefined;
  console.error(
    `jev-routing MCP  stdio  harness=${process.env.JEV_ROUTING_HARNESS} engine=${apiKey ? "jev-latest" : "local (set TYPESAFE_API_KEY for live Jev)"}`,
  );
  let buf = Buffer.alloc(0);
  let chain = Promise.resolve();

  const pump = () => {
    chain = chain.then(async () => {
      while (true) {
        const taken = takeStdioMessage(buf);
        if (!taken) return;
        buf = taken.rest;
        const result = await handleMcpRpc(taken.msg, { apiKey });
        if (result != null) writeStdio(result);
      }
    }).catch((e) => {
      console.error(e instanceof Error ? e.message : e);
    });
  };

  // Why: Listen for data without calling resume() first. Reason: resume() without a listener discards already-piped initialize bytes (Grok sends immediately after spawn).
  process.stdin.on("data", (chunk) => {
    buf = Buffer.concat([buf, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    pump();
  });
  process.stdin.on("end", () => {
    pump();
    chain.finally(() => process.exit(0));
  });
}

if (process.argv.includes("--stdio")) {
  await serveStdio();
} else {

const server = http.createServer(async (req, res) => {
  applyCors(res);
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  const path = url.pathname.replace(/\/$/, "") || "/";

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (path !== "" && path !== "/" && path !== "/mcp") {
    res.statusCode = 404;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "not found. POST /mcp" }));
    return;
  }

  try {
    if (req.method === "GET") {
      const since = Number(url.searchParams.get("since") ?? "0") || 0;
      const fetchReq = toFetchRequest(req, "");
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          name: "jev-routing",
          version: "1.0.0",
          protocol: "mcp",
          transport: "json-rpc",
          engine: readMcpKey(fetchReq) ? "jev-latest" : "local",
          methods: ["initialize", "tools/list", "tools/call", "resources/list", "resources/read"],
          activity: listMcpActivity(since),
        }),
      );
      return;
    }

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }

    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    const fetchReq = toFetchRequest(req, raw);
    const result = await handleMcpRpc(body, {
      apiKey: readMcpKey(fetchReq),
      harness: detectHarness(fetchReq.headers.get("user-agent")),
    });
    if (result == null) {
      res.statusCode = 202;
      res.end();
      return;
    }
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(result));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: e instanceof Error ? e.message : "server error" }));
  }
});

server.listen(PORT, HOST, () => {
  const live = Boolean(process.env.TYPESAFE_API_KEY);
  console.log(`jev-routing MCP  http://${HOST}:${PORT}/mcp`);
  console.log(`engine        ${live ? "jev-latest (TYPESAFE_API_KEY)" : "local (set TYPESAFE_API_KEY for live Jev)"}`);
  console.log("");
  console.log("Grok stdio: node server.ts --stdio");
  console.log("Cursor / Claude Code:");
  console.log(
    JSON.stringify(
      {
        mcpServers: {
          "jev-routing": {
            url: `http://${HOST}:${PORT}/mcp`,
            transport: "http",
            headers: live ? { Authorization: "Bearer $TYPESAFE_API_KEY" } : {},
          },
        },
      },
      null,
      2,
    ),
  );
});
}
