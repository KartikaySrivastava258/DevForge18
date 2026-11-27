#!/usr/bin/env bash
# Acceptance check for "Multi-version test matrix".
# Usage: bash check.sh path/to/campus-search
# Needs Docker and Node.js (and internet access to pull the pinned images and the YAML parser the first time).
# Reads .github/workflows/test.yml, expands its matrix the way GitHub does (include/exclude), and RUNS the job
# once per combination in the matching pinned Node.js container (22, 24 and 26): your steps really execute.
# Then it runs DevForge's hidden tests on every version. Prints PASS or FAIL per criterion; exits non-zero on any FAIL.
set -uo pipefail
dir="$(cd "${1:-.}" 2> /dev/null && pwd)" || { echo "FAIL: folder ${1:-.} not found"; exit 1; }
for tool in docker node; do command -v "$tool" > /dev/null || { echo "FAIL: this check needs $tool"; exit 1; }; done
node24="node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9"  # published 2026-11-05
export CHECK_PREFIX="devforge-check-gha-$$"
tools="$(mktemp -d)"
cleanup() {
  docker ps -aq --filter "name=$CHECK_PREFIX" | xargs -r docker rm -f -v > /dev/null 2>&1
  rm -rf "$tools"
}
trap cleanup EXIT
mkdir -p "$tools/work"
# js-yaml 4.3.2 (published 2026-08-26) and its one dependency, pinned by integrity hash: the same YAML parser
# and safe schema that DevForge's own workflow checker uses. npm installs it in a container, into $tools only.
cat > "$tools/package.json" << 'EOF'
{ "name": "devforge-check-tools", "version": "1.0.0", "private": true, "dependencies": { "js-yaml": "4.3.2" } }
EOF
cat > "$tools/package-lock.json" << 'EOF'
{
  "name": "devforge-check-tools", "version": "1.0.0", "lockfileVersion": 3, "requires": true,
  "packages": {
    "": { "name": "devforge-check-tools", "version": "1.0.0", "dependencies": { "js-yaml": "4.3.2" } },
    "node_modules/argparse": { "version": "2.0.1", "resolved": "https://registry.npmjs.org/argparse/-/argparse-2.0.1.tgz",
      "integrity": "sha512-8+9WqebbFzpX9OR+Wa6O29asIogeRMzcGtAINdpMHHyAg10f05aSFVBbcEqGf/PXw1EjAZ+q2/bEBg3DvurK3Q==" },
    "node_modules/js-yaml": { "version": "4.3.2", "resolved": "https://registry.npmjs.org/js-yaml/-/js-yaml-4.3.2.tgz",
      "integrity": "sha512-SFNOvSJ+Dgf/9An904Yx+CgSlIPCkIpao4qo51lpee25TIRejdH3rhR4EZMGoNx3/TP3O+wzWuiTFl4sqbltzA==",
      "dependencies": { "argparse": "^2.0.1" }, "bin": { "js-yaml": "bin/js-yaml.js" } }
  }
}
EOF
if ! out="$(docker run --rm --name "$CHECK_PREFIX-npm" --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$tools:/t" -w /t "$node24" npm ci --ignore-scripts --no-audit --no-fund 2>&1)"; then
  echo "FAIL: could not install the YAML parser (needs internet access the first time): $(echo "$out" | tail -n 3 | tr '\n' ' ')"
  exit 1
fi
cat > "$tools/check.mjs" << 'JS'
// ---- A local GitHub Actions runner model (DevForge) -------------------------------------------------------
// Parses workflows with js-yaml's CORE_SCHEMA (as DevForge's own workflow checker does: "on" stays a key,
// no type surprises), then runs jobs in pinned Node.js containers with no network. Steps with "run" are
// executed for real; these actions are modelled: checkout (copies your folder, without node_modules),
// setup-node (chooses the container's Node.js version), cache (no-op), upload-artifact / download-artifact
// (copy files between jobs), attest (records the subject's SHA-256). It is not GitHub: expressions are
// limited to context lookups (github.*, matrix.*, inputs.*, env.*, secrets.*, vars.*, a || b), and "if:"
// conditions are only checked for always(), failure() and cancelled().
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");
const NODE_IMAGES = {
  // Official Node.js images (Debian bookworm, slim), pinned by digest; all three published 2026-11-05.
  22: "node:22.23.4-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d",
  24: "node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9",
  26: "node:26.13.0-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68",
};
const repo = process.argv[2];
const work = process.argv[3];
let failures = 0;
let counter = 0;
const PREFIX = process.env.CHECK_PREFIX || `devforge-check-gha-${process.pid}`;
const pass = (m) => console.log(`PASS: ${m}`);
const fail = (m) => {
  failures++;
  console.log(`FAIL: ${m}`);
};
const check = (ok, good, bad) => (ok ? pass(good) : fail(bad));
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const asList = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const tmp = (prefix) => mkdtempSync(join(work, `${prefix}-`));

function loadWorkflows(dir) {
  const out = new Map();
  const wfDir = join(dir, ".github", "workflows");
  if (!existsSync(wfDir)) return out;
  for (const file of readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const source = readFileSync(join(wfDir, file), "utf8");
    try {
      out.set(file, { file, source, doc: yaml.load(source, { schema: yaml.CORE_SCHEMA }) });
    } catch (err) {
      out.set(file, { file, source, error: String(err.message).split("\n")[0] });
    }
  }
  return out;
}
/** The events of a workflow as an object: on: push, on: [push, pull_request] and the mapping form. */
function events(doc) {
  const on = doc?.on;
  if (typeof on === "string") return { [on]: null };
  if (Array.isArray(on)) return Object.fromEntries(on.map((e) => [e, null]));
  return isObj(on) ? on : {};
}
const jobsOf = (doc) => (isObj(doc?.jobs) ? Object.entries(doc.jobs).filter(([, j]) => isObj(j)) : []);
const stepsOf = (job) => (Array.isArray(job.steps) ? job.steps.filter(isObj) : []);
/** The permissions a job's token gets: the job's own block, else the workflow's, else undefined (repository default). */
const permissionsOf = (doc, job) => ("permissions" in job ? job.permissions : "permissions" in doc ? doc.permissions : undefined);
function writeScopes(perms) {
  if (perms === undefined) return ["(not declared: the repository default may include write access)"];
  if (typeof perms === "string") return perms === "read-all" ? [] : [perms];
  if (!isObj(perms)) return [];
  return Object.entries(perms).filter(([, v]) => v === "write").map(([k]) => k);
}
function parseUses(uses) {
  const m = /^([^@\s]+)@(\S+)$/.exec(String(uses));
  if (!m) return { name: String(uses), ref: "" };
  const parts = m[1].split("/");
  return { name: parts.slice(0, 2).join("/"), path: parts.slice(2).join("/"), ref: m[2] };
}
const isSha = (ref) => /^[0-9a-f]{40}$/.test(ref);
const isVersionTag = (ref) => /^v\d+(\.\d+){0,2}$/.test(ref);
/** Every "uses:" in a workflow, at step level and job level (reusable workflow calls). */
function allUses(doc) {
  const out = [];
  for (const [jobId, job] of jobsOf(doc)) {
    if (typeof job.uses === "string") out.push({ jobId, uses: job.uses, level: "job" });
    for (const step of stepsOf(job)) if (typeof step.uses === "string") out.push({ jobId, uses: step.uses, level: "step" });
  }
  return out;
}
const isLocal = (uses) => uses.startsWith("./") || uses.startsWith("docker://");

/** GitHub's matrix rules: the product of the keys, minus exclude (partial match), then include. */
function expandMatrix(strategy) {
  const m = isObj(strategy) ? strategy.matrix : undefined;
  if (!isObj(m)) return [{}];
  const keys = Object.keys(m).filter((k) => k !== "include" && k !== "exclude");
  let combos = keys.length ? [{}] : [];
  for (const k of keys) combos = combos.flatMap((c) => asList(m[k]).map((v) => ({ ...c, [k]: v })));
  const same = (a, b) => String(a) === String(b);
  combos = combos.filter((c) => !asList(m.exclude).some((e) => isObj(e) && Object.entries(e).every(([k, v]) => same(c[k], v))));
  const original = combos.map((c) => ({ ...c }));
  for (const inc of asList(m.include).filter(isObj)) {
    let added = false;
    combos.forEach((c, i) => {
      if (Object.entries(inc).every(([k, v]) => !(k in original[i]) || same(original[i][k], v))) {
        Object.assign(c, inc);
        added = true;
      }
    });
    if (!added) {
      combos.push({ ...inc });
      original.push({ ...inc });
    }
  }
  return combos.length ? combos : [{}];
}

function evalExpr(expr, ctx) {
  const e = expr.trim();
  if (e.includes("||")) {
    for (const part of e.split("||")) {
      const v = evalExpr(part, ctx);
      if (v !== "" && v !== "false") return v;
    }
    return "";
  }
  if (/^'.*'$/.test(e)) return e.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(e) || e === "true" || e === "false") return e;
  if (!/^[A-Za-z_][\w-]*(\.[\w-]+)*$/.test(e)) {
    ctx.unknown.add(e);
    return "";
  }
  let v = ctx;
  for (const p of e.split(".")) v = v !== null && typeof v === "object" ? v[p] : undefined;
  if (v === undefined || v === ctx.unknown) {
    ctx.unknown.add(e);
    return "";
  }
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}
const subst = (text, ctx) => String(text ?? "").replace(/\$\{\{([\s\S]*?)\}\}/g, (_, x) => evalExpr(x, ctx));
const substAll = (obj, ctx) => Object.fromEntries(Object.entries(isObj(obj) ? obj : {}).map(([k, v]) => [k, subst(v, ctx)]));
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/**
 * Plans one job instance (one matrix combination) as a bash script, and runs it in a container.
 * opts: { event: { name, ref, refName, sha }, matrix, inputs, image (override), stubs: { name: script } }
 */
function runJobInstance(wf, jobId, job, opts, srcDir, artifactsDir) {
  const ctx = {
    unknown: new Set(),
    github: {
      event_name: opts.event.name, ref: opts.event.ref, ref_name: opts.event.refName, ref_type: opts.event.ref.startsWith("refs/tags/") ? "tag" : "branch",
      sha: opts.event.sha, repository: "devforge-example/campus-project", repository_owner: "devforge-example", run_id: "1", run_number: "1",
      token: "example-token-not-real", workspace: "/github/workspace", actor: "student", job: jobId,
    },
    secrets: { GITHUB_TOKEN: "example-token-not-real" },
    matrix: opts.matrix ?? {}, inputs: opts.inputs ?? {}, vars: {}, runner: { os: "Linux", temp: "/tmp" }, needs: {}, steps: {}, env: {},
  };
  ctx.env = { ...substAll(wf.doc.env, ctx) };
  ctx.env = { ...ctx.env, ...substAll(job.env, ctx) };
  const steps = stepsOf(job);
  let nodeMajor = "24";
  for (const step of steps) {
    if (typeof step.uses === "string" && parseUses(step.uses).name === "actions/setup-node") {
      const wanted = subst(step.with?.["node-version"] ?? "", ctx).trim();
      nodeMajor = /^v?(\d+)/.exec(wanted)?.[1] ?? `unsupported:${wanted || "(none)"}`;
    }
  }
  const image = opts.image ?? NODE_IMAGES[nodeMajor];
  const runner = tmp("runner");
  const ws = tmp("ws");
  const report = tmp("report");
  const lines = [
    "#!/bin/bash",
    "set -u",
    'export HOME=/tmp CI=true GITHUB_ACTIONS=true GITHUB_WORKSPACE=/github/workspace RUNNER_OS=Linux RUNNER_TEMP=/tmp',
    `export GITHUB_REF=${q(ctx.github.ref)} GITHUB_REF_NAME=${q(ctx.github.ref_name)} GITHUB_REF_TYPE=${q(ctx.github.ref_type)} GITHUB_SHA=${q(ctx.github.sha)}`,
    `export GITHUB_EVENT_NAME=${q(ctx.github.event_name)} GITHUB_REPOSITORY=${q(ctx.github.repository)} GITHUB_JOB=${q(jobId)}`,
    "export GITHUB_ENV=/tmp/github_env GITHUB_OUTPUT=/tmp/github_output GITHUB_PATH=/tmp/github_path GITHUB_STEP_SUMMARY=/tmp/summary",
    ": > $GITHUB_ENV; : > $GITHUB_OUTPUT; : > $GITHUB_PATH",
    opts.stubs ? 'export PATH="/runner/stubs:$PATH"' : "",
    "failed=0",
    "cd /github/workspace",
    'apply_env() { while IFS= read -r line; do case "$line" in *=*) export "${line%%=*}=${line#*=}" ;; esac; done < "$GITHUB_ENV"; : > "$GITHUB_ENV";',
    '  while IFS= read -r p; do [ -n "$p" ] && export PATH="$p:$PATH"; done < "$GITHUB_PATH"; : > "$GITHUB_PATH"; }',
    'step() { local n="$1" cond="$2" coe="$3"; shift 3',
    '  if { [ "$cond" = success ] && [ "$failed" -ne 0 ]; } || [ "$cond" = never ]; then echo "$n skipped" >> /report/steps; return; fi',
    '  ( cd /github/workspace && "$@" ) > "/report/step-$n.log" 2>&1; local rc=$?',
    '  echo "$n $rc" >> /report/steps; apply_env',
    '  if [ "$rc" -ne 0 ] && [ "$coe" != true ]; then failed=1; fi; }',
  ];
  if (!image) {
    rmSync(runner, { recursive: true, force: true });
    return { jobId, matrix: opts.matrix, ok: false, error: `Node.js ${nodeMajor.replace("unsupported:", "")} is not a version this check can run (22, 24 or 26)`, steps: [] };
  }
  const described = [];
  steps.forEach((step, i) => {
    const n = i + 1;
    const ifText = String(step.if ?? "");
    const cond = /failure\(\)|cancelled\(\)/.test(ifText) ? "never" : /always\(\)/.test(ifText) ? "always" : "success";
    const coe = String(step["continue-on-error"]) === "true" ? "true" : "false";
    const env = { ...ctx.env, ...substAll(step.env, ctx) };
    const exports = Object.entries(env).map(([k, v]) => `export ${k}=${q(v)}`).join("\n");
    let body;
    let kind;
    if (typeof step.run === "string") {
      kind = "run";
      writeFileSync(join(runner, `run-${n}.sh`), subst(step.run, ctx) + "\n");
      const shell = step.shell ?? job.defaults?.run?.shell ?? wf.doc.defaults?.run?.shell;
      const cmd = shell === "bash" ? "bash --noprofile --norc -eo pipefail" : shell === "sh" ? "sh -e" : "bash -e";
      const wd = subst(step["working-directory"] ?? job.defaults?.run?.["working-directory"] ?? wf.doc.defaults?.run?.["working-directory"] ?? ".", ctx);
      body = `${exports}\ncd ${q(wd)} || exit 1\nexec ${cmd} /runner/run-${n}.sh\n`;
    } else if (typeof step.uses === "string") {
      const { name } = parseUses(step.uses);
      const w = substAll(step.with, ctx);
      kind = name;
      if (name === "actions/checkout") body = "tar -C /src --exclude=./node_modules -cf - . | tar -C /github/workspace -xf -\necho checked out\n";
      else if (name === "actions/setup-node") body = `echo "Node.js $(node --version)"\n`;
      else if (name === "actions/upload-artifact") {
        const paths = (w.path ?? "").split("\n").map((p) => p.trim()).filter(Boolean);
        const art = w.name || "artifact";
        body = [
          "shopt -s nullglob globstar",
          `dest=/artifacts/${q(art)}; [ -e "$dest" ] && { echo "an artifact named ${art} already exists"; exit 1; }; mkdir -p "$dest"`,
          paths.length === 1 && !/[*?]/.test(paths[0])
            ? `if [ -d ${q(paths[0])} ]; then cp -a ${q(paths[0])}/. "$dest"/; elif [ -f ${q(paths[0])} ]; then cp -a ${q(paths[0])} "$dest"/; fi`
            : paths.map((p) => `for f in ${p.replace(/'/g, "")}; do cp -a "$f" "$dest"/; done`).join("\n"),
          `if [ -z "$(ls -A "$dest")" ]; then rmdir "$dest"; echo "no files found for ${paths.join(", ")}"; ${w["if-no-files-found"] === "error" ? "exit 1" : "exit 0"}; fi`,
          `echo "uploaded artifact ${art}: $(cd "$dest" && find . -type f | sort | tr '\\n' ' ')"`,
        ].join("\n");
      } else if (name === "actions/download-artifact") {
        const dest = w.path || ".";
        body = w.name
          ? `[ -d /artifacts/${q(w.name)} ] || { echo "Artifact not found: ${w.name}"; exit 1; }\nmkdir -p ${q(dest)} && cp -a /artifacts/${q(w.name)}/. ${q(dest)}/\necho "downloaded ${w.name} into ${dest}"`
          : `for a in /artifacts/*/; do n=$(basename "$a"); mkdir -p ${q(dest)}/"$n" && cp -a "$a". ${q(dest)}/"$n"/; done`;
      } else if (name === "actions/attest") {
        const subject = w["subject-path"] ?? "";
        body = subject
          ? `shopt -s nullglob; found=0; for f in ${subject.replace(/'/g, "")}; do sha256sum "$f" | cut -d' ' -f1 >> /artifacts/.attested; found=1; echo "attested $f"; done; [ "$found" = 1 ] || { echo "no file matches subject-path ${subject}"; exit 1; }`
          : `echo "attest without subject-path: not modelled"`;
      } else body = `echo "${name}: not modelled by this check (treated as successful)"\n`;
      body = `${exports}\n${body}\n`;
    } else {
      kind = "invalid";
      body = 'echo "a step needs run or uses"; exit 1\n';
    }
    writeFileSync(join(runner, `step-${n}.sh`), body);
    described.push({ n, name: step.name ?? (step.run ? String(step.run).split("\n")[0] : step.uses), kind, run: typeof step.run === "string" ? step.run : null, uses: step.uses ?? null });
    lines.push(`step ${n} ${cond} ${coe} bash /runner/step-${n}.sh`);
  });
  lines.push('exit "$failed"');
  writeFileSync(join(runner, "job.sh"), lines.join("\n") + "\n");
  if (opts.stubs) {
    mkdirSync(join(runner, "stubs"));
    for (const [name, script] of Object.entries(opts.stubs)) {
      writeFileSync(join(runner, "stubs", name), script);
      chmodSync(join(runner, "stubs", name), 0o755);
    }
  }
  const container = `${PREFIX}-${++counter}`;
  const uid = typeof process.getuid === "function" ? `${process.getuid()}:${process.getgid()}` : "1000:1000";
  const run = spawnSync("docker", ["run", "--rm", "--name", container, "--network", "none", "--user", uid,
    "-v", `${srcDir}:/src:ro`, "-v", `${ws}:/github/workspace`, "-v", `${artifactsDir}:/artifacts`, "-v", `${runner}:/runner:ro`, "-v", `${report}:/report`,
    "-w", "/github/workspace", "--entrypoint", "bash", image, "/runner/job.sh"], { encoding: "utf8", timeout: 240_000 });
  if (run.error || run.status === null) spawnSync("docker", ["rm", "-f", "-v", container]);
  const statuses = existsSync(join(report, "steps")) ? readFileSync(join(report, "steps"), "utf8").trim().split("\n").filter(Boolean) : [];
  const result = described.map((d) => {
    const line = statuses.find((l) => l.split(" ")[0] === String(d.n));
    const st = line ? line.split(" ")[1] : "not run";
    const logFile = join(report, `step-${d.n}.log`);
    return { ...d, status: st === "0" ? "success" : st === "skipped" || st === "not run" ? "skipped" : "failure", log: existsSync(logFile) ? readFileSync(logFile, "utf8") : "" };
  });
  rmSync(runner, { recursive: true, force: true });
  rmSync(report, { recursive: true, force: true });
  return {
    jobId, matrix: opts.matrix, ok: run.status === 0, steps: result, workspace: ws, image, nodeMajor, unknown: [...ctx.unknown],
    error: run.status === 0 ? "" : run.error ? String(run.error.message) : run.stderr.trim().split("\n").slice(-3).join(" "),
  };
}

/** Orders jobs by needs, expands matrices and local reusable workflows, and runs everything like one workflow run. */
function runWorkflow(workflows, file, event, srcDir, extra = {}) {
  const wf = workflows.get(file);
  const artifacts = tmp("artifacts");
  const results = [];
  const status = {};
  const jobs = Object.fromEntries(jobsOf(wf.doc));
  const order = [];
  const visit = (id, seen = new Set()) => {
    if (order.includes(id) || seen.has(id) || !jobs[id]) return;
    seen.add(id);
    for (const dep of asList(jobs[id].needs)) visit(dep, seen);
    order.push(id);
  };
  Object.keys(jobs).forEach((id) => visit(id));
  for (const id of order) {
    const job = jobs[id];
    const blocked = asList(job.needs).filter((dep) => status[dep] !== "success");
    if (blocked.length && !/always\(\)/.test(String(job.if ?? ""))) {
      status[id] = "skipped";
      results.push({ jobId: id, skipped: true, ok: false, steps: [], blockedBy: blocked });
      continue;
    }
    let ok = true;
    for (const matrix of expandMatrix(job.strategy)) {
      if (typeof job.uses === "string") {
        const called = workflows.get(job.uses.replace(/^\.\/\.github\/workflows\//, ""));
        if (!job.uses.startsWith("./.github/workflows/") || !called?.doc) {
          ok = false;
          results.push({ jobId: id, ok: false, steps: [], error: `cannot run ${job.uses} locally` });
          continue;
        }
        const callCtx = { unknown: new Set(), matrix, github: { ref: event.ref, ref_name: event.refName, sha: event.sha, event_name: event.name }, inputs: {}, secrets: {}, vars: {}, env: {} };
        const declared = isObj(called.doc.on?.workflow_call?.inputs) ? called.doc.on.workflow_call.inputs : {};
        const inputs = Object.fromEntries(Object.entries(declared).map(([k, spec]) => [k, isObj(spec) && "default" in spec ? String(spec.default) : ""]));
        Object.assign(inputs, substAll(job.with, callCtx));
        for (const [cid, cjob] of jobsOf(called.doc)) {
          for (const cm of expandMatrix(cjob.strategy)) {
            const r = runJobInstance(called, `${id}/${cid}`, cjob, { event, matrix: cm, inputs, ...(extra[id] ?? {}) }, srcDir, artifacts);
            r.callerMatrix = matrix;
            results.push(r);
            ok &&= r.ok;
          }
        }
      } else {
        const r = runJobInstance(wf, id, job, { event, matrix, ...(extra[id] ?? {}) }, srcDir, artifacts);
        results.push(r);
        ok &&= r.ok;
      }
    }
    status[id] = ok ? "success" : "failure";
  }
  return { results, status, artifacts };
}
/** A copy of the learner's folder (without node_modules) with some files replaced, for mutation runs. */
function mutate(changes) {
  const dir = tmp("mutant");
  cpSync(repo, dir, { recursive: true, filter: (p) => !p.split(/[\\/]/).includes("node_modules") });
  for (const [path, content] of Object.entries(changes)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    if (content === null) rmSync(join(dir, path), { force: true });
    else writeFileSync(join(dir, path), typeof content === "function" ? content(readFileSync(join(dir, path), "utf8")) : content);
  }
  return dir;
}
const failedStep = (results) => {
  for (const r of results) for (const s of r.steps ?? []) if (s.status === "failure") return { job: r.jobId, step: s };
  return null;
};
const describeFailure = (results) => {
  const f = failedStep(results);
  if (f) {
    const lines = f.step.log.trim().split("\n");
    const failed = lines.filter((l) => /^\s*(not ok \d+ - |✖ )/.test(l) && !/^\s*✖ failing tests/.test(l)).map((l) => l.trim());
    const detail = failed.length ? failed.slice(0, 4).join("; ") : lines.slice(-4).join(" | ");
    return `job ${f.job} failed at "${f.step.name}": ${detail.slice(0, 400)}`;
  }
  const e = results.find((r) => r.error);
  return e ? `job ${e.jobId}: ${e.error}` : "no job ran";
};
/** Runs a shell script in a pinned Node.js container (no network) with the given folder as /w. */
function inNode(major, dir, script) {
  const name = `${PREFIX}-${++counter}`;
  const uid = typeof process.getuid === "function" ? `${process.getuid()}:${process.getgid()}` : "1000:1000";
  const r = spawnSync("docker", ["run", "--rm", "--name", name, "--network", "none", "--user", uid, "-e", "HOME=/tmp", "-v", `${dir}:/w`, "-w", "/w",
    "--entrypoint", "bash", NODE_IMAGES[major], "-c", script], { encoding: "utf8", timeout: 180_000 });
  if (r.error || r.status === null) spawnSync("docker", ["rm", "-f", "-v", name]);
  return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}
function finish() {
  if (failures > 0) {
    console.log(`${failures} criterion check(s) failed.`);
    process.exit(1);
  }
  console.log("All criteria pass.");
}
const workflowsInRepo = loadWorkflows(repo);
for (const [file, wf] of workflowsInRepo) if (wf.error) fail(`.github/workflows/${file} is not valid YAML: ${wf.error}`);
// ---- end of the runner model; the project's criteria follow ----------------------------------------------
const HIDDEN_TESTS = "import assert from \"node:assert/strict\";\nimport { test } from \"node:test\";\nimport { decodeCursor, encodeCursor, highlight } from \"./src/index.js\";\n\ntest(\"regular-expression characters in the term match literally\", () => {\n  assert.equal(highlight(\"use [a-z] or a-z\", \"[a-z]\"), \"use <mark>[a-z]</mark> or a-z\");\n  assert.equal(highlight(\"costs $5, not 5\", \"$5\"), \"costs <mark>$5</mark>, not 5\");\n  assert.equal(highlight(\"a\\\\b and ab\", \"a\\\\b\"), \"<mark>a\\\\b</mark> and ab\");\n  assert.equal(highlight(\"x.y xzy\", \"x.y\"), \"<mark>x.y</mark> xzy\");\n});\ntest(\"cursors are base64url without padding (compatible with existing links)\", () => {\n  assert.equal(encodeCursor({ page: 2, q: \"data\" }), Buffer.from('{\"page\":2,\"q\":\"data\"}').toString(\"base64url\"));\n  assert.deepEqual(decodeCursor(Buffer.from('{\"page\":7,\"q\":\"\u00e4?\"}').toString(\"base64url\")), { page: 7, q: \"\u00e4?\" });\n  assert.doesNotMatch(encodeCursor({ q: \"???>>>\" }), /[+/=]/);\n});\ntest(\"invalid cursors are rejected with a TypeError\", () => {\n  assert.throws(() => decodeCursor(\"abc=def\"), TypeError);\n  assert.throws(() => decodeCursor(\"\"), TypeError);\n});\n";
// ---- Criteria: Multi-version test matrix --------------------------------------------------------------------
const REQUIRED = ["22", "24", "26"];
const wfFile = workflowsInRepo.has("test.yml") ? "test.yml" : "test.yaml";
const wf = workflowsInRepo.get(wfFile);
if (!wf?.doc) {
  fail(".github/workflows/test.yml is missing or not a YAML mapping");
  finish();
}
const doc = wf.doc;
const jobs = jobsOf(doc);
const steps = jobs.flatMap(([, j]) => stepsOf(j));
const runs = steps.filter((s) => typeof s.run === "string").map((s) => s.run);

const ev = events(doc);
const pushBranches = isObj(ev.push) ? asList(ev.push.branches).map(String) : "push" in ev ? ["(all)"] : [];
check((pushBranches.includes("main") || pushBranches.includes("(all)")) && "pull_request" in ev, "the workflow runs on pushes to main and on pull requests",
  `the workflow must run on pushes to main and on pull_request (it runs on: ${Object.keys(ev).join(", ") || "nothing"})`);
const loose = jobs.flatMap(([id, j]) => writeScopes(permissionsOf(doc, j)).map((w) => `${id}: ${w}`));
check(jobs.length > 0 && loose.length === 0, "the token is read-only in every job", `declare permissions: contents: read (${loose.join("; ") || "no jobs"})`);
const uses = allUses(doc).filter((u) => !isLocal(u.uses));
const unpinned = uses.filter((u) => !isSha(parseUses(u.uses).ref)).map((u) => u.uses);
check(uses.length > 0 && unpinned.length === 0, "every action is pinned to a full 40-character commit SHA",
  `pin these to a full commit SHA (keep the version in a comment): ${unpinned.join(", ") || "no actions used"}`);

// The matrix: which Node.js versions does the job really get?
const testJob = jobs.find(([, j]) => stepsOf(j).some((s) => typeof s.uses === "string" && parseUses(s.uses).name === "actions/setup-node"));
const versions = [];
if (testJob) {
  const setup = stepsOf(testJob[1]).find((s) => typeof s.uses === "string" && parseUses(s.uses).name === "actions/setup-node");
  for (const matrix of expandMatrix(testJob[1].strategy)) {
    const ctx = { unknown: new Set(), matrix, github: {}, env: {}, inputs: {}, vars: {} };
    versions.push(/^v?(\d+)/.exec(subst(setup.with?.["node-version"] ?? "", ctx).trim())?.[1] ?? "?");
  }
}
const missing = REQUIRED.filter((v) => !versions.includes(v));
check(testJob && missing.length === 0, `the matrix runs the tests on Node.js ${[...new Set(versions)].join(", ")}`,
  testJob ? `package.json promises Node.js >=22: the matrix must cover ${REQUIRED.join(", ")} (it gives: ${versions.join(", ") || "none"}; missing ${missing.join(", ")})` : "no job sets up Node.js with actions/setup-node");
const strategy = testJob?.[1].strategy;
const ff = isObj(strategy) && "fail-fast" in strategy ? String(strategy["fail-fast"]) : null;
check(ff !== null, ff === "false" ? "fail-fast: false is set deliberately (every version reports its result)" : "fail-fast: true is set deliberately (the first failure cancels the rest)",
  "set strategy.fail-fast explicitly: the default (true) cancels the other versions as soon as one fails, so you only see the first broken version");
const setupSteps = steps.filter((s) => typeof s.uses === "string" && parseUses(s.uses).name === "actions/setup-node");
const npmCache = setupSteps.length > 0 && setupSteps.every((s) => String(s.with?.cache ?? "") === "npm");
const cacheStep = steps.find((s) => typeof s.uses === "string" && parseUses(s.uses).name === "actions/cache" && /hashFiles\([^)]*package-lock\.json/.test(String(s.with?.key ?? "")));
check((npmCache || cacheStep) && existsSync(join(repo, "package-lock.json")) && runs.some((r) => /\bnpm ci\b/.test(r)) && !runs.some((r) => /\bnpm (install|i)\b/.test(r)),
  "dependencies come from the lockfile (npm ci) and the npm cache is keyed on package-lock.json",
  "install with npm ci and cache npm downloads keyed on package-lock.json (setup-node's cache: npm, or actions/cache with hashFiles('package-lock.json'))");
const conc = isObj(doc.concurrency) ? doc.concurrency : isObj(testJob?.[1].concurrency) ? testJob[1].concurrency : null;
check(conc && /github\.(ref|head_ref)/.test(String(conc.group ?? "")) && String(conc["cancel-in-progress"]) === "true",
  "superseded runs on the same branch or pull request are cancelled (concurrency with cancel-in-progress)",
  "add concurrency with a group per branch or pull request (for example test-${{ github.ref }}) and cancel-in-progress: true, so a new push stops the outdated tests");

// Run every combination for real, in the matching Node.js container.
const push = { name: "pull_request", ref: "refs/pull/7/merge", refName: "7/merge", sha: "9fceb02d0ae598e95dc970b74767f19372d61af8" };
const runResult = runWorkflow(workflowsInRepo, wfFile, push, repo);
const instances = runResult.results.filter((r) => !r.skipped);
const label = (r) => `Node.js ${r.nodeMajor ?? "?"}`;
const broken = instances.filter((r) => !r.ok);
const covered = REQUIRED.filter((v) => instances.some((r) => r.ok && r.nodeMajor === v && r.steps.some((s) => s.run && /npm (run )?test|node --test/.test(s.run) && s.status === "success")));
check(instances.length > 0 && broken.length === 0 && covered.length === REQUIRED.length,
  `run locally, every combination passes: ${instances.map(label).join(", ")}`,
  broken.length ? `these combinations fail: ${broken.map((r) => `${label(r)} — ${describeFailure([r])}`).join(" || ")}` : `the tests did not run successfully on: ${REQUIRED.filter((v) => !covered.includes(v)).join(", ")}`);

// DevForge's hidden tests on every supported version: the code itself must work on 22, 24 and 26.
const hiddenDir = mutate({ "devforge-hidden.test.mjs": HIDDEN_TESTS });
const hiddenBad = [];
for (const v of REQUIRED) {
  const r = inNode(v, hiddenDir, "node --test --test-reporter=tap devforge-hidden.test.mjs 2>&1");
  if (r.status !== 0) hiddenBad.push(`Node.js ${v}: ${[...r.out.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => m[1]).join("; ") || r.out.trim().split("\n").slice(-2).join(" ")}`);
}
check(hiddenBad.length === 0, "DevForge's hidden tests pass on Node.js 22, 24 and 26", `DevForge's hidden tests fail on ${hiddenBad.join(" || ")}`);
finish();
JS
node "$tools/check.mjs" "$dir" "$tools/work"
