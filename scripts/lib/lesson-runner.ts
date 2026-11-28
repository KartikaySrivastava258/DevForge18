/**
 * Executable lessons.
 *
 * In lesson Markdown, a fence written as ```bash run is executed, and a fence
 * written as ```text output directly after it is the output the lesson shows.
 * runLesson() runs every run block, in order, in ONE bash session inside a
 * fresh temporary directory with an isolated HOME (so `git config --global`
 * never touches the real user's settings) and fixed commit dates (so commit
 * hashes are reproducible). It then compares real output with the lesson.
 *
 * Expected-output wildcards, chosen to read naturally to students:
 *   - "…" inside a line matches any text on that line (e.g. a temp path);
 *   - a line containing only "…" matches any number of lines.
 * Add "fails" to the fence (```bash run fails) for a command that is meant to error.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Marked, type Token, type Tokens } from "marked";

export interface RunBlock {
  index: number;
  code: string;
  /**
   * "bash" runs in the shell session; "sql" is sent to psql against a throwaway
   * database; "redis" is sent to redis-cli (default host and port).
   */
  kind: "bash" | "sql" | "redis";
  allowFail: boolean;
  /** A lab's check script (```bash run check): also run in an empty directory, where it must fail. */
  check?: boolean;
  expected: string | undefined;
}

export function extractRunBlocks(markdown: string): RunBlock[] {
  const marked = new Marked();
  const codes: Tokens.Code[] = [];
  marked.walkTokens(marked.lexer(markdown), (t: Token) => {
    if (t.type === "code") codes.push(t as Tokens.Code);
  });
  const blocks: RunBlock[] = [];
  codes.forEach((token, i) => {
    const words = (token.lang ?? "").trim().split(/\s+/);
    if (!words.includes("run")) return;
    const next = codes[i + 1];
    const nextIsOutput = next !== undefined && (next.lang ?? "").trim().split(/\s+/).includes("output");
    blocks.push({
      index: blocks.length,
      code: token.text,
      kind: words[0] === "sql" ? "sql" : words[0] === "redis" ? "redis" : "bash",
      allowFail: words.includes("fails"),
      ...(words.includes("check") ? { check: true } : {}),
      expected: nextIsOutput ? next.text : undefined,
    });
  });
  return blocks;
}

const normalise = (text: string): string[] => {
  const lines = text.replace(/\r\n/g, "\n").split("\n").map((l) => l.replace(/\s+$/, ""));
  while (lines.length && lines[0] === "") lines.shift();
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
};

function lineMatches(expected: string, actual: string): boolean {
  if (!expected.includes("…")) return expected === actual;
  const pattern = expected.split("…").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${pattern}$`).test(actual);
}

/** Does `actual` match `expected`, honouring the "…" wildcards? */
export function outputMatches(expected: string, actual: string): boolean {
  const exp = normalise(expected);
  const act = normalise(actual);
  const match = (i: number, j: number): boolean => {
    if (i === exp.length) return j === act.length;
    if (exp[i] === "…") {
      for (let k = j; k <= act.length; k++) if (match(i + 1, k)) return true;
      return false;
    }
    return j < act.length && lineMatches(exp[i] ?? "", act[j] ?? "") && match(i + 1, j + 1);
  };
  return match(0, 0);
}

export interface BlockResult {
  index: number;
  code: string;
  output: string;
  expected: string | undefined;
  ok: boolean;
}

export interface LessonRun {
  results: BlockResult[];
  exitCode: number | null;
  /** Combined output when the script stopped early (a command failed unexpectedly). */
  failure: string | undefined;
}

const MARKER = "@@DEVFORGE-BLOCK@@";

/**
 * SQL blocks run through psql exactly as a learner's interactive session would
 * show them, with one documented normalisation: when psql reads from a script it
 * prefixes errors with "psql:<stdin>:LINE: ", which an interactive user never
 * sees, so that prefix is removed.
 */
function sqlCommand(code: string): string {
  const delimiter = "DEVFORGE_SQL_EOF";
  if (code.includes(delimiter)) throw new Error("SQL block may not contain the heredoc delimiter");
  return [
    `psql -X -v ON_ERROR_STOP=1 -P pager=off -d "$DEVFORGE_PGDATABASE" 2>&1 <<'${delimiter}' | sed -E 's/^psql:<stdin>:[0-9]+: //'`,
    code,
    delimiter,
  ].join("\n");
}

/**
 * Redis blocks are piped to redis-cli. --no-raw keeps the interactive format
 * learners see ((integer) 1, "value", (nil), numbered arrays), which redis-cli
 * otherwise drops whenever its output is not a terminal.
 */
function redisCommand(code: string): string {
  const delimiter = "DEVFORGE_REDIS_EOF";
  if (code.includes(delimiter)) throw new Error("Redis block may not contain the heredoc delimiter");
  return [`redis-cli --no-raw <<'${delimiter}'`, code, delimiter].join("\n");
}

/** Lessons whose commands use Docker (they create and remove containers and volumes). */
export function usesDocker(blocks: RunBlock[]): boolean {
  return blocks.some((b) => /(^|\n|;|&&|\|)\s*docker\s/.test(b.code));
}

/**
 * What a lesson's commands need from the harness, by track. Shared by the
 * lesson tests and `npm run lessons:record` so the two never disagree.
 *   api       a practice DevForge server, exposed to the lesson as $API
 *   apiPort   0 = any free port; Nginx proxy lessons use 8080, the address learners proxy to
 *   timeoutMs overall limit for the lesson's commands (slow-starting servers need more)
 */
/**
 * Runnables that need DevForge started with extra environment variables, as the page tells learners to start
 * their own copy. The OpenTelemetry lab traces DevForge's own requests into the lab's Collector (ADR 0009).
 */
const API_ENV: Record<string, Record<string, string>> = {
  "opentelemetry-trace-devforge": { OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318", OTEL_SERVICE_NAME: "devforge" },
};

export function lessonNeeds(track: string, order: number, id?: string): { api: boolean; apiPort: number; timeoutMs: number; apiEnv?: Record<string, string> } {
  // Only the reverse-proxy lesson (order 2) proxies to an API, which learners run on port 8080.
  const nginxProxy = track === "nginx" && order === 2;
  const timeouts: Record<string, number> = { kubernetes: 900_000, jenkins: 300_000, terraform: 180_000, "prometheus-grafana": 300_000, opentelemetry: 300_000, kafka: 600_000, postman: 300_000, airflow: 600_000, mlflow: 600_000, "langchain-llamaindex": 300_000, n8n: 300_000, docker: 300_000 };
  const apiEnv = id ? API_ENV[id] : undefined;
  return {
    api: track === "postman" || track === "prometheus-grafana" || nginxProxy || apiEnv !== undefined,
    apiPort: nginxProxy ? 8080 : 0,
    timeoutMs: timeouts[track] ?? 60_000,
    ...(apiEnv ? { apiEnv } : {}),
  };
}

/** Programs some lessons run that are not part of a basic system: CI installs them; locally, lessons that need them are skipped. */
export const OPTIONAL_TOOLS = ["prometheus", "promtool", "alertmanager", "amtool", "grafana", "otelcol", "jaeger"] as const;

/** Which OPTIONAL_TOOLS the blocks run (as a command, not as part of a file or folder name). */
export function toolsUsed(blocks: RunBlock[]): string[] {
  return OPTIONAL_TOOLS.filter((tool) => blocks.some((b) => new RegExp(`(^|[\\s;&|(])${tool}\\s`, "m").test(b.code)));
}

/** Lessons that start Nginx (with a per-lesson prefix: nginx -p). */
export function usesNginx(blocks: RunBlock[]): boolean {
  return blocks.some((b) => /\bnginx -p\b/.test(b.code));
}

/**
 * Run blocks execute with `set -o pipefail`. `cmd | grep -q x` is then a race: grep exits at the first match,
 * cmd can die of SIGPIPE while writing the rest, and the pipeline fails even though x was found — a wait loop
 * (`… | grep -q ready && break`) then never breaks. `grep x > /dev/null` reads all input and has no race.
 */
export function pipesIntoQuietGrep(code: string): boolean {
  return /\|\s*grep\s+-[A-Za-z]*q/.test(code);
}

/** docker run options that take a value as the next word (`--name x`); `--name=x` needs no lookahead. */
const DOCKER_RUN_VALUE_OPTIONS = new Set([
  "--name", "--network", "--net", "-v", "--volume", "-e", "--env", "--env-file", "-p", "--publish", "-w", "--workdir", "-u", "--user",
  "-h", "--hostname", "--entrypoint", "-m", "--memory", "--memory-swap", "--cpus", "--mount", "-l", "--label", "--add-host", "--tmpfs",
  "--platform", "--pull", "--restart", "--health-cmd", "--health-interval", "--health-timeout", "--health-retries", "--health-start-period",
  "--network-alias", "--ulimit", "--shm-size", "--cap-add", "--cap-drop", "--security-opt", "--log-driver", "--log-opt", "--stop-signal",
  "--stop-timeout", "--pids-limit", "--ip", "--dns", "--group-add", "--device", "--read-only-tmpfs", "--expose", "--cidfile", "--init-path",
]);

function shellWords(line: string): string[] {
  return line.match(/(?:"[^"]*"|'[^']*'|[^\s"']+)+/g) ?? [];
}

/** A line without its trailing `# comment` (a `#` that starts a word outside quotes). */
function withoutComment(line: string): string {
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "#" && (i === 0 || /\s/.test(line[i - 1] as string))) return line.slice(0, i);
  }
  return line;
}

/** The quote character open at position `end` of `line`, or "" outside quotes. */
function quoteBefore(line: string, end: number): string {
  let quote = "";
  for (let i = 0; i < end; i++) {
    const c = line[i] as string;
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
  }
  return quote;
}

/** The first simple command of `text`: up to an unquoted `&&`, `||`, `|` or `;` (or `)`, inside "$(…)"). */
function firstCommand(text: string, inSubstitution: boolean): string {
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "|" || c === ";" || (c === "&" && text[i + 1] === "&") || (inSubstitution && c === ")")) return text.slice(0, i);
  }
  return text;
}

/**
 * Images that a document's bash blocks start with `docker run` without pulling them quietly first.
 *
 * On a machine without the image, `docker run` prints "Unable to find image … Pulling from …" on stderr, and the
 * lesson runner compares stderr too, so the block fails on a fresh CI runner yet passes wherever the image is
 * cached, including in CI when an earlier lesson in the same shard happened to pull it. The image counts as
 * available when the document pulls it (`docker pull -q IMAGE > /dev/null`, also in a `for` loop), builds or tags
 * it (also through a shell function that wraps `docker build`), or builds `FROM` it; or when that `docker run`
 * redirects its stderr. Variables assigned in the document (`IMAGE=…`) are resolved.
 */
export function unpulledDockerRunImages(blocks: RunBlock[]): string[] {
  const code = blocks.filter((b) => b.kind === "bash").map((b) => b.code).join("\n").replace(/\\\n/g, " ");
  const lines = code.split("\n").map(withoutComment);
  const vars = new Map<string, string>();
  for (const line of lines) {
    for (const m of line.matchAll(/(?:^|[\s;(])([A-Za-z_][A-Za-z0-9_]*)=("?)([^\s"';)]+)\2/g)) if (!(m[3] as string).startsWith("$")) vars.set(m[1] as string, m[3] as string);
  }
  const resolve = (word: string): string => {
    const bare = word.replace(/^["']|["']$/g, "");
    const v = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(bare);
    return v ? (vars.get(v[1] as string) ?? bare) : bare;
  };
  const builds = /\bdocker\s+(?:image\s+|buildx\s+)?build\b/.test(code);
  const buildFunctions = [...code.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\(\)\s*\{[^}]*\bdocker\s+(?:buildx\s+)?build\b/g)].map((m) => m[1] as string);
  const available = new Set<string>();
  for (const line of lines) {
    for (const m of line.matchAll(/docker\s+(?:image\s+)?pull\s+(?:-\S+\s+)*(\S+)/g)) available.add(resolve(m[1] as string));
    for (const m of line.matchAll(/\bfor\s+([A-Za-z_]\w*)\s+in\s+([^;]+);\s*do\b(.*)/g)) {
      if (new RegExp(`docker\\s+(?:image\\s+)?pull\\b[^;]*\\$\\{?${m[1]}\\b`).test(m[3] as string)) for (const w of shellWords(m[2] as string)) available.add(resolve(w));
    }
    if (builds) {
      for (const m of line.matchAll(/(?:^|\s)(?:-t|--tag)[\s=](\S+)/g)) available.add(resolve(m[1] as string));
      for (const m of line.matchAll(/^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)/gi)) available.add(resolve(m[1] as string));
    }
    for (const m of line.matchAll(/docker\s+(?:image\s+)?tag\s+\S+\s+(\S+)/g)) available.add(resolve(m[1] as string));
    const call = /^\s*([A-Za-z_]\w*)\s+(.*)$/.exec(line);
    if (call && buildFunctions.includes(call[1] as string)) for (const w of shellWords(call[2] as string)) available.add(resolve(w));
  }
  const missing: string[] = [];
  for (const line of lines) {
    const at = line.search(/\bdocker\s+run\b/);
    if (at < 0) continue;
    const quoteAt = quoteBefore(line, at);
    if (quoteAt === "'" || (quoteAt === '"' && !line.slice(0, at).endsWith("$("))) continue; // text, such as echo 'docker run x'
    const command = firstCommand(line.slice(at), line.slice(0, at).endsWith("$("));
    const quiet = /\s(?:2>&1|2>\s*\S+|&>\s*\S+)/.test(command) || /--pull[= ]never\b/.test(command);
    const words = shellWords(command).slice(2);
    let image: string | undefined;
    for (let i = 0; i < words.length; i++) {
      const w = words[i] as string;
      if (/^"?\$(?:@|\{[A-Za-z_]\w*\[@\]\})"?$/.test(w)) continue; // "$@", "${opts[@]}": options from elsewhere
      if (w.startsWith("-")) {
        if (DOCKER_RUN_VALUE_OPTIONS.has(w)) i++;
        continue;
      }
      image = w;
      break;
    }
    if (!image || /\$\(/.test(image)) continue; // $(docker build -q .) names an image the document just built
    const resolved = resolve(image);
    if (resolved.startsWith("$")) continue; // set at run time (a digest, a function argument): cannot be checked here
    if (quiet) available.add(resolved); // its download progress went elsewhere; later runs find it pulled
    if (available.has(resolved)) continue;
    if (!missing.includes(resolved)) missing.push(resolved);
  }
  return missing;
}

/**
 * Lessons that touch the host's Redis: redis blocks, or bash blocks calling redis-cli as a command.
 * redis-cli run inside a container (docker run/exec …) or quoted in a file (a Compose health check)
 * talks to a containerised Redis, so it does not count.
 */
export function usesRedis(blocks: RunBlock[]): boolean {
  return blocks.some((b) => b.kind === "redis" || b.code.split("\n").some((line) => /(^|[\s;&|(])redis-cli(\s|$)/.test(line) && !/\bdocker\s+(run|exec|compose)\b/.test(line)));
}

export function usesPostgres(blocks: RunBlock[]): boolean {
  return blocks.some((b) => b.kind === "sql");
}

/**
 * Bash blocks that use the host's PostgreSQL (createdb, dropdb or psql as commands, e.g. Terraform's pg backend).
 * psql run inside a container (docker exec/run …) talks to that container's own database, so it does not count.
 */
export function usesHostPostgres(blocks: RunBlock[]): boolean {
  return blocks.some((b) => b.code.split("\n").some((line) => /(^|[\s;&|(])(createdb|dropdb|psql)\s/.test(line) && !/\bdocker\s+(run|exec|compose)\b/.test(line)));
}

export interface RunOptions {
  path?: string;
  env?: Record<string, string>;
  /**
   * Redis lessons start with FLUSHDB for a clean slate. That would delete a
   * developer's own Redis data, so it happens only with this explicit opt-in
   * (set from DEVFORGE_REDIS_TEST=1, which CI sets for its throwaway service).
   */
  allowRedisFlush?: boolean;
  /** Overall time limit for the lesson's commands (default 60 s; slow-starting servers such as Jenkins need more). */
  timeoutMs?: number;
}

export function runLesson(blocks: RunBlock[], options: RunOptions = {}): LessonRun {
  if (usesRedis(blocks) && !options.allowRedisFlush) {
    throw new Error("Refusing to run a Redis lesson without allowRedisFlush: it would empty the current Redis database.");
  }
  const root = mkdtempSync(join(tmpdir(), "devforge-lesson-"));
  const home = join(root, "home");
  const work = join(root, "work");
  mkdirSync(home);
  mkdirSync(work);
  // Docker CLI plugins (such as Compose or Buildx) may be installed per user in $DOCKER_CONFIG/cli-plugins,
  // or ~/.docker/cli-plugins (Docker's own lookup). Link only that folder into the isolated HOME — never
  // the config.json beside it, which can hold registry credentials.
  const dockerConfig = process.env.DOCKER_CONFIG || (process.env.HOME ? join(process.env.HOME, ".docker") : "");
  const userPlugins = dockerConfig ? join(dockerConfig, "cli-plugins") : "";
  if (usesDocker(blocks) && userPlugins && existsSync(userPlugins)) {
    mkdirSync(join(home, ".docker"));
    symlinkSync(userPlugins, join(home, ".docker", "cli-plugins"));
  }
  const needsDb = usesPostgres(blocks);
  // Cleanup runs even when a block fails, so nothing outlives the lesson run.
  const cleanup: string[] = [];
  // When the lesson stops early, show the state and last log lines of the containers it started before
  // cleanup removes them — a container that crashed (on CI, say) then explains itself in the test report.
  const containers = [...new Set(blocks.flatMap((b) => [...b.code.matchAll(/\bdocker run\b[^\n]*?--name[ =]([a-zA-Z0-9][\w.-]*)/g)].map((m) => m[1] ?? "")))].filter(Boolean);
  const kindClusters = [...new Set(blocks.flatMap((b) => [...b.code.matchAll(/\bkind create cluster --name ([a-z0-9-]+)/g)].map((m) => m[1] ?? "")))].filter(Boolean);
  // With a kind cluster, the pods and the cluster's recent events (image pulls, scheduling, probes) explain a
  // rollout that timed out — the container list alone only shows the kind node itself.
  const kubeDiagnostics = kindClusters.length
    ? `printf '    pods:\\n'; kubectl get pods -A -o wide 2>&1 | sed 's/^/    /'; printf '    recent events:\\n'; kubectl get events -A --sort-by=.lastTimestamp 2>&1 | tail -n 25 | sed 's/^/    /'`
    : "";
  const diagnostics = containers.length || kindClusters.length
    ? [
        `devforge_rc=$?`,
        // The trap inherits set -e: a failing diagnostic must not abort the rest (or the cleanup after it).
        `set +e`,
        `if [ "$devforge_rc" -ne 0 ]; then printf '\\n--- diagnostics: the lesson stopped (exit code %s); its containers:\\n' "$devforge_rc"; ` +
          [
            `docker ps -a --format '    {{.Names}} {{.Status}}' 2>/dev/null`,
            `free -m 2>/dev/null | sed 's/^/    /'`,
            ...containers.map((c) => `docker inspect -f '${c}: {{.State.Status}}, exit code {{.State.ExitCode}}, OOMKilled={{.State.OOMKilled}}' ${c} 2>/dev/null; docker logs --tail 25 ${c} 2>&1 | sed 's/^/    /'`),
            ...(kubeDiagnostics ? [kubeDiagnostics] : []),
          ].join("; ") +
          `; fi`,
      ]
    : [];
  if (needsDb) cleanup.push(`dropdb --if-exists "$DEVFORGE_PGDATABASE" >/dev/null 2>&1 || true`);
  // Delete any kind cluster a lesson creates, even if a later command fails.
  for (const name of new Set(blocks.flatMap((b) => [...b.code.matchAll(/\bkind create cluster --name ([a-z0-9-]+)/g)].map((m) => m[1] ?? "")))) {
    if (name) cleanup.push(`kind delete cluster --name ${name} >/dev/null 2>&1 || true`);
  }
  if (usesNginx(blocks)) {
    cleanup.push(`for f in $(find "${work}" -name nginx.pid 2>/dev/null); do kill "$(cat "$f")" 2>/dev/null || true; done`);
  }
  // Remove containers a lesson starts with docker run --name, so the next run can reuse the name, together with
  // their anonymous volumes (images such as postgres declare a VOLUME; without -v each run leaves one behind).
  for (const name of new Set(blocks.flatMap((b) => [...b.code.matchAll(/\bdocker run\b[^\n]*?--name[ =]([a-zA-Z0-9][\w.-]*)/g)].map((m) => m[1] ?? "")))) {
    if (name) cleanup.push(`docker rm -f -v ${name} >/dev/null 2>&1 || true`);
  }
  // Take down Compose projects (docker compose -p name …) with their volumes, then user-defined networks.
  for (const name of new Set(blocks.flatMap((b) => [...b.code.matchAll(/\bdocker compose -p ([a-z0-9][a-z0-9_-]*)/g)].map((m) => m[1] ?? "")))) {
    if (name) cleanup.push(`docker compose -p ${name} down -v --remove-orphans >/dev/null 2>&1 || true`);
  }
  for (const name of new Set(blocks.flatMap((b) => [...b.code.matchAll(/\bdocker network create ([a-zA-Z0-9][\w.-]*)/g)].map((m) => m[1] ?? "")))) {
    if (name) cleanup.push(`docker network rm ${name} >/dev/null 2>&1 || true`);
  }
  // Named volumes a lesson creates (docker volume create name), after the containers that use them are gone.
  for (const name of new Set(blocks.flatMap((b) => [...b.code.matchAll(/\bdocker volume create ([a-zA-Z0-9][\w.-]*)/g)].map((m) => m[1] ?? "")))) {
    if (name) cleanup.push(`docker volume rm -f ${name} >/dev/null 2>&1 || true`);
  }
  // Stop servers a lesson started in the background (prometheus … &), even if a later block fails.
  // The job list is read in this shell, not in a $(…) subshell (CI once saw a background job survive
  // that way and hold the output pipe open until the timeout); pkill -P then catches any child left.
  if (blocks.some((b) => /&\s*$/m.test(b.code))) {
    cleanup.push(
      `devforge_jobs="$(mktemp)" && jobs -p > "$devforge_jobs" && while read -r p; do kill "$p" 2>/dev/null || true; done < "$devforge_jobs"; rm -f "$devforge_jobs"`,
      `{ command -v pkill > /dev/null && pkill -TERM -P $$; } 2>/dev/null || true`,
      `wait 2>/dev/null || true`,
    );
  }
  const script = [
    "exec 2>&1",
    "set -e",
    "set -o pipefail",
    ...(cleanup.length ? [`devforge_cleanup() { ${[...diagnostics, ...cleanup].join("; ")}; }`, "trap devforge_cleanup EXIT"] : []),
    ...(needsDb ? [`export DEVFORGE_PGDATABASE="devforge_lesson_$$_$RANDOM"`, `createdb "$DEVFORGE_PGDATABASE"`] : []),
    ...(usesRedis(blocks) ? ["redis-cli FLUSHDB > /dev/null"] : []),
    `cd "${work}"`,
    ...blocks.flatMap((b) => [
      `printf '\\n${MARKER}${b.index}\\n'`,
      ...(b.allowFail ? ["set +e"] : []),
      b.kind === "sql" ? sqlCommand(b.code) : b.kind === "redis" ? redisCommand(b.code) : b.code,
      ...(b.allowFail ? ["set -e"] : []),
    ]),
    `printf '\\n${MARKER}end\\n'`,
  ].join("\n");

  const proc = spawnSync("bash", ["--noprofile", "--norc", "-c", script], {
    encoding: "utf8",
    timeout: options.timeoutMs ?? 60_000,
    env: {
      PATH: options.path ?? process.env.PATH ?? "/usr/bin:/bin",
      // Connection settings for SQL lessons (e.g. the CI PostgreSQL service).
      ...Object.fromEntries(Object.entries(process.env).filter(([k]) => /^PG(HOST|PORT|USER|PASSWORD|SSLMODE)$/.test(k))),
      // Where Grafana's release archive was unpacked (Grafana needs its home folder to start).
      ...(process.env.GRAFANA_HOME ? { GRAFANA_HOME: process.env.GRAFANA_HOME } : {}),
      // Download caches shared across lessons (set in CI by .github/actions/lesson-tools); they avoid
      // downloads without changing what a lesson prints.
      ...Object.fromEntries(
        Object.entries(process.env).filter(([k]) => /^(TF_PLUGIN_CACHE_DIR|TF_PLUGIN_CACHE_MAY_BREAK_DEPENDENCY_LOCK_FILE|npm_config_cache)$/.test(k)),
      ),
      HOME: home,
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      TZ: "UTC",
      TERM: "dumb",
      NO_COLOR: "1",
      PAGER: "cat",
      GIT_PAGER: "cat",
      EDITOR: "true",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_DATE: "2026-01-15T10:00:00+0000",
      GIT_COMMITTER_DATE: "2026-01-15T10:00:00+0000",
      ...options.env,
    },
  });
  rmSync(root, { recursive: true, force: true });

  const out = proc.stdout ?? "";
  const parts = out.split(new RegExp(`\\n${MARKER}`));
  const byIndex = new Map<string, string>();
  for (const part of parts.slice(1)) {
    const nl = part.indexOf("\n");
    byIndex.set(part.slice(0, nl === -1 ? undefined : nl), nl === -1 ? "" : part.slice(nl + 1));
  }
  const completed = byIndex.has("end");
  const results = blocks.map((b) => {
    const output = byIndex.get(String(b.index)) ?? "";
    const ran = byIndex.has(String(b.index + 1)) || (b.index === blocks.length - 1 && completed);
    return { index: b.index, code: b.code, output, expected: b.expected, ok: ran && (b.expected === undefined || outputMatches(b.expected, output)) };
  });
  return { results, exitCode: proc.status, failure: completed ? undefined : out.slice(-2000) };
}

/** True only when Redis lessons are explicitly allowed (DEVFORGE_REDIS_TEST=1) and a server answers PING. */
export function redisTestingEnabled(): boolean {
  if (process.env.DEVFORGE_REDIS_TEST !== "1" || !hasCommand("redis-cli")) return false;
  return spawnSync("redis-cli", ["PING"], { encoding: "utf8", timeout: 5000 }).stdout?.trim() === "PONG";
}

/**
 * Docker lessons create and force-remove containers and volumes with fixed
 * names (web1, notes-data, …), which could destroy a developer's own. They run
 * only with DEVFORGE_DOCKER_TEST=1 (set in CI on throwaway runners) and a
 * reachable Docker engine.
 */
export function dockerTestingEnabled(): boolean {
  if (process.env.DEVFORGE_DOCKER_TEST !== "1" || !hasCommand("docker")) return false;
  return spawnSync("docker", ["info"], { encoding: "utf8", timeout: 15000 }).status === 0;
}

/** True when psql can reach a PostgreSQL server using the PG* environment variables. */
export function hasPostgres(): boolean {
  if (!hasCommand("psql") || !hasCommand("createdb")) return false;
  return spawnSync("psql", ["-X", "-q", "-d", "postgres", "-c", "SELECT 1"], { encoding: "utf8", timeout: 5000 }).status === 0;
}

export function hasCommand(cmd: string): boolean {
  return spawnSync("bash", ["-c", `command -v ${cmd}`], { encoding: "utf8" }).status === 0;
}
