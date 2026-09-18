# jev-routing MCP

LLM の tool 判断を System One に置換する MCP サーバーです。  
キーなしではオンデバイス、`TYPESAFE_API_KEY` があれば本物の **Jev** (`jev-latest`) に飛びます。

Node 22 以上。依存パッケージはありません。解凍してすぐ起動できます。

## 起動

```bash
cd jev-routing-mcp
npm start
```

または:

```bash
node bin/server.js
```

既定は `http://127.0.0.1:8787/mcp`。

本物の Jev を使う場合:

```bash
export TYPESAFE_API_KEY=ts_...
node bin/server.js
```

ポートを変える: `PORT=9000 node bin/server.js`

## クライアント接続

### Cursor

`.cursor/mcp.json` または Settings → MCP:

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

キーを環境変数に置いているなら `headers` は省略できます（サーバー側が読みます）。

### Grok

stdio（Grok がプロセスを起動する。HTTP サーバーは不要）:

```bash
grok mcp add jev-routing -- node "$HOME/repos/jev-routing-mcp/server.ts" --stdio
```

または `examples/grok-config.toml` を `~/.grok/config.toml` に追記する。

Grok の TUI で tool 結果の先頭が `[JEV EXECUTED]` なら、Jev がフロンティアの tool 判断を置換した印。
`phase=tool_loop` で tool loop 中はモデルを固定し、`loop.continue` / `loop.nextTool` を返す。
複数ステップでは `actionsTaken` に実行済み tool と結果を渡す。`loop.gated` が true なら早期終了を差し戻しているので `loop.nextTool` に従う。

### Claude Code

stdio（Claude Code がプロセスを起動する。HTTP サーバーは不要）:

```bash
claude mcp add -s user jev-routing \
  -e JEV_ROUTING_HARNESS=claude \
  -- node "$HOME/repos/jev-routing-mcp/server.ts" --stdio
```

または `examples/claude-code.sh` を実行する。user スコープなので全プロジェクトで使える。
`TYPESAFE_API_KEY` はシェル環境から継承する。

### Codex

stdio（Codex がプロセスを起動する。HTTP サーバーは不要）:

```bash
codex mcp add jev-routing --env JEV_ROUTING_HARNESS=codex -- node "$HOME/repos/jev-routing-mcp/server.ts" --stdio
```

または `examples/codex-config.toml` を `~/.codex/config.toml` に追記する。
TUI では `/mcp` で接続状態を確認できる。

### 動作確認

```bash
curl -s http://127.0.0.1:8787/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

タイポ修正の振り分け:

```bash
curl -s http://127.0.0.1:8787/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"route_turn","arguments":{"request":"Rename User to user in src/auth.ts"}}}'
```

破壊ゲート:

```bash
curl -s http://127.0.0.1:8787/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"gate_call","arguments":{"tool":"bash","args":"rm -rf /"}}}'
```

## ツール

| ツール | 用途 |
|---|---|
| `route_turn` | モデル階層・ロードする tool・スキル・思考量 |
| `gate_call` | bash / write / edit の実行前ゲート |
| `judge_output` | シークレット漏洩と失敗分類 |
| `route_action` | ブラウザ操作と対象要素 |
| `evaluate` | 任意の Choice / Score / Noul |
| `screen` | プロンプトインジェクション審査 |
| `verify` | 主張と証拠の突合 |
| `compact` | stub の keep / truncate / drop（本文フルは送らない） |

`engine: "local"` を引数に付けると、キーがあってもオンデバイスに固定します。

## エンジン

- **local** — Jev スキーマ互換のオンデバイス判定。キー不要
- **live** — `POST https://api.typesafe.ai/v1/systemone`（`jev-latest`）

キーは次のどれかです。

1. 環境変数 `TYPESAFE_API_KEY`
2. リクエストヘッダ `Authorization: Bearer ts_...`
3. リクエストヘッダ `x-typesafe-key`

## ソース

`src/` が判定エンジンと MCP ハンドラです。`bin/server.js` はそのバンドルです。UI は含めていません。
