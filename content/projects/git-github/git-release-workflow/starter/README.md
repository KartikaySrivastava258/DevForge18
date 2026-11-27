# semver-lite

A tiny library that parses and compares semantic version numbers (`MAJOR.MINOR.PATCH`).

```js
import { compare } from "semver-lite";
["1.10.0", "1.2.0", "1.9.3"].sort(compare); // ["1.2.0", "1.9.3", "1.10.0"]
```

Run the tests with `npm test` (Node.js 22 or later).

## Open issues before 1.0.0

- **Bug report:** `compare("1.10.0", "1.9.0")` returns a negative number, so 1.10.0 sorts before 1.9.0.
- **No automation:** nothing runs the tests on pull requests, and releases are made by hand.
- **No changelog:** users cannot see what changed between versions.
