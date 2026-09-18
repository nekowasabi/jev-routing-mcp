# jev-routing MCP

An MCP server that replaces the LLM's tool decisions with System One.  
Without a key it runs on-device; with `TYPESAFE_API_KEY` it calls the real **Jev** (`jev-latest`).

Node 22 or newer. No dependencies. Unpack it and start it right away.

## Startup

```bash
cd jev-routing-mcp
npm start
```

Or:

```bash
node bin/server.js
```

The default is `http://127.0.0.1:8787/mcp`.

To use the real Jev:

```bash
export TYPESAFE_API_KEY=ts_...
node bin/server.js
```

To change the port: `PORT=9000 node bin/server.js`

## Client setup

### Cursor

`.cursor/mcp.json` or Settings → MCP:

```json
{
  "mcpServers": {
    "jev-routing": {
      "url": "http://127.0.0.1:8787/mcp",
      "transport": "http",
      "headers": {
        "Authorization": "Bearer ts_YOUR_TYPESAFE_KEY"
      }
    }
  }
}
```

If the key is in an environment variable, `headers` can be omitted (the server reads it).

### Grok

stdio (Grok launches the process; no HTTP server needed):

```bash
grok mcp add jev-routing -- node "$HOME/repos/jev-routing-mcp/server.ts" --stdio
```

Or append `examples/grok-config.toml` to `~/.grok/config.toml`.

In Grok's TUI, a tool result starting with `[JEV EXECUTED]` means Jev replaced the frontier model's tool decision.
With `phase=tool_loop` the model stays fixed during the tool loop, and `loop.continue` / `loop.nextTool` are returned.
For multi-step runs, pass the executed tools and their results in `actionsTaken`. If `loop.gated` is true, an early exit was rejected, so follow `loop.nextTool`.

### Claude Code

stdio (Claude Code launches the process; no HTTP server needed):

```bash
claude mcp add -s user jev-routing \
  -e JEV_ROUTING_HARNESS=claude \
  -- node "$HOME/repos/jev-routing-mcp/server.ts" --stdio
```

Or run `examples/claude-code.sh`. User scope makes it available in every project.
`TYPESAFE_API_KEY` is inherited from the shell environment.

### Codex

stdio (Codex launches the process; no HTTP server needed):

```bash
codex mcp add jev-routing --env JEV_ROUTING_HARNESS=codex -- node "$HOME/repos/jev-routing-mcp/server.ts" --stdio
```

Or append `examples/codex-config.toml` to `~/.codex/config.toml`.
In the TUI, `/mcp` shows the connection status.

### Verifying it works

```bash
curl -s http://127.0.0.1:8787/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Routing a typo fix:

```bash
curl -s http://127.0.0.1:8787/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"route_turn","arguments":{"request":"Rename User to user in src/auth.ts"}}}'
```

Destructive gate:

```bash
curl -s http://127.0.0.1:8787/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"gate_call","arguments":{"tool":"bash","args":"rm -rf /"}}}'
```

## Tools

| Tool | Purpose |
|---|---|
| `route_turn` | Model tier, tools to load, skills, thinking budget |
| `gate_call` | Pre-execution gate for bash / write / edit |
| `judge_output` | Secret leakage and failure classification |
| `route_action` | Browser actions and target elements |
| `evaluate` | Arbitrary Choice / Score / Noul |
| `screen` | Prompt injection screening |
| `verify` | Claim-to-evidence matching |
| `compact` | Keep / truncate / drop stubs (not full bodies) |

Adding `engine: "local"` to the arguments pins execution on-device even when a key is present.

## Engines

- **local** — On-device decisions compatible with the Jev schema. No key required
- **live** — `POST https://api.typesafe.ai/v1/systemone` (`jev-latest`)

The key comes from one of the following.

1. The `TYPESAFE_API_KEY` environment variable
2. The `Authorization: Bearer ts_...` request header
3. The `x-typesafe-key` request header

## Source

`src/` holds the decision engine and the MCP handlers. `bin/server.js` is the bundle of those. No UI is included.
