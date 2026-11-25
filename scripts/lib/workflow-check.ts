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
  const re = /cat > (\.github\/workflows\/[\w.-]+\.ya?ml) <<'(\w+)'\n([\s\S]*?)\n\2(?:\n|$)/g;
  for (let m = re.exec(code); m; m = re.exec(code)) found.push({ file: m[1] ?? "", body: m[3] ?? "" });
  return found;
}
