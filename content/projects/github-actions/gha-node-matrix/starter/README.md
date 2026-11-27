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

## The problem

CI is green. The workflow in `.github/workflows/test.yml` runs the tests on Node.js 26, which is what the
maintainer has on their laptop. Two of the apps that use this package run on Node.js 22 and 24, and both
teams report that search is broken for them.

## Fixed interface (the check relies on it)

- `src/index.js` exports `highlight`, `encodeCursor` and `decodeCursor` with the behaviour described in its
  comments. Cursors are base64url without padding, so links created by the current version keep working.
- The workflow is `.github/workflows/test.yml`; it installs with `npm ci` and runs `npm test`.
