import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Marked, type Token, type Tokens } from "marked";
import { loadContent } from "./content-loader.ts";
import { checkJenkinsfile, jenkinsfilesInScript } from "./jenkinsfile-check.ts";
import { splitFrontMatter } from "./markdown.ts";

const GOOD = `// A comment with a brace {
pipeline {
  agent any
  environment {
    DEPLOY_TOKEN = credentials('deploy-token')
  }
  stages {
    stage('Test') {
      steps {
        sh 'npm test'
        sh 'curl -H "Authorization: Bearer $DEPLOY_TOKEN" https://example.invalid/'
        echo "Build \${env.BUILD_NUMBER} done {"
      }
    }
  }
  post {
    failure { echo 'failed' }
  }
}`;

describe("checkJenkinsfile", () => {
  it("accepts a valid pipeline, ignoring braces in comments and strings", () => assert.deepEqual(checkJenkinsfile(GOOD), []));
  it("requires pipeline, agent and stages", () => {
    assert.match(checkJenkinsfile("node { sh 'x' }").join(), /must start with pipeline/);
    assert.match(checkJenkinsfile(GOOD.replace("  agent any\n", "")).join(), /missing "agent"/);
    assert.match(checkJenkinsfile("pipeline { agent any }").join(), /missing "stages"/);
  });
  it("requires every stage to do something", () => {
    assert.match(checkJenkinsfile("pipeline { agent any\n stages { stage('Empty') { echo 'x' } } }").join(), /stage 'Empty' has no steps/);
  });
  it("detects unbalanced braces and unclosed strings", () => {
    assert.match(checkJenkinsfile(GOOD.slice(0, -1)).join(), /unbalanced braces/);
    assert.match(checkJenkinsfile("pipeline { agent any\n stages { stage('A) { steps { sh 'x' } } } }").join(), /unclosed string|unbalanced/);
  });
  it("flags hard-coded secrets in environment", () => {
    assert.match(checkJenkinsfile(GOOD.replace("credentials('deploy-token')", "'abc123'")).join(), /hard-coded secret/);
  });
  it("flags credentials interpolated by Groovy, but not single-quoted shell expansion", () => {
    const bad = GOOD.replace(`sh 'curl -H "Authorization: Bearer $DEPLOY_TOKEN" https://example.invalid/'`, 'sh "curl -H \'Authorization: Bearer ${DEPLOY_TOKEN}\' https://example.invalid/"');
    assert.match(checkJenkinsfile(bad).join(), /credential DEPLOY_TOKEN is interpolated/);
    const withCreds = "pipeline { agent any\n stages { stage('D') { steps {\n withCredentials([string(credentialsId: 'tok', variable: 'TOKEN')]) {\n sh \"echo $TOKEN\"\n }\n } } } }";
    assert.match(checkJenkinsfile(withCreds).join(), /credential TOKEN is interpolated/);
  });
  it("extracts Jenkinsfiles written by lesson commands", () => {
    assert.deepEqual(jenkinsfilesInScript("cat > Jenkinsfile <<'EOF'\npipeline {}\nEOF\n"), ["pipeline {}"]);
  });
});

describe("Jenkinsfiles in lessons", () => {
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
    const shown = codes.filter((c) => /^groovy\b.*\bjenkinsfile\b/.test(c.lang ?? ""));
    const written = codes.flatMap((c) => jenkinsfilesInScript(c.text));
    if (shown.length + written.length === 0) continue;
    it(`${lesson.id}: every Jenkinsfile is valid, and every "invalid" example is caught for its rules`, () => {
      for (const c of shown) {
        const problems = checkJenkinsfile(c.text);
        if (/\binvalid\b/.test(c.lang ?? "")) {
          assert.ok(problems.length > 0, `expected problems in:\n${c.text}`);
          assert.ok(!problems.some((p) => /unbalanced|unclosed|must start/.test(p)), `example should be well-formed: ${problems.join("; ")}`);
        } else assert.deepEqual(problems, [], c.text);
      }
      for (const w of written) assert.deepEqual(checkJenkinsfile(w), [], w);
    });
  }
});
