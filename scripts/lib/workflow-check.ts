/**
 * A small, dependency-free checker for GitHub Actions workflow files.
 * It is not a replacement for GitHub's own validation (or actionlint); it
 * catches the structural mistakes and security issues taught in the CI track:
 *
 *  - structure: `on` and `jobs`; every job has `runs-on` (or reuses a workflow
 *    with `uses`) and a list of `steps`; every step has exactly one of
 *    `uses` or `run`;
 *  - pinned actions: `uses:` must name a version (`@v4`, `@v1.2.3`) or a full
 *    40-character commit SHA — never a branch such as `@main`;
 *  - least privilege: `permissions` declared at workflow or job level;
 *  - script injection: no `${{ github.event.* }}` or `${{ github.head_ref }}`
 *    expressions inside `run:` scripts (attacker-controlled text would become
 *    shell code); pass them through `env:` instead.
 */
import { parseYaml } from "./yaml.ts";

const PINNED = /^[\w.-]+\/[\w./-]+@(v\d+(\.\d+){0,2}|[0-9a-f]{40})$/;
const UNTRUSTED_IN_RUN = /\$\{\{\s*github\.(event\.|head_ref)/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export function checkWorkflow(source: string): string[] {
  let doc: unknown;
  try {
    doc = parseYaml(source);
  } catch (err) {
    return [`invalid YAML: ${(err as Error).message.split("\n")[0]}`];
  }
  if (!isObj(doc)) return ["a workflow must be a YAML mapping"];
  const problems: string[] = [];
  if (!("on" in doc)) problems.push('missing "on": which events start this workflow?');
  if (!isObj(doc.jobs) || Object.keys(doc.jobs).length === 0) {
    problems.push('missing "jobs"');
    return problems;
  }
  const workflowPermissions = "permissions" in doc;
  for (const [jobId, job] of Object.entries(doc.jobs)) {
    if (!isObj(job)) {
      problems.push(`job "${jobId}" must be a mapping`);
      continue;
    }
    if (!workflowPermissions && !("permissions" in job)) {
      problems.push(`job "${jobId}": declare "permissions" (workflow or job level) to limit the GITHUB_TOKEN`);
    }
    if (typeof job.uses === "string") continue; // reusable workflow call
    if (!("runs-on" in job)) problems.push(`job "${jobId}": missing "runs-on"`);
    if (!Array.isArray(job.steps) || job.steps.length === 0) {
      problems.push(`job "${jobId}": missing "steps"`);
      continue;
    }
    job.steps.forEach((step: unknown, i: number) => {
      const where = `job "${jobId}" step ${i + 1}`;
      if (!isObj(step)) {
        problems.push(`${where}: must be a mapping`);
        return;
      }
      const hasUses = typeof step.uses === "string";
      const hasRun = typeof step.run === "string";
      if (hasUses === hasRun) problems.push(`${where}: needs exactly one of "uses" or "run"`);
      if (hasUses && !String(step.uses).startsWith("./") && !String(step.uses).startsWith("docker://") && !PINNED.test(String(step.uses))) {
        problems.push(`${where}: pin "${String(step.uses)}" to a version tag (@v4) or a full commit SHA`);
      }
      if (hasRun && UNTRUSTED_IN_RUN.test(String(step.run))) {
        problems.push(`${where}: untrusted \${{ github.event… }} / head_ref used directly in "run" (script injection); pass it via "env" instead`);
      }
    });
  }
  return problems;
}

/** Workflow files a lesson creates: `cat > .github/workflows/<file> <<'EOF' … EOF` inside run blocks. */
export function workflowsInScript(code: string): { file: string; body: string }[] {
  const found: { file: string; body: string }[] = [];
  // Also inside a project folder (cat > my-app/.github/workflows/x.yml).
  const re = /cat > ((?:[\w.-]+\/)*\.github\/workflows\/[\w.-]+\.ya?ml) <<'(\w+)'\n([\s\S]*?)\n\2(?:\n|$)/g;
  for (let m = re.exec(code); m; m = re.exec(code)) found.push({ file: m[1] ?? "", body: m[3] ?? "" });
  return found;
}

/** Composite (and other) action metadata files a lesson creates: `cat > …/.github/actions/<name>/action.yml`. */
export function actionsInScript(code: string): { file: string; body: string }[] {
  const found: { file: string; body: string }[] = [];
  const re = /cat > ((?:[\w.-]+\/)*\.github\/actions\/[\w.-]+\/action\.ya?ml) <<'(\w+)'\n([\s\S]*?)\n\2(?:\n|$)/g;
  for (let m = re.exec(code); m; m = re.exec(code)) found.push({ file: m[1] ?? "", body: m[3] ?? "" });
  return found;
}

const INPUT_IN_RUN = /\$\{\{\s*inputs\./;

/**
 * Checks an action's metadata (action.yml): a name, a `runs` section, and for composite actions steps that
 * each have exactly one of `uses`/`run`, a `shell` on every `run` step (required for composite actions),
 * pinned `uses`, and no `${{ inputs.* }}` pasted into a script (pass inputs through `env`).
 */
export function checkAction(source: string): string[] {
  let doc: unknown;
  try {
    doc = parseYaml(source);
  } catch (err) {
    return [`invalid YAML: ${(err as Error).message.split("\n")[0]}`];
  }
  if (!isObj(doc)) return ["an action must be a YAML mapping"];
  const problems: string[] = [];
  if (typeof doc.name !== "string") problems.push('missing "name"');
  if (!isObj(doc.runs) || typeof doc.runs.using !== "string") return [...problems, 'missing "runs.using"'];
  if (doc.runs.using !== "composite") return problems;
  const steps = doc.runs.steps;
  if (!Array.isArray(steps) || steps.length === 0) return [...problems, 'a composite action needs "runs.steps"'];
  steps.forEach((step: unknown, i: number) => {
    const where = `step ${i + 1}`;
    if (!isObj(step)) return problems.push(`${where}: must be a mapping`);
    const hasUses = typeof step.uses === "string";
    const hasRun = typeof step.run === "string";
    if (hasUses === hasRun) problems.push(`${where}: needs exactly one of "uses" or "run"`);
    if (hasRun && typeof step.shell !== "string") problems.push(`${where}: a composite action's "run" step needs "shell"`);
    if (hasUses && !String(step.uses).startsWith("./") && !String(step.uses).startsWith("docker://") && !PINNED.test(String(step.uses))) {
      problems.push(`${where}: pin "${String(step.uses)}" to a version tag (@v4) or a full commit SHA`);
    }
    if (hasRun && (INPUT_IN_RUN.test(String(step.run)) || UNTRUSTED_IN_RUN.test(String(step.run)))) {
      problems.push(`${where}: \${{ inputs.… }} or untrusted context used directly in "run" (script injection); pass it via "env" instead`);
    }
    return undefined;
  });
  return problems;
}

/**
 * Checks calls to local reusable workflows (`uses: ./.github/workflows/x.yml` at job level) against the
 * called file's `on.workflow_call.inputs`: every required input without a default is given, and no unknown
 * input is passed. `files` maps a workflow path (".github/workflows/x.yml") to its source.
 */
export function checkReusableCalls(files: Map<string, string>): string[] {
  const problems: string[] = [];
  for (const [file, source] of files) {
    let doc: unknown;
    try {
      doc = parseYaml(source);
    } catch {
      continue;
    }
    if (!isObj(doc) || !isObj(doc.jobs)) continue;
    for (const [jobId, job] of Object.entries(doc.jobs)) {
      if (!isObj(job) || typeof job.uses !== "string" || !job.uses.startsWith("./")) continue;
      const target = job.uses.slice(2);
      const calledSource = files.get(target);
      if (calledSource === undefined) {
        problems.push(`${file} job "${jobId}": calls ${job.uses}, which this lesson does not define`);
        continue;
      }
      const called = parseYaml(calledSource);
      const on = isObj(called) ? called.on : undefined;
      const wc = isObj(on) ? on.workflow_call : undefined;
      if (!isObj(on) || !("workflow_call" in on)) {
        problems.push(`${file} job "${jobId}": ${target} is not reusable (no "on: workflow_call")`);
        continue;
      }
      const declared = isObj(wc) && isObj(wc.inputs) ? wc.inputs : {};
      const given = isObj(job.with) ? job.with : {};
      for (const name of Object.keys(given)) {
        if (!(name in declared)) problems.push(`${file} job "${jobId}": input "${name}" is not declared by ${target}`);
      }
      for (const [name, spec] of Object.entries(declared)) {
        if (isObj(spec) && spec.required === true && !("default" in spec) && !(name in given)) {
          problems.push(`${file} job "${jobId}": required input "${name}" of ${target} is missing`);
        }
      }
    }
  }
  return problems;
}
