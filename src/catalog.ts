import type { ElementRow, SkillDef, ToolDef } from "./types.ts";

export const DEFAULT_TOOLS: ToolDef[] = [
  {
    name: "read",
    description:
      "Read a file from the workspace by path. Use when the path is already known. Not for searching unknown locations or listing a directory.",
  },
  {
    name: "grep",
    description:
      "Search file contents with a regular expression. Use to find where a symbol or string lives. Not for reading a known path or finding files by name.",
  },
  {
    name: "glob",
    description:
      "Find files by name glob. Non-mutating. Not for searching file contents.",
  },
  {
    name: "edit",
    description:
      "Apply a precise search-and-replace edit to an existing file. Use for rename, typo, and in-place changes. Not for creating a new file or rewriting the whole file when a small replace works.",
    mutating: true,
  },
  {
    name: "write",
    description:
      "Create or overwrite a file with new contents. Use only for new files or full rewrites. Not for a small in-place change to an existing file.",
    mutating: true,
  },
  {
    name: "bash",
    description:
      "Run a shell command. Can be destructive or exfiltrate data. Use for git, package managers, tests, and process control. Not for reading or editing files.",
    mutating: true,
  },
  {
    name: "browser",
    description:
      "Inspect pages, click, type, and read the live DOM. Not for fetching a public URL as markdown when the page is not interactive.",
  },
  {
    name: "mcp_call",
    description:
      "Call an installed MCP tool by name with JSON arguments. Not for ordinary workspace read/edit/shell.",
  },
];

export const GROK_TOOLS: ToolDef[] = [
  {
    name: "read_file",
    description:
      "Read a file from the workspace by path. Use when the path is already known. Not for searching unknown locations or listing a directory.",
  },
  {
    name: "grep",
    description:
      "Search file contents with a regular expression. Use to find where a symbol or string lives. Not for reading a known path or listing a directory.",
  },
  {
    name: "list_dir",
    description:
      "List files and directories at a known path. Not for searching file contents or reading a file.",
  },
  {
    name: "search_replace",
    description:
      "Apply a precise search-and-replace edit to an existing file. Use for rename, typo, and in-place changes. Not for creating a new file or rewriting the whole file when a small replace works.",
    mutating: true,
  },
  {
    name: "write",
    description:
      "Create or overwrite a file with new contents. Use only for new files or full rewrites. Not for a small in-place change to an existing file.",
    mutating: true,
  },
  {
    name: "run_terminal_command",
    description:
      "Run a shell command. Can be destructive or exfiltrate data. Use for git, package managers, tests, and process control. Not for reading or editing files, and not for fetching a URL.",
    mutating: true,
  },
  {
    name: "web_search",
    description:
      "Search the public web for unknown URLs or current information. Not for reading a URL that is already known.",
  },
  {
    name: "web_fetch",
    description:
      "Fetch a known URL as markdown. Not for discovering unknown URLs.",
  },
  {
    name: "search_tool",
    description:
      "Discover installed MCP tools by keyword. Use when the qualified name is unknown. Not for calling a tool whose name is already known.",
  },
  {
    name: "use_tool",
    description:
      "Call a discovered MCP tool by its qualified server__tool name. Not for discovering tools.",
  },
  {
    name: "spawn_subagent",
    description:
      "Delegate a bounded task to a child agent. Not for a single cheap tool call the parent can do itself.",
  },
];

export const DEFAULT_SKILLS: SkillDef[] = [
  {
    name: "pdf-extraction",
    description: "Extract tables and text from supplied PDF files with page references.",
  },
  {
    name: "csv-cleaning",
    description: "Clean malformed and duplicate rows in supplied CSV files.",
  },
  {
    name: "dockerfile-repair",
    description: "Repair multi-stage Dockerfiles so the image builds.",
  },
  {
    name: "design-ui",
    description: "Polish interface tokens, type, surfaces, and anti-slop rules.",
  },
  {
    name: "browser-qa",
    description: "Drive a real browser against the running app and capture traces.",
  },
  {
    name: "none-needed",
    description: "No specialised skill is required for this request.",
  },
];

export const FLIGHTS_ELEMENTS: ElementRow[] = [
  { index: 1, role: "button", name: "Change ticket type", value: "Round trip" },
  { index: 2, role: "combobox", name: "Where from?", value: "San Francisco" },
  { index: 3, role: "combobox", name: "Where to?", value: "" },
  { index: 4, role: "textbox", name: "Departure", value: "" },
  { index: 5, role: "textbox", name: "Return", value: "" },
  { index: 6, role: "button", name: "Search", value: "" },
  { index: 7, role: "link", name: "Explore destinations", value: "" },
];
