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
export function lessonNeeds(track: string, order: number): { api: boolean; apiPort: number; timeoutMs: number } {
  // Only the reverse-proxy lesson (order 2) proxies to an API, which learners run on port 8080.
  const nginxProxy = track === "nginx" && order === 2;
  const timeouts: Record<string, number> = { kubernetes: 900_000, jenkins: 300_000, terraform: 180_000, "prometheus-grafana": 300_000, opentelemetry: 300_000, kafka: 300_000, postman: 300_000, airflow: 420_000, mlflow: 300_000, "langchain-llamaindex": 300_000, n8n: 300_000, docker: 300_000 };
  return {
    api: track === "postman" || track === "prometheus-grafana" || nginxProxy,
    apiPort: nginxProxy ? 8080 : 0,
    timeoutMs: timeouts[track] ?? 60_000,
  };
}

/** Programs some lessons run that are not part of a basic system: CI installs them; locally, lessons that need them are skipped. */
export const OPTIONAL_TOOLS = ["prometheus", "promtool", "grafana", "otelcol", "jaeger"] as const;

/** Which OPTIONAL_TOOLS the blocks run (as a command, not as part of a file or folder name). */
export function toolsUsed(blocks: RunBlock[]): string[] {
  return OPTIONAL_TOOLS.filter((tool) => blocks.some((b) => new RegExp(`(^|[\\s;&|(])${tool}\\s`, "m").test(b.code)));
}

/** Lessons that start Nginx (with a per-lesson prefix: nginx -p). */
export function usesNginx(blocks: RunBlock[]): boolean {
  return blocks.some((b) => /\bnginx -p\b/.test(b.code));
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
  if (needsDb) cleanup.push(`dropdb --if-exists "$DEVFORGE_PGDATABASE" >/dev/null 2>&1 || true`);
  // Delete any kind cluster a lesson creates, even if a later command fails.
  for (const name of new Set(blocks.flatMap((b) => [...b.code.matchAll(/\bkind create cluster --name ([a-z0-9-]+)/g)].map((m) => m[1] ?? "")))) {
    if (name) cleanup.push(`kind delete cluster --name ${name} >/dev/null 2>&1 || true`);
  }
  if (usesNginx(blocks)) {
    cleanup.push(`for f in $(find "${work}" -name nginx.pid 2>/dev/null); do kill "$(cat "$f")" 2>/dev/null || true; done`);
  }
  // Remove containers a lesson starts with docker run --name, so the next run can reuse the name.
  for (const name of new Set(blocks.flatMap((b) => [...b.code.matchAll(/\bdocker run\b[^\n]*?--name[ =]([a-zA-Z0-9][\w.-]*)/g)].map((m) => m[1] ?? "")))) {
    if (name) cleanup.push(`docker rm -f ${name} >/dev/null 2>&1 || true`);
  }
  // Take down Compose projects (docker compose -p name …) with their volumes, then user-defined networks.
  for (const name of new Set(blocks.flatMap((b) => [...b.code.matchAll(/\bdocker compose -p ([a-z0-9][a-z0-9_-]*)/g)].map((m) => m[1] ?? "")))) {
    if (name) cleanup.push(`docker compose -p ${name} down -v --remove-orphans >/dev/null 2>&1 || true`);
  }
  for (const name of new Set(blocks.flatMap((b) => [...b.code.matchAll(/\bdocker network create ([a-zA-Z0-9][\w.-]*)/g)].map((m) => m[1] ?? "")))) {
    if (name) cleanup.push(`docker network rm ${name} >/dev/null 2>&1 || true`);
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
    ...(cleanup.length ? [`devforge_cleanup() { ${cleanup.join("; ")}; }`, "trap devforge_cleanup EXIT"] : []),
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
