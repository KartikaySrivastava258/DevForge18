import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadContent } from "./content-loader.ts";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dockerTestingEnabled, extractRunBlocks, hasCommand, hasPostgres, lessonNeeds, toolsUsed, usesDocker, outputMatches, redisTestingEnabled, runLesson, usesNginx, usesPostgres, usesRedis } from "./lesson-runner.ts";
import { splitFrontMatter } from "./markdown.ts";
import { startPracticeServer } from "./practice-server.ts";

describe("outputMatches", () => {
  it("compares exactly, ignoring trailing spaces and surrounding blank lines", () => {
    assert.ok(outputMatches("a\nb", "\na  \nb\n\n"));
    assert.ok(!outputMatches("a\nb", "a\nc"));
  });
  it("supports … inside a line and … as a whole line", () => {
    assert.ok(outputMatches("Initialized empty Git repository in …/notes/.git/", "Initialized empty Git repository in /tmp/x/work/notes/.git/"));
    assert.ok(outputMatches("first\n…\nlast", "first\nx\ny\nlast"));
    assert.ok(outputMatches("first\n…\nlast", "first\nlast"));
    assert.ok(!outputMatches("first\n…\nlast", "first\nx\nnot-last"));
  });
});

describe("runLesson", () => {
  it("keeps state between blocks, isolates HOME, and detects mismatches", () => {
    const blocks = extractRunBlocks(
      "```bash run\nmkdir d && cd d\necho hi > f\n```\n```text output\n```\n```bash run\ncat f; echo \"$HOME\" | grep -c devforge-lesson\n```\n```text output\nhi\n1\n```\n```bash run fails\nfalse\n```\n```bash run\necho wrong\n```\n```text output\nright\n```",
    );
    assert.equal(blocks.length, 4);
    const run = runLesson(blocks);
    assert.deepEqual(run.results.map((r) => r.ok), [true, true, true, false]);
  });
  it("reports where an unexpected failure stopped the script", () => {
    const run = runLesson(extractRunBlocks("```bash run\necho before\nfalse\n```\n```bash run\necho never\n```"));
    assert.ok(run.failure?.includes("before"));
    assert.equal(run.results[1]?.ok, false);
  });
});

describe("SQL blocks", () => {
  it("pipe SQL to psql in a throwaway database and strip psql's script-only error prefix", () => {
    // Stub executables stand in for PostgreSQL's tools to test the plumbing (real psql runs in CI).
    const bin = mkdtempSync(join(tmpdir(), "devforge-pgstub-"));
    const log = join(bin, "calls.log");
    const stub = (name: string, body: string) => {
      writeFileSync(join(bin, name), `#!/bin/bash\necho "${name} $*" >> "${log}"\n${body}\n`);
      chmodSync(join(bin, name), 0o755);
    };
    stub("createdb", "exit 0");
    stub("dropdb", "exit 0");
    stub("psql", 'cat; echo "psql:<stdin>:2: ERROR:  example" >&2; exit 3');
    try {
      const blocks = extractRunBlocks("```sql run fails\nSELECT 1;\n```\n```text output\nSELECT 1;\nERROR:  example\n```");
      assert.ok(usesPostgres(blocks));
      const run = runLesson(blocks, { path: `${bin}:${process.env.PATH}` });
      assert.equal(run.results[0]?.ok, true, run.results[0]?.output ?? "no output");
      const calls = readFileSync(log, "utf8");
      assert.match(calls, /^createdb devforge_lesson_/m);
      assert.match(calls, /^psql -X -v ON_ERROR_STOP=1 -P pager=off -d devforge_lesson_/m);
      assert.match(calls, /^dropdb --if-exists devforge_lesson_/m);
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });
});

/** A killed process can linger as a zombie until its parent reaps it; that still counts as stopped. */
function isRunning(pid: number): boolean {
  try {
    const state = readFileSync(`/proc/${pid}/status`, "utf8").match(/^State:\s+(\S)/m)?.[1];
    return state !== undefined && state !== "Z" && state !== "X";
  } catch {
    try {
      process.kill(pid, 0); // no /proc (e.g. macOS): fall back to a signal check
      return true;
    } catch {
      return false;
    }
  }
}

/** Poll for up to three seconds; true once the process has stopped. */
function waitUntilStopped(pid: number): boolean {
  const deadline = Date.now() + 3000;
  while (isRunning(pid)) {
    if (Date.now() > deadline) return false;
    spawnSync("sleep", ["0.05"]);
  }
  return true;
}

describe("cleanup", () => {
  it("detects Nginx lessons and stops a background process even when a later block fails", () => {
    const blocks = extractRunBlocks("```bash run\n# nginx -p \"$PWD\" (simulated)\nsleep 300 & echo $! > nginx.pid\n```\n```bash run\nfalse\n```");
    assert.ok(usesNginx(blocks));
    let pid = 0;
    const run = runLesson([...blocks.slice(0, 1), { index: 1, code: "cat nginx.pid", kind: "bash", allowFail: false, expected: undefined }, { ...blocks[1]!, index: 2 }]);
    pid = Number(run.results[1]?.output.trim());
    assert.ok(pid > 0, "captured the background pid");
    assert.ok(run.failure !== undefined, "the failing block stopped the script");
    // kill delivers the signal asynchronously: allow the process a moment to exit before checking.
    assert.equal(waitUntilStopped(pid), true, "cleanup trap killed the background process");
  });
});

describe("background servers", () => {
  it("are stopped by the cleanup trap even when a later block fails", () => {
    const run = runLesson(extractRunBlocks("```bash run\nsleep 300 &\necho $!\n```\n```bash run\nfalse\n```"));
    const pid = Number(run.results[0]?.output.trim());
    assert.ok(pid > 0, "captured the background pid");
    assert.ok(run.failure !== undefined);
    assert.equal(waitUntilStopped(pid), true, "cleanup trap stopped the background job");
  });
  it("toolsUsed finds programs run as commands, not names of files or folders", () => {
    const used = toolsUsed(extractRunBlocks("```bash run\nmkdir prometheus-lab && cd prometheus-lab\npromtool check config prometheus.yml\notelcol --config=x.yaml &\nkill $(cat jaeger.pid)\n```"));
    assert.deepEqual(used, ["promtool", "otelcol"]);
  });
  it("lessonNeeds gives every track one shared answer", () => {
    assert.deepEqual(lessonNeeds("prometheus-grafana", 1), { api: true, apiPort: 0, timeoutMs: 180_000 });
    assert.deepEqual(lessonNeeds("nginx", 2), { api: true, apiPort: 8080, timeoutMs: 60_000 });
    assert.deepEqual(lessonNeeds("nginx", 1), { api: false, apiPort: 0, timeoutMs: 60_000 });
    assert.equal(lessonNeeds("kubernetes", 1).timeoutMs, 900_000);
    assert.equal(lessonNeeds("airflow", 3).timeoutMs, 420_000);
    assert.equal(lessonNeeds("mlflow", 1).timeoutMs, 300_000);
    assert.equal(lessonNeeds("langchain-llamaindex", 3).timeoutMs, 300_000);
  });
});

describe("docker containers", () => {
  it("started with docker run --name are removed by the cleanup trap even when a later block fails", () => {
    const bin = mkdtempSync(join(tmpdir(), "devforge-dockerstub-"));
    const log = join(bin, "calls.log");
    writeFileSync(join(bin, "docker"), `#!/bin/bash\necho "docker $*" >> "${log}"\n`);
    chmodSync(join(bin, "docker"), 0o755);
    try {
      const run = runLesson(extractRunBlocks("```bash run\ndocker run -d --name devforge-lab -p 127.0.0.1:9092:9092 image:1\n```\n```bash run\nfalse\n```"), { path: `${bin}:${process.env.PATH}` });
      assert.ok(run.failure !== undefined);
      assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), ["docker run -d --name devforge-lab -p 127.0.0.1:9092:9092 image:1", "docker rm -f devforge-lab"]);
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });
});

describe("kind clusters", () => {
  it("are deleted by the cleanup trap even when a later block fails", () => {
    const bin = mkdtempSync(join(tmpdir(), "devforge-kindstub-"));
    const log = join(bin, "calls.log");
    writeFileSync(join(bin, "kind"), `#!/bin/bash\necho "kind $*" >> "${log}"\n`);
    chmodSync(join(bin, "kind"), 0o755);
    try {
      const run = runLesson(extractRunBlocks("```bash run\nkind create cluster --name lab\n```\n```bash run\nfalse\n```"), { path: `${bin}:${process.env.PATH}` });
      assert.ok(run.failure !== undefined);
      assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), ["kind create cluster --name lab", "kind delete cluster --name lab"]);
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });
});

describe("Redis blocks", () => {
  it("refuse to run without the explicit flush opt-in", () => {
    const blocks = extractRunBlocks("```redis run\nPING\n```");
    assert.ok(usesRedis(blocks));
    assert.throws(() => runLesson(blocks), /Refusing to run a Redis lesson/);
    assert.ok(usesRedis(extractRunBlocks("```bash run\nredis-cli GET x\n```")), "bash blocks that call redis-cli count too");
  });
  it("flush first, then pipe commands to redis-cli --no-raw", () => {
    const bin = mkdtempSync(join(tmpdir(), "devforge-redisstub-"));
    const log = join(bin, "calls.log");
    writeFileSync(join(bin, "redis-cli"), `#!/bin/bash\necho "redis-cli $*" >> "${log}"\nif [ "$1" = "--no-raw" ]; then cat; fi\n`);
    chmodSync(join(bin, "redis-cli"), 0o755);
    try {
      const blocks = extractRunBlocks('```redis run\nSET greeting "Hello"\n```\n```text output\nSET greeting "Hello"\n```');
      const run = runLesson(blocks, { path: `${bin}:${process.env.PATH}`, allowRedisFlush: true });
      assert.equal(run.results[0]?.ok, true, run.results[0]?.output ?? "no output");
      assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), ["redis-cli FLUSHDB", "redis-cli --no-raw"]);
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });
});

// Every executed lesson in the repository must still produce exactly the output it shows.
const contentRoot = join(import.meta.dirname, "..", "..", "content");
const { bundle } = loadContent(contentRoot);
describe("executed lessons reproduce their documented output", () => {
  const postgresAvailable = hasPostgres();
  const redisAvailable = redisTestingEnabled();
  const dockerAvailable = dockerTestingEnabled();
  for (const lesson of bundle.lessons.filter((l) => l.verification.method !== "docs-checked")) {
    const needsGit = ["git-github", "github-actions", "jenkins"].includes(lesson.track);
    const ownBlocks = extractRunBlocks(splitFrontMatter(readFileSync(join(contentRoot, "lessons", lesson.track, `${lesson.id}.md`), "utf8"))?.body ?? "");
    const needsPg = lesson.track === "postgresql";
    const needsNginx = lesson.track === "nginx";
    const { api: needsApi, apiPort, timeoutMs } = lessonNeeds(lesson.track, lesson.order);
    const blocksOf = (id: string, track: string) =>
      extractRunBlocks(splitFrontMatter(readFileSync(join(contentRoot, "lessons", track, `${id}.md`), "utf8"))?.body ?? "");
    // Students continue from earlier lessons, so executed prerequisites are replayed first.
    const chain: string[] = [];
    const visit = (id: string) => {
      const l = bundle.lessons.find((x) => x.id === id);
      if (!l || chain.includes(id)) return;
      l.prerequisites.forEach(visit);
      if (l.verification.method !== "docs-checked") chain.push(id);
    };
    lesson.prerequisites.forEach(visit);
    const setupBlocks = chain.flatMap((id) => blocksOf(id, bundle.lessons.find((x) => x.id === id)?.track ?? lesson.track));
    // A lesson that continues from a Docker lesson replays its docker commands too, so it needs the same opt-in.
    const needsDocker = lesson.track === "docker" || usesDocker([...setupBlocks, ...ownBlocks]);
    const missingTools = toolsUsed([...setupBlocks, ...ownBlocks]).filter((tool) => !hasCommand(tool) || (tool === "grafana" && !process.env.GRAFANA_HOME));
    const needsRedis = lesson.track === "redis";
    const skip =
      needsGit && !hasCommand("git")
        ? "git not installed"
        : needsPg && !postgresAvailable
          ? "no PostgreSQL server reachable (runs in CI)"
          : needsApi && !hasCommand("curl")
            ? "curl not installed"
            : needsRedis && !redisAvailable
              ? "Redis lessons run only with DEVFORGE_REDIS_TEST=1 and a reachable server (CI)"
              : needsNginx && !hasCommand("nginx")
                ? "nginx not installed (runs in CI)"
                : lesson.track === "kubernetes" && !(dockerAvailable && hasCommand("kind") && hasCommand("kubectl"))
                  ? "Kubernetes lessons need DEVFORGE_DOCKER_TEST=1, Docker, kind and kubectl (CI)"
                : lesson.track === "terraform" && !hasCommand("terraform")
                  ? "terraform not installed (runs in CI)"
                : missingTools.length
                  ? `${missingTools.join(", ")} not installed${missingTools.includes("grafana") ? " (or GRAFANA_HOME not set)" : ""} (runs in CI)`
                : needsDocker && !dockerAvailable
                  ? "Docker lessons run only with DEVFORGE_DOCKER_TEST=1 and a Docker engine (CI)"
                  : false;
    it(`${lesson.id} (${lesson.verification.method})`, { skip }, async (t) => {
      // HTTP lessons practise against a real DevForge server, exposed to the lesson as $API.
      let api;
      try {
        api = needsApi ? await startPracticeServer(contentRoot, apiPort) : undefined;
      } catch (err) {
        // Nginx lessons need DevForge's real port; another program on this machine may already use it.
        if (apiPort !== 0 && String(err).includes("EADDRINUSE")) {
          t.skip(`port ${apiPort} is in use by another program on this machine (find it with: ss -ltnp 'sport = :${apiPort}')`);
          return;
        }
        throw err;
      }
      // Prerequisites' outputs are checked by their own tests; here they only need to succeed.
      // (pending prerequisites are replayed too: they are part of the learner's state)
      const setup = setupBlocks.map((b) => ({ ...b, expected: undefined }));
      const own = blocksOf(lesson.id, lesson.track);
      const blocks = [...setup, ...own].map((b, index) => ({ ...b, index }));
      let run;
      try {
        run = runLesson(blocks, {
          ...(api ? { env: { API: api.url } } : {}),
          allowRedisFlush: needsRedis && redisAvailable,
          timeoutMs,
        });
      } finally {
        await api?.close();
      }
      const bad = run.results.filter((r) => !r.ok);
      const report = bad
        .map((r) => `--- block ${r.index}:\n${r.code}\n--- expected:\n${r.expected ?? "(no output block; command must succeed)"}\n--- actual:\n${r.output}`)
        .join("\n");
      assert.equal(bad.length, 0, `${run.failure ? `Script stopped early:\n${run.failure}\n` : ""}${report}`);
    });
  }
});
