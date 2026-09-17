import type { SpeakLocale } from "./speak.ts";

export function narrateAction(opts: {
  locale: SpeakLocale;
  engine: "local" | "live";
  kind: string;
  summary: string;
}) {
  const src = opts.engine === "live" ? "Jev" : opts.locale === "ja" ? "オンデバイス" : "on-device";
  const kind = opts.kind.replaceAll("_", " ");
  if (opts.locale === "ja") {
    return `${src}が ${kind} を判定し、フロンティアの tool 判断を置換した。${opts.summary}`;
  }
  return `${src} ran ${kind} and replaced frontier tool judgment. ${opts.summary}`;
}

export function executionBanner(opts: {
  tool: string;
  engine: "local" | "live";
  spokenJa: string;
  spokenEn: string;
}) {
  return [
    `[JEV EXECUTED] engine=${opts.engine} tool=${opts.tool} replaced=frontier_tool_judgment`,
    opts.spokenJa,
    opts.spokenEn,
  ].join("\n");
}

export type McpActivity = {
  id: string;
  at: number;
  tool: string;
  engine: "local" | "live";
  summary: string;
  spokenJa: string;
  spokenEn: string;
};
