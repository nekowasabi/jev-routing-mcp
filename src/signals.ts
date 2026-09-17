export function toolLoopFlags(request: string) {
  const s = request.toLowerCase();
  return {
    mechanical: /\b(rename|typo|whitespace|indent|format|コメント|タイポ|リネーム|表記)\b/.test(s),
    hard: /\b(race|deadlock|heisenbug|architecture|security|cve|競合|デッドロック|設計|脆弱)\b/.test(s),
    standard: /\b(implement|feature|refactor|migrate|export|button|test|実装|リファクタ|機能)\b/.test(s),
    pdf: /\bpdf\b/.test(s),
    csv: /\bcsv\b/.test(s) && /\b(clean|malformed|duplicate)\b/.test(s),
    docker: /\b(dockerfile|multi-stage)\b/.test(s),
    needs_shell: /\b(git |npm |pnpm |pytest|cargo |bash|shell|diagnose|deadlock|reconnect|run_terminal_command)\b/.test(s),
    needs_search: /\b(grep|search for|where is|diagnose|find where|race|deadlock)\b/.test(s),
    needs_read: /\b(read|read_file|open |diagnose|fix|このファイル|race|deadlock)\b/.test(s),
    needs_edit: /\b(rename|typo|fix|replace|edit|search_replace|add|implement|直して|リネーム)\b/.test(s),
    needs_write: /\b(create file|new file|write the test|unit test|新規)\b/.test(s),
    needs_browser: /\b(click|page|website|url|browser|flight|form)\b/.test(s),
    needs_web: /\b(web_search|web_fetch|https?:\/\/|search the web)\b/.test(s),
    needs_mcp: /\b(search_tool|use_tool|mcp )\b/.test(s),
  };
}

export function gateFlags(tool: string, args: string) {
  const a = args.toLowerCase();
  return {
    looks_rm_rf: /\brm\s+-[a-z]*r[a-z]*f\b|\brm\s+-rf\b|\bmkfs\b|\bdd\s+if=/.test(a),
    looks_drop: /\bdrop\s+(table|database)\b/.test(a),
    looks_force_push: /git\s+push\s+--force/.test(a),
    looks_exfil:
      (/\b(curl|wget|nc |scp )\b/.test(a) &&
        /(\$|api[_-]?key|secret|token|password|aws_|sk-)/.test(a)) ||
      /\$[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)/.test(args),
    mutating_tool: /^(bash|write|edit|run_terminal_command|search_replace)$/.test(tool),
  };
}

export function outputFlags(output: string) {
  return {
    looks_secret:
      /\b(sk-|ghp_|github_pat_|AKIA|BEGIN (RSA |OPENSSH )?PRIVATE KEY|api[_-]?key\s*=)/i.test(
        output,
      ),
    looks_timeout: /\b(timeout|timed out|rate limit|ECONNRESET)\b/i.test(output),
  };
}
