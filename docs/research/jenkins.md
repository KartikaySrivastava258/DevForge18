# Jenkins — research notes

Checked 2026-11-26 (UTC). Reuse these in lessons; add to them instead of researching again.

## Versions

| Item | Version | Notes |
|---|---|---|
| Jenkins image | `jenkins/jenkins:2.580.2-lts-jdk21` | used since lesson 1; 2.580.3 (2026-11-25) is newer than two weeks |
| workflow-aggregator (Pipeline) | 608.v67378e9d3db_1 | released 2025-03-19, core ≥ 2.479.3 |
| configuration-as-code | 2148.v9d0c041b_a_13c | released 2026-11-05 (2150 and 2151 are newer than two weeks), core ≥ 2.541.1 |
| job-dsl | 3732.v9a_c49a_61a_313 | released 2026-08-12 (3752 is newer than two weeks), core ≥ 2.479.3 |
| pipeline-groovy-lib | 822.vc95f70dea_db_7 | released 2026-10-12, core ≥ 2.555.1 |
| git | 5.11.0 | released 2026-10-11, core ≥ 2.504.3 |
| matrix-auth | 3.3 | released 2026-07-14, core ≥ 2.528.3 |

Versions and release dates from updates.jenkins.io/download/plugins/<id>/ and plugins.jenkins.io/api/plugin/<id>.

## Facts confirmed (source → wording)

- JCasC (jenkins.io/doc/book/managing/casc/): "defines Jenkins configuration parameters in a human-readable YAML file that can be stored as source code"; `CASC_JENKINS_CONFIG` points to the file(s).
- Docker image README (github.com/jenkinsci/docker): `jenkins-plugin-cli --plugins …` or `-f plugins.txt` in a Dockerfile; plugins go to `/usr/share/jenkins/ref`, copied into JENKINS_HOME at start without overriding existing files.
- Remote access API (jenkins.io/doc/book/using/remote-access-api/): HTTP basic authentication with a user and API token; "API tokens are preferred instead of crumbs for CSRF protection"; `buildWithParameters`.
- CSRF (jenkins.io/doc/book/security/csrf-protection/): the crumb is required for modifying requests; "Requests authenticating with an API token are exempt from CSRF protection".
- Shared libraries (jenkins.io/doc/book/pipeline/shared-libraries/): `src/`, `vars/` (global variables such as `vars/foo.groovy`), `resources/`; `@Library('name') _` or `@Library('name@1.0') _`; libraries can be loaded implicitly.
- Controller isolation (jenkins.io/doc/book/security/controller-isolation/): builds on the built-in node have the same access to the controller's file system as Jenkins itself; "highly advisable to not run any builds on the built-in node", set its executors to 0 and use agents.
- Access control (jenkins.io/doc/book/security/access-control/): do not grant significant permissions to anonymous or authenticated; granting Overall/Administer to anonymous is like "Anyone can do anything".

## Observed while building lessons

- `jenkins/inbound-agent:3395.v6e5377b_0fb_3c-4-jdk21` (published 2026-11-06) pinned as `@sha256:0c5908a376ff73381f3617c8277b77559a9c8916fe0c22efd9b9e9ef326aeb27`; env vars JENKINS_URL, JENKINS_SECRET, JENKINS_AGENT_NAME, JENKINS_WEB_SOCKET, JENKINS_AGENT_WORKDIR (docker-agents README_inbound-agent.md). The agent secret is the first `<argument>` of `/computer/<name>/jenkins-agent.jnlp`.
- With the six pinned plugins, the image builds in under a minute locally once downloaded; 64 plugins in total including dependencies (dependency versions are resolved by jenkins-plugin-cli, not pinned).
- `curl` treats `[` `]` in `tree=jobs[name]` as globs: use `curl -g`.
- Mounting a single YAML file and editing it on the host replaces the file, so the container keeps the old one; mount the folder (`CASC_JENKINS_CONFIG` pointing to a directory) for reloads.
- `POST /configuration-as-code/reload` answers 302; `POST /job/<name>/build` answers 201; without a crumb a password-authenticated POST gets 403; API-token requests need no crumb.
- Queue reason for a missing label: "There are no nodes with the label ‘windows’" (typographic quotes).
- The Git plugin refuses local `file://` checkouts in jobs by default; the lessons serve library repositories over dumb HTTP (`git update-server-info` + busybox httpd) instead of relaxing that.
- Jenkins lessons do not replay the Git lessons: set a Git identity in any repository a Jenkins lesson commits to.
- Lesson order decision: Configuration as Code is lesson 4 (the plan listed it sixth) because agents, shared libraries and security all build on its image and YAML.
