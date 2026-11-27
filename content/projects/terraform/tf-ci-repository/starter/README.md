# Campus service configuration: a repository CI can trust

`infra/` renders one JSON configuration file per campus service and environment
(`infra/out/<environment>/<service>.json`) with the `hashicorp/local` provider. The repository works on the
author's laptop, but it is not ready for a team: a state file is committed, nothing is pinned or tested, and the
workflow applies every push with a write-all token.

Make it a repository whose pull requests are checked automatically:

1. **Hygiene** — remove committed state; add a `.gitignore` that ignores `.terraform/`, `*.tfstate` and
   `*.tfstate.*` but not `.terraform.lock.hcl`.
2. **Pinning** — `hashicorp/local` pinned to exactly 2.9.1, and `infra/.terraform.lock.hcl` committed with
   hashes for Linux, macOS and Windows (`terraform providers lock -platform=linux_amd64 -platform=linux_arm64
   -platform=darwin_arm64 -platform=windows_amd64`).
3. **Validation and tests** — `environment` must be dev, staging or prod; every service port 1024–65535 and
   1–10 replicas. `infra/tests/*.tftest.hcl` with at least three runs, at least one of them using
   `expect_failures` to prove bad input is refused. Keep the resource names, the file paths and the output
   `config_files`.
4. **CI** — `.github/workflows/terraform.yml` runs on pull requests with a read-only token (`contents: read`),
   uses actions pinned to full commit SHAs, installs Terraform 1.15.6 and runs `terraform fmt -check -recursive`,
   `terraform init -lockfile=readonly`, `validate`, `test` and `plan` — and never `apply -auto-approve`.

Run `bash check.sh path/to/this/folder` (needs Docker only — Terraform, git and actionlint run from images).
