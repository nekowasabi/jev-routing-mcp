#!/bin/sh
# Codex に jev-routing MCP を stdio で追加する
# 既存エントリがある場合は codex mcp remove jev-routing してから再実行する
codex mcp add jev-routing --env JEV_ROUTING_HARNESS=codex -- node "$HOME/repos/jev-routing-mcp/server.ts" --stdio
