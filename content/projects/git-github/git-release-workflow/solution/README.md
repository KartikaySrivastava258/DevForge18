# semver-lite

A tiny library that parses and compares semantic version numbers (`MAJOR.MINOR.PATCH`).

```js
import { compare } from "semver-lite";
["1.10.0", "1.2.0", "1.9.3"].sort(compare); // ["1.2.0", "1.9.3", "1.10.0"]
```

Run the tests with `npm test` (Node.js 22 or later).

## Releasing

1. Move the entries under `## [Unreleased]` in CHANGELOG.md to a new `## [x.y.z] - date` section.
2. Set the same version in package.json, commit, and merge the change to main.
3. Tag the merged commit with an annotated tag and push it: `git tag -a vx.y.z -m "x.y.z"` then
   `git push origin vx.y.z`.

The Release workflow then runs the tests again and, only if they pass and the tag matches package.json,
publishes a GitHub release whose notes are that version's changelog section. CI runs the tests on every pull
request and every push to main.
