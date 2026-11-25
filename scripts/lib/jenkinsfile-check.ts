/**
 * A small checker for declarative Jenkinsfiles, used on every Jenkinsfile in
 * lessons. It is not Jenkins' own validator (which needs a running Jenkins with
 * the Pipeline plugins); it catches the structural mistakes and security issues
 * taught in the Jenkins track:
 *
 *  - balanced braces and closed strings (comments and strings are skipped);
 *  - the file is a `pipeline { … }` block with `agent` and `stages`;
 *  - every `stage('…')` contains `steps`, `stages`, `parallel` or `matrix`;
 *  - no hard-coded secrets in `environment` (PASSWORD/TOKEN/SECRET/KEY = '…');
 *  - no credential variable inside a double-quoted (Groovy-interpolated) string.
 *    Jenkins warns about this: Groovy substitutes the secret into the command
 *    text before the shell runs. Single quotes let the shell expand it instead.
 */

interface Str {
  quote: string;
  content: string;
}

/** Replace comments and string contents with spaces, keeping positions; collect strings. */
function scan(source: string): { code: string; strings: Str[]; problems: string[] } {
  const out: string[] = [];
  const strings: Str[] = [];
  const problems: string[] = [];
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i, i + 3);
    if (source.startsWith("//", i)) {
      while (i < source.length && source[i] !== "\n") out.push(" ") && i++;
      continue;
    }
    if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      if (end === -1) problems.push("unclosed /* comment");
      for (; i < stop; i++) out.push(source[i] === "\n" ? "\n" : " ");
      continue;
    }
    const quote = rest === "'''" || rest === '"""' ? rest : source[i] === "'" || source[i] === '"' ? source[i]! : "";
    if (quote) {
      let j = i + quote.length;
      let content = "";
      while (j < source.length && !source.startsWith(quote, j)) {
        if (source[j] === "\\" && quote.length === 1) {
          content += source.slice(j, j + 2);
          j += 2;
          continue;
        }
        if (quote.length === 1 && source[j] === "\n") break;
        content += source[j];
        j++;
      }
      if (!source.startsWith(quote, j)) problems.push(`unclosed string starting ${quote}${content.slice(0, 20)}`);
      strings.push({ quote, content });
      const end = Math.min(j + quote.length, source.length);
      out.push(quote);
      for (let k = i + quote.length; k < end - quote.length; k++) out.push(source[k] === "\n" ? "\n" : " ");
      out.push(quote);
      i = end;
      continue;
    }
    out.push(source[i]!);
    i++;
  }
  return { code: out.join(""), strings, problems };
}

/** Index of the `}` matching the `{` at `open`, or -1. */
function matchBrace(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Names of blocks/keywords that appear directly inside the block body (depth 0 of `body`). */
function topLevelWords(body: string): string[] {
  const words: string[] = [];
  let depth = 0;
  const re = /[{}]|\b[A-Za-z_]\w*\b/g;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    if (m[0] === "{") depth++;
    else if (m[0] === "}") depth--;
    else if (depth === 0) words.push(m[0]);
  }
  return words;
}

const SECRET_NAME = /(PASS|PASSWORD|PASSWD|TOKEN|SECRET|API_?KEY|PRIVATE_?KEY)$/i;

export function checkJenkinsfile(source: string): string[] {
  const { code, strings, problems } = scan(source);
  let depth = 0;
  for (const ch of code) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (depth < 0) break;
  }
  if (depth !== 0) problems.push("unbalanced braces { }");
  if (problems.length) return problems;

  const start = /^\s*pipeline\s*\{/.exec(code);
  if (!start) return ["a declarative Jenkinsfile must start with pipeline { … }"];
  const open = start[0].length - 1;
  const close = matchBrace(code, open);
  const body = code.slice(open + 1, close);
  const top = topLevelWords(body);
  if (!top.includes("agent")) problems.push('missing "agent": where should the pipeline run?');
  if (!top.includes("stages")) problems.push('missing "stages"');

  // Each stage must do something.
  const stageRe = /\bstage\s*\(\s*(['"])([\s\S]*?)\1\s*\)\s*\{/g;
  let stages = 0;
  for (let m = stageRe.exec(code); m; m = stageRe.exec(code)) {
    stages++;
    const name = source.slice(m.index, m.index + m[0].length).match(/\(\s*(['"])([\s\S]*?)\1/)?.[2] ?? "?";
    const sOpen = m.index + m[0].length - 1;
    const words = topLevelWords(code.slice(sOpen + 1, matchBrace(code, sOpen)));
    if (!words.some((w) => ["steps", "stages", "parallel", "matrix"].includes(w))) {
      problems.push(`stage '${name}' has no steps, stages, parallel or matrix`);
    }
  }
  if (top.includes("stages") && stages === 0) problems.push('"stages" contains no stage(…)');

  // Hard-coded secrets in environment blocks: NAME = 'literal'
  const envRe = /\benvironment\s*\{/g;
  for (let m = envRe.exec(code); m; m = envRe.exec(code)) {
    const eOpen = m.index + m[0].length - 1;
    const envSrc = source.slice(eOpen + 1, matchBrace(code, eOpen));
    for (const a of envSrc.matchAll(/\b([A-Za-z_]\w*)\s*=\s*(['"])/g)) {
      if (SECRET_NAME.test(a[1] ?? "")) problems.push(`environment ${a[1]} is a hard-coded secret: use credentials('id') instead`);
    }
  }

  // Credential variables, then any Groovy-interpolated (double-quoted) string using them.
  const credVars = new Set<string>();
  for (const a of source.matchAll(/\b([A-Za-z_]\w*)\s*=\s*credentials\s*\(/g)) {
    credVars.add(a[1]!);
    credVars.add(`${a[1]}_USR`);
    credVars.add(`${a[1]}_PSW`);
  }
  for (const a of source.matchAll(/\b(?:variable|usernameVariable|passwordVariable|keyFileVariable|passphraseVariable)\s*:\s*['"]([A-Za-z_]\w*)['"]/g)) {
    credVars.add(a[1]!);
  }
  for (const s of strings) {
    if (!s.quote.startsWith('"')) continue;
    for (const name of credVars) {
      if (new RegExp(`\\$\\{?\\s*(env\\.)?${name}\\b`).test(s.content)) {
        problems.push(`credential ${name} is interpolated by Groovy in a double-quoted string: use single quotes so the shell expands it`);
      }
    }
  }
  return problems;
}

/** Jenkinsfiles a lesson creates: `cat > Jenkinsfile <<'EOF' … EOF` inside run blocks. */
export function jenkinsfilesInScript(code: string): string[] {
  const found: string[] = [];
  const re = /cat > (?:[\w./-]*\/)?Jenkinsfile <<'(\w+)'\n([\s\S]*?)\n\1(?:\n|$)/g;
  for (let m = re.exec(code); m; m = re.exec(code)) found.push(m[2] ?? "");
  return found;
}
