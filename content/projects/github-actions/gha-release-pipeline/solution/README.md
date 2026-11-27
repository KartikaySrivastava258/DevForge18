# gradebook-lib

Grade calculations shared by the campus gradebook and the course feedback tool.

```js
import { letterGrade, weightedAverage } from "gradebook-lib";

letterGrade(84);                                                         // "B"
weightedAverage([{ score: 80, weight: 0.4 }, { score: 90, weight: 0.6 }]); // 86
```

```bash
npm ci && npm test
npm pack          # the tarball a release publishes
```

## Releasing

1. Bump `version` in `package.json` in a pull request and merge it.
2. Tag the merged commit and push the tag: `git tag -a v1.5.0 -m "gradebook-lib 1.5.0" && git push origin v1.5.0`.
3. `release.yml` runs:
   - **test** — the reusable `test.yml` (the same definition CI uses);
   - **build** — refuses a tag that does not match `package.json`, packs the tarball **once**, writes
     `SHA256SUMS`, attests the tarball's build provenance and uploads both as the artifact `package`;
   - **release** — waits for the `release` environment's reviewers, downloads the artifact, verifies the
     checksums and publishes exactly those files with `gh release create --verify-tag`.
4. Anyone can check where a tarball came from: `gh attestation verify gradebook-lib-1.5.0.tgz -R OWNER/REPO`.

Repository settings this workflow relies on (not in the files): an environment `release` with required
reviewers and deployment tags limited to `v*`.

## Permissions

| Job | Token |
|---|---|
| test | contents: read |
| build | contents: read, id-token: write, attestations: write |
| release | contents: write |

## Fixed interface (the check relies on it)

- Workflows: `.github/workflows/ci.yml`, `.github/workflows/release.yml` and a reusable
  `.github/workflows/test.yml` (input `node-version`).
- `scripts/check-version.mjs` reads the tag from `GITHUB_REF_NAME` and exits 0 only if it is
  `v` + the version in `package.json`.
- The release is published with the GitHub CLI: `gh release create <tag> <files>`.
- The environment that guards releases is called `release`.
