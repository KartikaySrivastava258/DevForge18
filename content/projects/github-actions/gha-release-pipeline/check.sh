#!/usr/bin/env bash
# Acceptance check for "Automated release workflow".
# Usage: bash check.sh path/to/gradebook-lib
# Needs Docker and Node.js (and internet access to pull the pinned images and the YAML parser the first time).
# Reads the workflows (structure, permissions per job, pins, the reusable test workflow), then RUNS release.yml
# locally as a push of tag v<version>: the test and build jobs execute in pinned Node.js containers, the
# artifact and the attestation subject are recorded, and the release job runs with npm and node replaced by
# stubs (it must not rebuild) and gh replaced by a recorder. A mismatched tag must stop the release.
# Prints PASS or FAIL per criterion; exits non-zero on any FAIL.
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
      else if (name === "actions/setup-node") body = `echo "Node.js ${nodeMajor} (this check runs the job in the matching container)"\n`;
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
// ---- Criteria: Automated release workflow -------------------------------------------------------------------
const get = (base) => workflowsInRepo.get(`${base}.yml`) ?? workflowsInRepo.get(`${base}.yaml`);
const fileOf = (base) => (workflowsInRepo.has(`${base}.yml`) ? `${base}.yml` : `${base}.yaml`);
const release = get("release");
if (!release?.doc) {
  fail(".github/workflows/release.yml is missing or not a YAML mapping");
  finish();
}
let version = "";
try {
  version = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version;
} catch {}
const doc = release.doc;
const rjobs = jobsOf(doc);
const stepUses = (job, name) => stepsOf(job).filter((s) => typeof s.uses === "string" && parseUses(s.uses).name === name);
const runText = (job) => stepsOf(job).filter((s) => typeof s.run === "string").map((s) => s.run).join("\n");

// 1. One definition of the tests: a reusable workflow that CI and the release both call.
const reusable = get("test");
const declared = isObj(reusable?.doc?.on) && isObj(reusable.doc.on.workflow_call) && isObj(reusable.doc.on.workflow_call.inputs) ? reusable.doc.on.workflow_call.inputs : {};
const reusableRuns = reusable?.doc ? jobsOf(reusable.doc).map(([, j]) => runText(j)).join("\n") : "";
check(reusable?.doc && "node-version" in declared && /\bnpm ci\b/.test(reusableRuns) && /npm (run )?test|node --test/.test(reusableRuns),
  "test.yml is a reusable workflow (on: workflow_call) with a node-version input that runs npm ci and the tests",
  "create .github/workflows/test.yml with on: workflow_call, an input node-version, and steps that run npm ci and npm test");
const callProblems = [];
for (const caller of ["ci", "release"]) {
  const wf = get(caller);
  const calls = wf?.doc ? jobsOf(wf.doc).filter(([, j]) => typeof j.uses === "string" && /^\.\/\.github\/workflows\/test\.ya?ml$/.test(j.uses)) : [];
  if (calls.length === 0) callProblems.push(`${caller}.yml does not call ./.github/workflows/test.yml`);
  for (const [id, j] of calls) {
    const given = isObj(j.with) ? j.with : {};
    for (const k of Object.keys(given)) if (!(k in declared)) callProblems.push(`${caller}.yml job ${id} passes undeclared input ${k}`);
    for (const [k, spec] of Object.entries(declared)) if (isObj(spec) && spec.required === true && !("default" in spec) && !(k in given)) callProblems.push(`${caller}.yml job ${id} does not pass the required input ${k}`);
  }
}
check(callProblems.length === 0, "ci.yml and release.yml both call the reusable test workflow with valid inputs", callProblems.join("; "));

// 2. Triggers: a version tag, nothing else.
const ev = events(doc);
const tags = isObj(ev.push) ? asList(ev.push.tags).map(String) : [];
const others = Object.keys(ev).filter((e) => e !== "push");
check(tags.length > 0 && tags.every((t) => t.startsWith("v")) && !isObj(ev.push?.branches) && !ev.push?.branches && others.length === 0,
  `release.yml runs only when a version tag is pushed (${tags.join(", ")})`,
  `release.yml must run only on push of version tags such as v*.*.* (it runs on: ${JSON.stringify(ev)})`);

// 3. Who builds, who attests, who releases.
const builder = rjobs.find(([, j]) => stepUses(j, "actions/upload-artifact").length > 0);
const attester = rjobs.find(([, j]) => stepUses(j, "actions/attest").length > 0 || stepUses(j, "actions/attest-build-provenance").length > 0);
const releaser = rjobs.find(([, j]) => /\bgh release create\b/.test(runText(j)));
check(builder && attester && builder[0] === attester[0], `job "${builder?.[0]}" builds the package, uploads it as an artifact and attests its provenance`,
  !builder ? "no job uploads the built package with actions/upload-artifact" : `attest the uploaded file in the job that builds it (actions/attest with subject-path; found in: ${attester?.[0] ?? "no job"})`);
const needsOf = (id, seen = new Set()) => {
  const job = Object.fromEntries(rjobs)[id];
  for (const dep of asList(job?.needs)) if (!seen.has(dep)) { seen.add(dep); needsOf(dep, seen); }
  return seen;
};
const testCaller = rjobs.find(([, j]) => typeof j.uses === "string" && /test\.ya?ml$/.test(j.uses));
const relNeeds = releaser ? needsOf(releaser[0]) : new Set();
check(releaser && builder && testCaller && relNeeds.has(builder[0]) && relNeeds.has(testCaller[0]) && builder[0] !== releaser[0],
  `job "${releaser?.[0]}" publishes with gh release create and needs both "${builder?.[0]}" and "${testCaller?.[0]}"`,
  !releaser ? "no job runs gh release create" : `the release must be a separate job that needs the build and the test jobs (it needs: ${[...relNeeds].join(", ") || "nothing"})`);
const env = releaser ? releaser[1].environment : undefined;
const envName = typeof env === "string" ? env : isObj(env) ? env.name : undefined;
check(envName === "release", 'the release job runs in the protected environment "release"', `the release job must use environment: release (found: ${envName ?? "none"}), so reviewers and tag rules guard it`);
const relRuns = releaser ? runText(releaser[1]) : "";
check(releaser && stepUses(releaser[1], "actions/download-artifact").length > 0 && stepUses(releaser[1], "actions/checkout").length === 0 && !/\b(npm|npx|node|yarn|pnpm)\b/.test(relRuns),
  "the release job downloads the artifact and neither checks out nor rebuilds",
  "the release job must publish the build job's artifact (actions/download-artifact) — no actions/checkout and no npm or node there");

// 4. Least privilege, job by job.
const perms = rjobs.map(([id, j]) => [id, writeScopes(permissionsOf(doc, j))]);
const problems = [];
if (writeScopes(doc.permissions).length > 0 || doc.permissions === undefined) problems.push(`the workflow-level permissions should be {} or read-only (they are ${JSON.stringify(doc.permissions ?? "not set")})`);
for (const [id, w] of perms) {
  const allowed = id === attester?.[0] ? ["id-token", "attestations"] : id === releaser?.[0] ? ["contents"] : [];
  const extra = w.filter((s) => !allowed.includes(s));
  if (extra.length) problems.push(`${id} gets ${extra.join(", ")}`);
}
const attPerm = attester ? writeScopes(permissionsOf(doc, attester[1])) : [];
const relPerm = releaser ? writeScopes(permissionsOf(doc, releaser[1])) : [];
if (attester && !(attPerm.includes("id-token") && attPerm.includes("attestations"))) problems.push(`${attester[0]} needs id-token: write and attestations: write to attest`);
if (releaser && !relPerm.includes("contents")) problems.push(`${releaser[0]} needs contents: write to create the release`);
check(rjobs.length > 0 && problems.length === 0, "permissions are per job: only the build job may sign (id-token, attestations), only the release job may write contents",
  `tighten the permissions: ${problems.join("; ")}`);

// 5. Pins, concurrency and no expressions pasted into scripts.
const unpinned = [...workflowsInRepo.values()].filter((w) => w.doc).flatMap((w) => allUses(w.doc).filter((u) => !isLocal(u.uses) && !isSha(parseUses(u.uses).ref)).map((u) => `${w.file}: ${u.uses}`));
check(workflowsInRepo.size > 0 && unpinned.length === 0, "every action in every workflow is pinned to a full commit SHA", `pin to a full commit SHA: ${unpinned.join(", ")}`);
const conc = isObj(doc.concurrency) ? doc.concurrency : isObj(releaser?.[1].concurrency) ? releaser[1].concurrency : typeof doc.concurrency === "string" ? { group: doc.concurrency } : null;
check(conc && String(conc["cancel-in-progress"] ?? "false") === "false",
  "releases are serialised with concurrency and never cancelled halfway (cancel-in-progress: false)",
  conc ? "cancel-in-progress must be false for releases: a release cancelled halfway can leave a tag without its files" : "add concurrency (for example group: release-${{ github.ref }}) so two releases never run at once");
const injected = rjobs.flatMap(([id, j]) => stepsOf(j).filter((s) => typeof s.run === "string" && /\$\{\{\s*(github|inputs|env)\./.test(s.run)).map(() => id));
check(injected.length === 0, "no ${{ … }} context values are pasted into run scripts (tag and token come in through env)",
  `pass values such as the tag through env and use "$TAG" in the script (jobs: ${[...new Set(injected)].join(", ")})`);

// 6. check-version.mjs on its own.
const cvDir = mutate({});
const cv = (tag) => inNode("24", cvDir, `${tag === null ? "unset GITHUB_REF_NAME;" : `export GITHUB_REF_NAME='${tag}';`} node scripts/check-version.mjs > /dev/null 2>&1; echo "rc=$?"`).out.trim();
const cvResults = { [`v${version}`]: cv(`v${version}`), "v9.9.9": cv("v9.9.9"), [version]: cv(version), "(unset)": cv(null) };
const cvOk = cvResults[`v${version}`] === "rc=0" && Object.entries(cvResults).filter(([k]) => k !== `v${version}`).every(([, v]) => /^rc=[1-9]/.test(v));
check(version && cvOk, `scripts/check-version.mjs accepts v${version} and refuses v9.9.9, ${version} and a missing tag`,
  `scripts/check-version.mjs must exit 0 only for GITHUB_REF_NAME=v${version} (results: ${Object.entries(cvResults).map(([k, v]) => `${k} → ${v}`).join(", ")})`);

// 7. Run the release for real: push of tag v<version>.
const stubs = {
  npm: '#!/bin/bash\necho "npm $*" >> /artifacts/.rebuild\necho "the release job must not run npm" >&2\nexit 1\n',
  npx: '#!/bin/bash\necho "npx $*" >> /artifacts/.rebuild\nexit 1\n',
  node: '#!/bin/bash\necho "node $*" >> /artifacts/.rebuild\necho "the release job must not run node" >&2\nexit 1\n',
  gh: '#!/bin/bash\n{ printf "gh"; printf " %s" "$@"; echo; for a in "$@"; do [ -f "$a" ] && echo "file $(basename "$a") $(sha256sum "$a" | cut -d" " -f1)"; done; echo "token ${GH_TOKEN:+set}"; } >> /artifacts/.gh-calls\necho "https://github.com/devforge-example/campus-project/releases/tag/example"\n',
};
const extra = releaser ? { [releaser[0]]: { stubs } } : {};
const tagEvent = (tag) => ({ name: "push", ref: `refs/tags/${tag}`, refName: tag, sha: "c3499c2729730a7f807efb8676a92dcb6f8a3f8f" });
const run = runWorkflow(workflowsInRepo, fileOf("release"), tagEvent(`v${version}`), repo, extra);
const read = (f) => (existsSync(join(run.artifacts, f)) ? readFileSync(join(run.artifacts, f), "utf8") : "");
const ghCalls = read(".gh-calls");
const tgzs = existsSync(run.artifacts) ? readdirSync(run.artifacts).filter((n) => !n.startsWith(".")).flatMap((a) => readdirSync(join(run.artifacts, a)).filter((f) => f.endsWith(".tgz")).map((f) => join(run.artifacts, a, f))) : [];
const sha = (p) => spawnSync("sha256sum", [p], { encoding: "utf8" }).stdout.split(" ")[0];
const uploaded = tgzs.map(sha);
const attested = read(".attested").trim().split("\n").filter(Boolean);
const released = [...ghCalls.matchAll(/^file \S+\.tgz ([0-9a-f]{64})$/gm)].map((m) => m[1]);
const ranTests = run.results.some((r) => r.ok && r.steps.some((s) => s.run && /npm (run )?test|node --test/.test(s.run) && s.status === "success"));
if (!run.results.every((r) => r.ok && !r.skipped)) fail(`run locally for tag v${version}, the release workflow fails — ${describeFailure(run.results)}${read(".rebuild") ? ` (the release job ran: ${read(".rebuild").trim().split("\n").join("; ")})` : ""}`);
else check(ranTests && new RegExp(`^gh release create v${version.replace(/\./g, "\\.")}\\b`, "m").test(ghCalls) && /token set/.test(ghCalls),
  `run locally for tag v${version}: the tests run, then gh release create v${version} is called with a token`,
  `the run succeeded, but ${ranTests ? `gh release create was not called for v${version} with GH_TOKEN (calls: ${ghCalls.trim().split("\n")[0] || "none"})` : "no test step ran"}`);
check(uploaded.length === 1 && released.length >= 1 && released.every((d) => d === uploaded[0]) && attested.includes(uploaded[0]),
  "the released tarball is byte-for-byte the one the build job uploaded and attested (built once)",
  uploaded.length !== 1 ? `the build should upload exactly one .tgz (found ${uploaded.length})` : !attested.includes(uploaded[0]) ? "the attested subject is not the uploaded tarball" : "the release did not publish the uploaded tarball (did it rebuild, or publish other files?)");
const listing = tgzs[0] ? spawnSync("tar", ["tzf", tgzs[0]], { encoding: "utf8" }).stdout.split("\n").filter(Boolean) : [];
check(listing.includes("package/package.json") && listing.some((f) => f.startsWith("package/src/")) && !listing.some((f) => /^package\/(test|\.github|scripts)\//.test(f)),
  `the tarball contains the library only (${listing.length} files: package.json, src/, no tests or workflows)`,
  `the tarball should contain package.json and src/ but not test/, scripts/ or .github/ — use "files" in package.json (it has: ${listing.slice(0, 8).join(", ") || "nothing"})`);

// 8. A tag that does not match package.json must stop before anything is published.
const bad = runWorkflow(workflowsInRepo, fileOf("release"), tagEvent("v9.9.9"), repo, extra);
const badCalls = existsSync(join(bad.artifacts, ".gh-calls")) ? readFileSync(join(bad.artifacts, ".gh-calls"), "utf8") : "";
const goodRun = run.results.length > 0 && run.results.every((r) => r.ok && !r.skipped) && /gh release create/.test(ghCalls);
if (!goodRun) fail("a mismatched tag can only be tested once the release works for the right tag (see above)");
else check(bad.results.some((r) => !r.ok) && !/gh release create/.test(badCalls), "for tag v9.9.9 (package.json says " + version + ") the workflow fails and nothing is released",
  /gh release create/.test(badCalls) ? "tag v9.9.9 was released although package.json says " + version + ": run scripts/check-version.mjs before publishing" : "tag v9.9.9 should make the release workflow fail");
finish();
JS
node "$tools/check.mjs" "$dir" "$tools/work"
