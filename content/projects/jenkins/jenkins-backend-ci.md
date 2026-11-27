---
id: jenkins-backend-ci
track: jenkins
title: Jenkins CI pipeline for a backend
level: beginner
estimated_hours: 5
prerequisites: [jenkins-in-docker, jenkins-pipeline-as-code, jenkins-parallel-artifacts-tests]
related_tracks: [github-actions, git-github]
user_stories:
  - As a developer, I want Jenkins to lint and test every change to main so that a broken commit is noticed within minutes, not at the next demo.
  - As a team lead, I want test results on the build page so that I can see which test failed without reading the whole console log.
  - As a team member who deploys, I want each successful build to keep a packaged copy so that I deploy exactly what was tested.
acceptance_criteria:
  - Jenkins' declarative linter accepts the Jenkinsfile, and the pipeline has a timeout.
  - Dependencies are installed with npm ci; lint (npm run lint) and the tests (npm run test:ci) run as parallel stages.
  - "Build #1 of your repository succeeds, Jenkins shows a JUnit test report with all tests passing, and a .tar.gz of the build is archived with BUILD_INFO.json recording the commit and the build number."
  - After a commit that breaks a test, the build does not succeed, the test report still shows the failure, and nothing is archived.
  - After a commit that leaves a console.log in src/, the build fails.
rubric:
  - { criterion: "Pipeline structure", excellent: "Install, parallel checks and packaging are separate stages with clear names; packaging runs only after both checks; options include a timeout, a build discarder and no concurrent builds.", good: "All required stages run in a sensible order.", needs_work: "One long stage, or packaging before the tests." }
  - { criterion: "Feedback when things fail", excellent: "junit in post always, a failure message that tells the reader where to look, and a clean workspace after every build.", good: "The report is published and failures fail the build.", needs_work: "Failures are swallowed (|| true) or the report is only published on success." }
  - { criterion: "Artefacts", excellent: "One clearly named, fingerprinted archive per build that records its commit and build number; nothing else is archived.", good: "The packaged build is archived.", needs_work: "Nothing is archived, or the whole workspace is." }
  - { criterion: "Habits for later", excellent: "Single-quoted sh strings throughout, logic in npm scripts rather than long inline shell, and a README section on how to run the same steps locally.", good: "The pipeline is readable and runs the npm scripts.", needs_work: "Complex shell pasted into the Jenkinsfile, or Groovy interpolation used where the shell should expand variables." }
hints:
  - "Start by deleting || true from the starter's Jenkinsfile and running the check. Build #1 now fails for the right reason — the lint problem in src/app.js — which is exactly what CI is for."
  - The lesson "Parallel stages, artefacts and test results" has a Jenkinsfile with parallel stages, archiveArtifacts and junit in post always. Adapt it rather than starting from nothing.
  - npm run test:ci has to write JUnit XML. Node.js can use two reporters at once — spec to the console and junit to a file — by repeating --test-reporter and --test-reporter-destination.
  - npm run build writes dist/. tar -czf "campus-notes-api-$BUILD_NUMBER.tar.gz" -C dist . packs its contents; use single quotes around the whole sh command so the shell, not Groovy, expands $BUILD_NUMBER.
  - "If build #2 shows no test report, ask in which post condition your junit step runs."
stretch_goals:
  - Run the pipeline on an agent with the label linux instead of the built-in node (see the lesson on agents and labels).
  - Add a stage that starts the packaged server from dist/ and calls /health before archiving.
  - Compare this Jenkinsfile with the GitHub Actions workflow from that track's beginner project and write down three differences that matter to your team.
starter: starter
solution: solution
check_needs: [docker, git, python3]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The department runs its own Jenkins, and the Campus Notes API — the same small REST API as in the GitHub
Actions project — has a Jenkinsfile that someone wrote in five minutes: `npm install`, then `npm test || true`.
Every build is green, Jenkins shows no test results, and nothing is kept from a build. Meanwhile a debugging
`console.log` sits in the code.

Write the pipeline the project should have: install exactly the locked dependencies, run lint and the tests
side by side, publish the test report whatever happens, and archive a packaged build only when everything
passed. Keep the stages small and the logic in npm scripts, so the same steps run on a laptop.

The check starts a **real, throwaway Jenkins** (2.580.2 LTS, the plugins from the lessons plus JUnit,
configured as code) with your folder as a Git repository. It validates your Jenkinsfile with Jenkins'
declarative linter and **runs it three times**: as it is, after a commit that breaks a test, and after a
commit with a lint problem. It reads the results, the test reports and the archived files through Jenkins'
JSON API — the same API the lesson on configuration as code uses.

What the check does not cover: webhooks, agents other than the built-in node, and the web interface. The
lessons explain why builds should not run on the built-in node of a real server; here the Jenkins exists only
for the length of the check.

## Getting started

1. Copy the starter and run the npm scripts locally (`npm ci`, `npm run lint`, `npm test`, `npm run build`).
2. Run the check — it needs Docker, Git, curl and Python 3, downloads the Jenkins image and plugins the first
   time, and takes about two minutes:

   ```bash
   bash check.sh path/to/campus-notes-api
   ```

3. Add the `test:ci` script, rewrite the Jenkinsfile stage by stage, fix the lint problem, and re-run.
4. Optional: point a Pipeline job in your own Jenkins (from the first Jenkins lessons) at the repository and
   look at the Test Result page and the archived file.
