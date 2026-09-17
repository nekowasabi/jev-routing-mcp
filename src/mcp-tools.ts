export const MCP_PROTOCOL_VERSION = "2025-03-26";

export const MCP_SERVER_INFO = {
  name: "jev-routing",
  version: "1.0.0",
  title: "jev-routing",
  description:
    "System One MCP for tool-call and routing optimisation. One typed decision replaces the frontier tool loop. Pass a TypeSafe key to run on jev-latest.",
};

export const MCP_TOOLS = [
  {
    name: "route_turn",
    description:
      "Replace the LLM's tool-selection and model-routing judgement. Call at the start of a user turn AND on each Grok/Claude tool-loop step. Returns model.id per harness (Grok: grok-4.6; Claude: claude-haiku-4-5 / claude-sonnet-5 / claude-fable-5-1; Codex: gpt-5.6-luna / gpt-5.6-sol / gpt-6-astra), which tools to load, loop.continue / loop.nextTool, and a pin flag. A result prefixed [JEV EXECUTED] means Jev already replaced frontier judgement — follow it, do not re-decide. Fail-open: low confidence never downgrades.",
    inputSchema: {
      type: "object",
      required: ["request"],
      properties: {
        request: { type: "string", description: "The user turn, verbatim." },
        tools: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "description"],
            properties: {
              name: { type: "string" },
              description: { type: "string" },
              mutating: { type: "boolean" },
            },
          },
          description: "Tool catalogue. Omit to use the default coding-agent set.",
        },
        skills: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "description"],
            properties: {
              name: { type: "string" },
              description: { type: "string" },
            },
          },
        },
        phase: {
          type: "string",
          enum: ["user_turn", "tool_loop"],
          description: "tool_loop reuses pinnedModel, skips model/skill re-route, and returns loop.continue / loop.nextTool.",
        },
        pinnedModel: {
          type: "string",
          enum: [
            "luna",
            "sol",
            "astra",
            "grok-4.5",
            "grok-4.6",
            "claude-haiku-4-5",
            "claude-sonnet-5",
            "claude-fable-5-1",
            "gpt-5.6-luna",
            "gpt-5.6-sol",
            "gpt-6-astra",
          ],
          description: "Pass model.tier or model.id from the previous route_turn when phase=tool_loop.",
        },
        harness: {
          type: "string",
          enum: ["claude", "codex", "grok"],
          description: "Selects the default tool catalogue and model.id map. Grok/Codex/Claude clients can be auto-detected from User-Agent or JEV_ROUTING_HARNESS.",
        },
        lastTool: {
          type: "string",
          description: "Name of the tool that just ran. Used in phase=tool_loop.",
        },
        lastOutput: {
          type: "string",
          description: "Truncated output of the tool that just ran. Used in phase=tool_loop.",
        },
        actionsTaken: {
          type: "array",
          items: {
            type: "object",
            required: ["tool"],
            properties: {
              tool: { type: "string" },
              result: { type: "string" },
            },
          },
          description:
            "Tools already run this turn, with truncated results. When omitted, lastTool/lastOutput is used as a one-step history.",
        },
        engine: {
          type: "string",
          enum: ["local", "live"],
          description: "Force on-device. Default is live Jev when a TypeSafe key is present.",
        },
      },
    },
  },
  {
    name: "gate_call",
    description:
      "Pre-execution gate for bash/write/edit and Grok run_terminal_command/search_replace/write. Asks whether the call is destructive, exfiltrating, or out of scope. Enforce blocks only when confidence clears the floor; otherwise shadow-report. Fail-open on errors. A [JEV EXECUTED] prefix means Jev already judged this call.",
    inputSchema: {
      type: "object",
      required: ["tool", "args"],
      properties: {
        tool: { type: "string" },
        args: { type: "string" },
        request: { type: "string" },
        engine: { type: "string", enum: ["local", "live"] },
      },
    },
  },
  {
    name: "judge_output",
    description:
      "Post-tool judge. Detects leaked secrets and classifies failures (transient / user / permanent) so the agent does not retry blindly.",
    inputSchema: {
      type: "object",
      required: ["tool", "output"],
      properties: {
        tool: { type: "string" },
        output: { type: "string" },
        isError: { type: "boolean" },
        engine: { type: "string", enum: ["local", "live"] },
      },
    },
  },
  {
    name: "route_action",
    description:
      "Computer-use / browser step. One System One call picks operation and target from the current element table. A generative model is needed only when the operation is TYPE_TEXT.",
    inputSchema: {
      type: "object",
      required: ["goal", "elements"],
      properties: {
        goal: { type: "string" },
        url: { type: "string" },
        title: { type: "string" },
        elements: {
          type: "array",
          items: {
            type: "object",
            required: ["index", "role", "name", "value"],
            properties: {
              index: { type: "number" },
              role: { type: "string" },
              name: { type: "string" },
              value: { type: "string" },
            },
          },
        },
        engine: { type: "string", enum: ["local", "live"] },
      },
    },
  },
  {
    name: "evaluate",
    description:
      "Generic System One evaluate. Pass state plus a map of noul / choice / score questions. Batch every question for this state into one call.",
    inputSchema: {
      type: "object",
      required: ["state", "questions"],
      properties: {
        state: {},
        questions: { type: "object" },
        model: { type: "string" },
        engine: { type: "string", enum: ["local", "live"] },
      },
    },
  },
  {
    name: "screen",
    description:
      "Screen text before it enters the model context: prompt-injection, substance, relevance.",
    inputSchema: {
      type: "object",
      required: ["text", "purpose"],
      properties: {
        text: { type: "string" },
        purpose: { type: "string" },
        engine: { type: "string", enum: ["local", "live"] },
      },
    },
  },
  {
    name: "verify",
    description:
      "Verify each claim in a report or PR description against supplied evidence. Returns calibrated verdicts.",
    inputSchema: {
      type: "object",
      required: ["claims", "evidence"],
      properties: {
        claims: { type: "array", items: { type: "string" } },
        evidence: { type: "string" },
        engine: { type: "string", enum: ["local", "live"] },
      },
    },
  },
] as const;

export const MCP_GUIDE = `# jev-routing — System One MCP

jev-routing is a decision layer, not a chat model. It answers typed questions
(Choice / Score / Noul) with calibrated probabilities so your agent can
branch in code.

## Engines

- **Live Jev** — \`POST https://api.typesafe.ai/v1/systemone\` with
  \`model: jev-latest\`. Pass the TypeSafe key:
  \`Authorization: Bearer ts_...\` or \`x-typesafe-key\`.
- **On-device** — same schema, no key. Used when the header is missing
  or \`engine: "local"\` is set on the tool call.

## When to call what

1. **User turn starts** → \`route_turn\`. Load only the returned tools.
   Pin \`model.id\` (Grok / Claude / Codex each have their own IDs) for the rest of the loop.
2. **Tool loop** → \`route_turn\` with \`phase=tool_loop\`, \`pinnedModel\`,
   \`lastTool\`, \`lastOutput\`, and \`actionsTaken\` when more than one tool
   has already run. If \`loop.continue\` is false, stop and answer.
   If \`loop.gated\` is true, a premature stop was vetoed — follow \`loop.nextTool\`.
   Set \`harness\` or \`JEV_ROUTING_HARNESS\` to \`grok\` / \`claude\` / \`codex\`.
3. **Before bash / write / edit / run_terminal_command / search_replace**
   → \`gate_call\`. Enforce on block; otherwise shadow-report (fail-open).
4. **After a tool result** → \`judge_output\` if the tool is bash,
   run_terminal_command, or the output looks like it might contain a secret.
5. **Browser / computer-use step** → \`route_action\`. Do not spend a
   frontier turn picking the next click.
6. **Anything else typed** → \`evaluate\`.

## Policy (defaults)

- minConfidence 0.6 — below this, never downgrade the model.
- Pin during tool_loop so the model cannot flap mid-task.
- Every \`tools/call\` result starts with \`[JEV EXECUTED]\` — visual proof
  that Jev, not the frontier model, made the judgement.
- Explicit "use astra" in the user text wins outright.
- Fail open: a timeout is "no verdict", never a hard block.

## Why this exists

Frontier models spend most of an agent turn deciding *which* tool to call.
That judgement is a bounded Choice. System One answers it in one pass.
Measured replacements:

- firstmate: same judgement as Fable on 25 prod dispatches, cost −71%, time −90%
- alilibx: GPT-5.6 tool loop → Jev, same accuracy, 12.8× faster, 38× cheaper
- jev-codex-router: 237 turns, ≈ −60% vs full frontier
`;
