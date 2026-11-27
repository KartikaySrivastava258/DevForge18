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

## Releasing (today)

Push a tag such as `v1.4.0` and `.github/workflows/release.yml` publishes a GitHub release with the packed
tarball. Problems the maintainers know about:

- One job does everything with a write-all token: test, pack and publish.
- Nothing stops a tag that does not match `package.json` (`v1.4.1` was once released with 1.4.0 inside).
- Nobody can prove which workflow built a tarball, and the tarball includes the tests.
- `ci.yml` and `release.yml` each define "run the tests" their own way.
- Anyone with push access can release; two tags pushed together run two releases at once.

## Fixed interface (the check relies on it)

- Workflows: `.github/workflows/ci.yml`, `.github/workflows/release.yml` and a reusable
  `.github/workflows/test.yml` (input `node-version`).
- `scripts/check-version.mjs` reads the tag from `GITHUB_REF_NAME` and exits 0 only if it is
  `v` + the version in `package.json`.
- The release is published with the GitHub CLI: `gh release create <tag> <files>` (gh is installed on
  GitHub-hosted runners).
- The environment that guards releases is called `release`.
