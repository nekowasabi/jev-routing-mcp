#!/bin/sh
# Claude Code に jev-routing MCP を stdio で追加する（user スコープ、HTTP サーバー不要）
# 既存エントリがある場合は claude mcp remove jev-routing -s user してから再実行する
claude mcp add -s user jev-routing \
  -e JEV_ROUTING_HARNESS=claude \
  -- node "$HOME/repos/jev-routing-mcp/server.ts" --stdio
