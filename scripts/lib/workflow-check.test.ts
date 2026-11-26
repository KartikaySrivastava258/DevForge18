import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Marked, type Token, type Tokens } from "marked";
import { loadContent } from "./content-loader.ts";
import { splitFrontMatter } from "./markdown.ts";
import { actionsInScript, checkAction, checkReusableCalls, checkWorkflow, workflowsInScript } from "./workflow-check.ts";

const GOOD = `name: CI
on: [push]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm test
`;

describe("checkWorkflow", () => {
  it("accepts a minimal, safe workflow", () => assert.deepEqual(checkWorkflow(GOOD), []));
  it("rejects unpinned actions", () => {
    assert.match(checkWorkflow(GOOD.replace("@v7", "@main")).join(), /pin "actions\/checkout@main"/);
    assert.match(checkWorkflow(GOOD.replace("@v7", "")).join(), /pin/);
    assert.deepEqual(checkWorkflow(GOOD.replace("@v7", `@${"a".repeat(40)}`)), [], "full SHAs are accepted");
  });
  it("requires permissions", () => assert.match(checkWorkflow(GOOD.replace("permissions:\n  contents: read\n", "")).join(), /declare "permissions"/));
  it("flags script injection through run", () => {
    const bad = GOOD.replace("- run: npm test", '- run: echo "${{ github.event.pull_request.title }}"');
    assert.match(checkWorkflow(bad).join(), /script injection/);
  });
  it("checks structure", () => {
    assert.match(checkWorkflow("jobs: {}").join(), /missing "on"/);
    assert.match(checkWorkflow(GOOD.replace("    runs-on: ubuntu-latest\n", "")).join(), /missing "runs-on"/);
    assert.match(checkWorkflow(GOOD.replace("      - run: npm test", "      - name: empty")).join(), /exactly one of "uses" or "run"/);
    assert.match(checkWorkflow("on: [push\n").join(), /invalid YAML/);
  });
  it("extracts workflow files written by lesson commands", () => {
    const found = workflowsInScript("mkdir -p .github/workflows\ncat > .github/workflows/check.yml <<'EOF'\nname: x\nEOF\n");
    assert.deepEqual(found, [{ file: ".github/workflows/check.yml", body: "name: x" }]);
    assert.deepEqual(workflowsInScript("cat > my-app/.github/workflows/b.yml <<'EOF'\nname: y\nEOF\n"), [{ file: "my-app/.github/workflows/b.yml", body: "name: y" }]);
  });
});

describe("checkAction", () => {
  const COMPOSITE = `name: Check notes
description: Fails unless README.md has a title
inputs:
  file:
    default: README.md
runs:
  using: composite
  steps:
    - run: '"$GITHUB_ACTION_PATH/check.sh" "$FILE"'
      shell: bash
      env:
        FILE: \${{ inputs.file }}
`;
  it("accepts a composite action that passes inputs through env", () => assert.deepEqual(checkAction(COMPOSITE), []));
  it("requires shell on composite run steps", () => assert.match(checkAction(COMPOSITE.replace("      shell: bash\n", "")).join(), /needs "shell"/));
  it("flags inputs pasted into a script", () =>
    assert.match(checkAction(COMPOSITE.replace(`'"$GITHUB_ACTION_PATH/check.sh" "$FILE"'`, '"cat \${{ inputs.file }}"')).join(), /script injection/));
  it("finds action files written by lesson commands", () =>
    assert.deepEqual(actionsInScript("cat > .github/actions/check-notes/action.yml <<'EOF'\nname: x\nEOF\n"), [{ file: ".github/actions/check-notes/action.yml", body: "name: x" }]));
});

describe("checkReusableCalls", () => {
  const called = `on:
  workflow_call:
    inputs:
      node-version:
        type: string
        required: true
      run-lint:
        type: boolean
        default: true
jobs: {}
`;
  const caller = (withBlock: string) => `on: [push]
permissions:
  contents: read
jobs:
  ci:
    uses: ./.github/workflows/node-ci.yml
${withBlock}`;
  it("accepts a call that provides required inputs", () =>
    assert.deepEqual(checkReusableCalls(new Map([[".github/workflows/node-ci.yml", called], [".github/workflows/ci.yml", caller("    with:\n      node-version: '22'\n")]])), []));
  it("reports missing required and unknown inputs", () => {
    const problems = checkReusableCalls(new Map([[".github/workflows/node-ci.yml", called], [".github/workflows/ci.yml", caller("    with:\n      nodeversion: '22'\n")]])).join();
    assert.match(problems, /input "nodeversion" is not declared/);
    assert.match(problems, /required input "node-version"/);
  });
});

describe("DevForge's own workflows pass the checker", () => {
  const dir = join(import.meta.dirname, "..", "..", ".github", "workflows");
  for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    it(file, () => assert.deepEqual(checkWorkflow(readFileSync(join(dir, file), "utf8")), []));
  }
});

describe("workflows in lessons", () => {
  const contentRoot = join(import.meta.dirname, "..", "..", "content");
  const { bundle } = loadContent(contentRoot);
  // Labs are checked like lessons.
  for (const lesson of [...bundle.lessons.map((l) => ({ ...l, dir: "lessons" })), ...bundle.labs.map((l) => ({ ...l, dir: "labs" }))]) {
    const body = splitFrontMatter(readFileSync(join(contentRoot, lesson.dir, lesson.track, `${lesson.id}.md`), "utf8"))?.body ?? "";
    const marked = new Marked();
    const codes: Tokens.Code[] = [];
    marked.walkTokens(marked.lexer(body), (t: Token) => {
      if (t.type === "code") codes.push(t as Tokens.Code);
    });
    const shown = codes.filter((c) => /^ya?ml\b.*\bworkflow\b/.test(c.lang ?? ""));
    const written = codes.flatMap((c) => workflowsInScript(c.text));
    const actions = codes.flatMap((c) => actionsInScript(c.text));
    if (shown.length + written.length + actions.length === 0) continue;
    it(`${lesson.id}: every workflow is valid, and every "invalid" example is caught`, () => {
      for (const c of shown) {
        const problems = checkWorkflow(c.text);
        if (/\binvalid\b/.test(c.lang ?? "")) {
          // An "invalid" example must be caught for the rules it illustrates, not merely because it fails to parse.
          assert.ok(problems.length > 0, `expected problems in:\n${c.text}`);
          assert.ok(!problems.some((p) => p.startsWith("invalid YAML")), `example should be valid YAML: ${problems.join("; ")}`);
        }
        else assert.deepEqual(problems, [], c.text);
      }
      for (const w of written) assert.deepEqual(checkWorkflow(w.body), [], `${w.file}:\n${w.body}`);
      for (const a of actions) assert.deepEqual(checkAction(a.body), [], `${a.file}:\n${a.body}`);
      // Calls to local reusable workflows must match what the called workflow declares.
      const byPath = new Map(written.map((w) => [w.file.slice(w.file.indexOf(".github/")), w.body]));
      assert.deepEqual(checkReusableCalls(byPath), []);
    });
  }
});
