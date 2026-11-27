# campus-search

Search helpers for the course catalogue, published as a small npm package and used by three apps on campus.

```js
import { highlight, encodeCursor, decodeCursor } from "campus-search";

highlight("Intro to C++", "c++");      // 'Intro to <mark>C++</mark>'
encodeCursor({ page: 2, q: "data" });   // an opaque, URL-safe string for "next page" links
```

`package.json` promises `"engines": { "node": ">=22" }`, so the package must work on every supported Node.js
release line: **22, 24 and 26**.

```bash
npm ci
npm test
```

## Fixed interface (the check relies on it)

- `src/index.js` exports `highlight`, `encodeCursor` and `decodeCursor` with the behaviour described in its
  comments. Cursors are base64url without padding, so links created by the current version keep working.
- The workflow is `.github/workflows/test.yml`; it installs with `npm ci` and runs `npm test`.

## What changed (reference solution)

- `test.yml` runs the job once per Node.js version (22, 24, 26) with `fail-fast: false`, so every broken
  version shows up as its own failed check; actions are pinned to commit SHAs; the token is read-only; npm
  downloads are cached by `setup-node` (keyed on `package-lock.json`); outdated runs are cancelled.
- The matrix found two problems: `RegExp.escape` does not exist in Node.js 22, and
  `Uint8Array.prototype.toBase64` / `Uint8Array.fromBase64` do not exist in 22 or 24. `src/index.js` now uses
  a small escape function and `Buffer`'s `base64url` encoding, which produce the same results on every version.
