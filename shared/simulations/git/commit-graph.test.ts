import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { replay, violations } from "../types.ts";
import { ancestors, commitGraph, gitCommand, type GitAction, type GitState } from "./commit-graph.ts";

const c = (message: string): GitAction => ({ type: "commit", message });
const run = (setup: GitAction[], actions: GitAction[] = [], pushed = false) => replay(commitGraph, { setup, pushed }, actions);
const tipMessage = (s: GitState, branch: string) => s.commits[s.branches[branch] ?? ""]?.message;

const DIVERGED: GitAction[] = [
  c("Add README"),
  c("Add notes"),
  { type: "branch", name: "feature" },
  { type: "switch", branch: "feature" },
  c("Draft feature"),
  c("Finish feature"),
  { type: "switch", branch: "main" },
  c("Fix typo on main"),
];

describe("commit graph model: actions", () => {
  it("commits build a chain; the first commit is the root", () => {
    const { state } = run([c("one"), c("two")]);
    assert.equal(state.order.length, 2);
    const [first, second] = state.order.map((id) => state.commits[id]);
    assert.deepEqual(first?.parents, []);
    assert.deepEqual(second?.parents, [first?.id]);
    assert.equal(state.branches.main, second?.id);
  });
  it("branch creates a pointer without moving HEAD; switch moves HEAD", () => {
    const { state } = run([c("one"), { type: "branch", name: "feature" }]);
    assert.equal(state.branches.feature, state.branches.main);
    assert.equal(state.head, "main");
    const after = commitGraph.step(state, { type: "switch", branch: "feature" });
    assert.equal(after.state.head, "feature");
  });
  it("refuses impossible commands and leaves the state unchanged", () => {
    const { state } = run([c("one")]);
    for (const action of [
      { type: "branch", name: "main" },
      { type: "switch", branch: "nope" },
      { type: "switch", branch: "main" },
      { type: "merge", branch: "main", mode: "default" },
      { type: "rebase", onto: "nope" },
      { type: "reset", to: "zzz" },
      { type: "revert", commit: "zzz" },
    ] as GitAction[]) {
      const r = commitGraph.step(state, action);
      assert.ok(r.error, JSON.stringify(action));
      assert.equal(r.state, state);
    }
    assert.ok(commitGraph.init({ setup: [{ type: "branch", name: "x" }], pushed: false }).error, "a branch needs a commit first");
  });
  it("merge fast-forwards when possible, makes a merge commit when branches diverged, and --ff-only refuses", () => {
    const ff = run([c("one"), { type: "branch", name: "feature" }, { type: "switch", branch: "feature" }, c("two"), { type: "switch", branch: "main" }], [{ type: "merge", branch: "feature", mode: "default" }]);
    assert.equal(ff.state.branches.main, ff.state.branches.feature);
    assert.match(ff.events.at(-1) ?? "", /Fast-forward/);
    const merged = run(DIVERGED, [{ type: "merge", branch: "feature", mode: "default" }]);
    const mergeCommit = merged.state.commits[merged.state.branches.main ?? ""];
    assert.equal(mergeCommit?.message, "Merge branch 'feature'");
    assert.equal(mergeCommit?.parents.length, 2);
    const refused = run(DIVERGED, [{ type: "merge", branch: "feature", mode: "ff-only" }]);
    assert.match(refused.refused?.error ?? "", /Not possible to fast-forward/);
    const again = commitGraph.step(merged.state, { type: "merge", branch: "feature", mode: "default" });
    assert.match(again.events[0] ?? "", /Already up to date/);
  });
  it("rebase replays the branch's own commits as new commits on top of the other branch", () => {
    const { state, initial } = run(DIVERGED, [{ type: "switch", branch: "feature" }, { type: "rebase", onto: "main" }]);
    const feature = ancestors(state, state.branches.feature);
    assert.ok(feature.has(state.branches.main ?? ""), "feature now contains main");
    assert.notEqual(state.branches.feature, initial.branches.feature, "rebased commits are new commits");
    assert.ok(!feature.has(initial.branches.feature ?? ""), "the old commits are not on feature any more");
    assert.equal(tipMessage(state, "feature"), "Finish feature");
  });
  it("reset moves the branch back and warns when that rewrites pushed history", () => {
    const r = run([c("one"), c("two")], [{ type: "reset", to: "HEAD~1" }], true);
    assert.equal(tipMessage(r.state, "main"), "one");
    assert.match(r.events.join("\n"), /--force/);
  });
  it("revert adds a new commit that records which commit it undoes", () => {
    const r = run([c("one"), c("two")], [{ type: "revert", commit: "HEAD" }]);
    const revert = r.state.commits[r.state.branches.main ?? ""];
    assert.equal(revert?.message, 'Revert "two"');
    assert.equal(revert?.revertOf, r.initial.branches.main);
  });
  it("produces the same IDs for the same actions (deterministic)", () => {
    assert.deepEqual(run(DIVERGED).state, run(DIVERGED).state);
  });
  it("shows the git command for every action", () => {
    assert.equal(gitCommand({ type: "merge", branch: "feature", mode: "ff-only" }), "git merge --ff-only feature");
    assert.equal(gitCommand({ type: "reset", to: "HEAD~1" }), "git reset --hard HEAD~1");
    assert.equal(gitCommand({ type: "revert", commit: "HEAD" }), "git revert HEAD");
  });
});

describe("commit graph model: invariants hold after every action", () => {
  it("across a long mixed sequence", () => {
    const actions: GitAction[] = [
      { type: "switch", branch: "feature" },
      { type: "rebase", onto: "main" },
      { type: "switch", branch: "main" },
      { type: "merge", branch: "feature", mode: "no-ff" },
      { type: "revert", commit: "HEAD~1" },
      { type: "branch", name: "hotfix" },
      { type: "switch", branch: "hotfix" },
      c("Hotfix"),
      { type: "switch", branch: "main" },
      { type: "merge", branch: "hotfix", mode: "default" },
      { type: "reset", to: "HEAD~2" },
    ];
    let state = run(DIVERGED).state;
    assert.deepEqual(violations(commitGraph, state), []);
    for (const a of actions) {
      state = commitGraph.step(state, a).state;
      assert.deepEqual(violations(commitGraph, state), [], gitCommand(a));
    }
  });
  it("detect a corrupted state", () => {
    const { state } = run([c("one"), c("two")]);
    const broken: GitState = { ...state, branches: { ...state.branches, ghost: "deadbee" } };
    assert.ok(violations(commitGraph, broken).some((v) => v.includes("ghost")));
  });
});

describe("commit graph model: challenges", () => {
  it("feature-on-main-without-merge-commit: passes after rebase and fast-forward, fails after a merge commit", () => {
    const check = commitGraph.checks["feature-on-main-without-merge-commit"]!;
    const good = run(DIVERGED, [{ type: "switch", branch: "feature" }, { type: "rebase", onto: "main" }, { type: "switch", branch: "main" }, { type: "merge", branch: "feature", mode: "ff-only" }]);
    assert.equal(check(good.state, good.initial), true);
    const merged = run(DIVERGED, [{ type: "merge", branch: "feature", mode: "default" }]);
    assert.equal(check(merged.state, merged.initial), false);
    assert.equal(check(merged.initial, merged.initial), false);
  });
  it("undo-pushed-commit-safely: passes with revert, fails with reset", () => {
    const check = commitGraph.checks["undo-pushed-commit-safely"]!;
    const setup = [c("Add README"), c("Add notes"), c("Add broken link")];
    const reverted = run(setup, [{ type: "revert", commit: "HEAD" }], true);
    assert.equal(check(reverted.state, reverted.initial), true);
    const reset = run(setup, [{ type: "reset", to: "HEAD~1" }], true);
    assert.equal(check(reset.state, reset.initial), false);
  });
});

// ---- The model against real Git -------------------------------------------
// The same commands run in a real repository; the graphs must have the same shape:
// for every commit on every branch, the same message and the same parents' messages.

function realGit(actions: GitAction[]): Map<string, string[]> {
  const dir = mkdtempSync(join(tmpdir(), "devforge-gitsim-"));
  const env = { ...process.env, HOME: dir, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "Sim", GIT_AUTHOR_EMAIL: "sim@example.edu", GIT_COMMITTER_NAME: "Sim", GIT_COMMITTER_EMAIL: "sim@example.edu" };
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: dir, env, encoding: "utf8" });
    // Every command in these sequences is valid, so any failure means the comparison is not meaningful.
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
    return r.stdout;
  };
  try {
    git("init", "-q", "-b", "main");
    let n = 0;
    for (const a of actions) {
      if (a.type === "commit") {
        writeFileSync(join(dir, `file-${n++}.txt`), a.message); // one file per commit: no conflicts, as in the model
        git("add", ".");
        git("commit", "-q", "-m", a.message);
      } else if (a.type === "branch") git("branch", a.name);
      else if (a.type === "switch") git("switch", "-q", a.branch);
      else if (a.type === "merge") git("merge", "-q", "--no-edit", ...(a.mode === "default" ? [] : [`--${a.mode}`]), a.branch);
      else if (a.type === "rebase") git("rebase", "-q", a.onto);
      else if (a.type === "reset") git("reset", "-q", "--hard", a.to);
      else git("revert", "--no-edit", a.commit);
    }
    const graph = new Map<string, string[]>();
    for (const branch of git("for-each-ref", "--format=%(refname:short)", "refs/heads").trim().split("\n")) {
      const lines = git("log", "--topo-order", "--format=%H%x09%P%x09%s", branch).trim().split("\n");
      const subject = new Map(lines.map((l) => [l.split("\t")[0], l.split("\t")[2] ?? ""]));
      graph.set(branch, lines.map((l) => {
        const [, parents, s] = l.split("\t");
        return `${s} <- ${(parents ?? "").split(" ").filter(Boolean).map((p) => subject.get(p)).join(" + ")}`;
      }).sort());
    }
    return graph;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function modelGraph(actions: GitAction[]): Map<string, string[]> {
  const { state, refused } = run([], actions);
  assert.equal(refused, undefined, `model refused ${JSON.stringify(refused)}`);
  const graph = new Map<string, string[]>();
  for (const branch of Object.keys(state.branches)) {
    graph.set(branch, [...ancestors(state, state.branches[branch])].map((id) => {
      const commit = state.commits[id];
      return `${commit?.message} <- ${(commit?.parents ?? []).map((p) => state.commits[p]?.message).join(" + ")}`;
    }).sort());
  }
  return graph;
}

const hasGit = spawnSync("git", ["--version"]).status === 0;
describe("commit graph model matches real Git", { skip: hasGit ? false : "git not installed" }, () => {
  const sequences: Record<string, GitAction[]> = {
    "fast-forward merge": [c("one"), { type: "branch", name: "feature" }, { type: "switch", branch: "feature" }, c("two"), { type: "switch", branch: "main" }, { type: "merge", branch: "feature", mode: "default" }],
    "three-way merge after diverging": [...DIVERGED, { type: "merge", branch: "feature", mode: "default" }],
    "--no-ff merge when a fast-forward was possible": [c("one"), { type: "branch", name: "topic" }, { type: "switch", branch: "topic" }, c("two"), { type: "switch", branch: "main" }, { type: "merge", branch: "topic", mode: "no-ff" }],
    "merge into a branch other than main": [...DIVERGED, { type: "switch", branch: "feature" }, { type: "merge", branch: "main", mode: "default" }],
    "rebase then fast-forward": [...DIVERGED, { type: "switch", branch: "feature" }, { type: "rebase", onto: "main" }, { type: "switch", branch: "main" }, { type: "merge", branch: "feature", mode: "ff-only" }],
    "reset and revert": [c("one"), c("two"), c("three"), { type: "reset", to: "HEAD~1" }, c("four"), { type: "revert", commit: "HEAD~1" }],
    "rebase skips merge commits": [...DIVERGED, { type: "switch", branch: "feature" }, { type: "merge", branch: "main", mode: "default" }, c("After merge"), { type: "branch", name: "base" }, { type: "reset", to: "main" }, { type: "switch", branch: "main" }, c("Main again"), { type: "switch", branch: "base" }, { type: "rebase", onto: "main" }],
  };
  for (const [name, actions] of Object.entries(sequences)) {
    it(name, () => assert.deepEqual(modelGraph(actions), realGit(actions)));
  }
});
