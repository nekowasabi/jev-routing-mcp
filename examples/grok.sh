#!/bin/sh
# Grok に jev-routing MCP を stdio で追加する
# 既存エントリがある場合は grok mcp remove jev-routing してから再実行する
grok mcp add jev-routing -- node "$HOME/repos/jev-routing-mcp/server.ts" --stdio
