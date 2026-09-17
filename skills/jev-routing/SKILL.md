---
name: jev-routing
description: Route Grok tool calls through jev-routing MCP so Jev replaces frontier tool-selection. Use at the start of a user turn, on each tool-loop step, before mutating tools, and after risky tool output when the jev-routing MCP is connected. Not when the MCP is disconnected, and not to re-decide a [JEV EXECUTED] result.
---

# jev-routing

Call `jev-routing__route_turn` via `search_tool` / `use_tool` before spending a frontier turn on tool choice.

## 利用タイミング

jev-routing MCP が接続されているときだけ使う。

使う:

- ユーザーターン開始時。tool やモデルを自分で選ぶ前に `route_turn`
- tool loop の各ステップ。tool が返ったあと、次の tool の前に `route_turn`（`phase=tool_loop`）
- `run_terminal_command` / `write` / `search_replace` の実行前に `gate_call`
- 破壊的な tool 結果、またはシークレットが混ざりそうな出力のあとに `judge_output`

使わない:

- jev-routing MCP が未接続
- `[JEV EXECUTED]` で始まる判定のやり直し
- 引数の中身を埋める作業そのもの（Jev は選択とゲートであり、生成はモデル側）

## 手順

1. User turn starts → `route_turn` with the user text. Follow `tools` where `load` is true. Use `model.id` (`grok-4.5` or `grok-4.6`) and pin it.
2. Tool loop → `route_turn` with `phase=tool_loop`, `pinnedModel` from the previous result, plus `lastTool`, `lastOutput`, and `actionsTaken` (tools already run this turn). If `loop.continue` is false, stop and answer. If `loop.gated` is true, a premature stop was vetoed — follow `loop.nextTool`.
3. Before `run_terminal_command` / `write` / `search_replace` → `gate_call`. Block only when `allow` is false.
4. After a risky tool result → `judge_output`.

A result that starts with `[JEV EXECUTED]` means Jev already replaced the frontier judgement. Do not re-decide the same choice.
