---
id: github-actions-cache-dependencies
title: Cache dependencies
track: github-actions
level: intermediate
mode: local
estimated_minutes: 35
prerequisites: [github-actions-caching-and-artifacts]
objectives:
  - See what a dependency cache holds by filling npm's cache once and then installing with no network access at all.
  - Predict when a cache key built from the lockfile changes, and what a partial restore through restore-keys still saves.
  - Write a workflow that caches npm's download folder, not node_modules, keyed on package-lock.json.
checkpoints:
  - { id: offline, text: "npm ci --offline failed with ENOTCACHED on an empty cache and succeeded once the cache was filled" }
  - { id: partial, text: "After one dependency changed, the old cache still supplied the unchanged package" }
  - { id: check-passed, text: "The check script printed All checks passed" }
resources:
  - title: Dependency caching reference
    url: https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching
    publisher: GitHub
    type: documentation
    level: beginner
    official: true
    why: Cache keys, restore keys, cache hits, eviction and security notes.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: npm ci
    url: https://docs.npmjs.com/cli/v10/commands/npm-ci
    publisher: npm Docs
    type: reference
    level: intermediate
    official: true
    why: Needs an existing package-lock.json, never writes to package.json or the lockfile, and exits with an error instead of updating the lockfile when the two disagree.
    verification: { status: verified, checked_on: 2026-11-28 }
verification:
  method: executed
  details: Every step and the check script are run by DevForge's test suite with Node.js 22 and its bundled npm, installing two small packages (ms 2.1.3 and picocolors 1.1.1/1.1.0) from the npm registry, and their output is compared with this page; the workflow is validated by DevForge's workflow checker. The check script is also run in an empty folder, where it must fail. Restoring the cache on GitHub itself is not run, because it needs github.com.
starts_fresh: true
owner: content-team
last_reviewed: 2026-11-28
content_version: 1
---

## Goal

Every GitHub Actions job starts on a fresh machine and downloads every dependency again. A cache brings the downloads back — but what exactly is in it, when is it used, and when is it thrown away? You fill npm's download cache once, prove that an install then needs **no network at all**, watch the key change when a dependency changes, and write the workflow step that does this on GitHub.

## Before you start

You need Node.js 22 with npm and an internet connection (the first install downloads two tiny packages from the npm registry). The lab keeps npm's cache in a folder inside the lab with `--cache`, so it does not touch your own `~/.npm`. On Windows, use a WSL or Git Bash terminal.

## Steps

### 1. A project with two locked dependencies

```bash run
mkdir cache-lab && cd cache-lab
cat > package.json <<'EOF'
{
  "name": "cache-lab",
  "version": "1.0.0",
  "private": true,
  "dependencies": { "ms": "2.1.3", "picocolors": "1.1.1" }
}
EOF
npm install --package-lock-only --no-audit --no-fund --cache "$PWD/lock-cache" > npm.log 2>&1 || { cat npm.log; exit 1; }
rm -rf lock-cache
node -e 'const l = require("./package-lock.json"); for (const [p, v] of Object.entries(l.packages)) if (p) console.log(p, v.version, v.integrity.slice(0, 7) + "…")'
```

```text output
node_modules/ms 2.1.3 sha512-…
node_modules/picocolors 1.1.1 sha512-…
```

The lockfile records each package's exact version and an **integrity** hash. `npm ci` installs exactly this, and refuses a download whose hash differs.

### 2. An empty cache, and no network

`--offline` tells npm to use only its cache. With an empty cache — a fresh runner without a cache step — that cannot work:

```bash run
npm ci --offline --no-audit --no-fund --cache "$PWD/npm-cache" > offline.log 2>&1 && echo "installed" || echo "failed: $(grep -o 'ENOTCACHED' offline.log | head -n 1)"
```

```text output
failed: ENOTCACHED
```

### 3. Fill the cache once, then install with no network

```bash run
npm ci --no-audit --no-fund --cache "$PWD/npm-cache" > online.log 2>&1 && ls node_modules
rm -rf node_modules            # the next job starts on a fresh machine ...
npm ci --offline --no-audit --no-fund --cache "$PWD/npm-cache" > offline.log 2>&1 && echo "offline install: ok" && ls node_modules
```

```text output
ms
picocolors
offline install: ok
ms
picocolors
```

The second install downloaded nothing: every package came from `npm-cache`. That folder is what a CI cache saves and restores. It holds the **downloads**, not `node_modules`: `npm ci` deletes `node_modules` before it installs, and the downloads work on any operating system and Node version, while a `node_modules` folder may not.

### 4. When the key changes

The workflow below builds its key from a hash of `package-lock.json`. Upgrade nothing, and the key stays the same — a cache hit. Change one locked version, and the key changes:

```bash run
key() { echo "npm-Linux-$(sha256sum package-lock.json | cut -c1-12)"; }
old=$(key)
sed -i 's/"picocolors": "1.1.1"/"picocolors": "1.1.0"/' package.json
npm install --package-lock-only --no-audit --no-fund --cache "$PWD/lock-cache" > npm.log 2>&1 && rm -rf lock-cache
new=$(key)
[ "$old" = "$new" ] && echo "same key" || echo "new key: no exact cache hit"
rm -rf node_modules
npm ci --offline --no-audit --no-fund --cache "$PWD/npm-cache" > offline.log 2>&1 && echo "offline install: ok" || echo "offline install: $(grep -o 'ENOTCACHED' offline.log | head -n 1) — picocolors 1.1.0 was never downloaded"
npm ci --prefer-offline --no-audit --no-fund --cache "$PWD/npm-cache" > online.log 2>&1 && node -e 'console.log("installed:", ["ms", "picocolors"].map((p) => p + "@" + require("./node_modules/" + p + "/package.json").version).join(", "))'
```

```text output
new key: no exact cache hit
offline install: ENOTCACHED — picocolors 1.1.0 was never downloaded
installed: ms@2.1.3, picocolors@1.1.0
```

With a new key there is no exact hit, so `restore-keys` restores the most recent cache whose key starts with `npm-Linux-` — the old one. It still holds `ms`, so only the changed package is downloaded. At the end of the job, the cache is saved under the new key; caches are never changed in place.

### 5. The workflow

```bash run
mkdir -p .github/workflows
cat > .github/workflows/ci.yml <<'EOF'
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
      - name: Restore npm's download cache
        uses: actions/cache@v6
        with:
          path: ~/.npm
          key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
          restore-keys: |
            npm-${{ runner.os }}-
      - run: npm ci
      - run: npm test --if-present
EOF
grep -E "uses:|key:" .github/workflows/ci.yml
```

```text output
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        uses: actions/cache@v6
          key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
```

- `path: ~/.npm` is npm's default cache folder on Linux and macOS runners — the same role `npm-cache` played above (`npm config get cache` shows yours).
- The `key` changes exactly when `package-lock.json` changes; `restore-keys` gives a partial hit after a dependency change.
- `actions/setup-node` can do the same with one line, `cache: npm`, which also keys on the lockfile; the explicit step shows what that line does.
- Never cache folders that contain secrets: anyone who can run a workflow in the repository can read its caches.

## Check your work

Run this inside `cache-lab`. It copies the project to a temporary folder and installs it there **offline**, from your `npm-cache`.

```bash run check
bash <<'CHECK'
fail=0
check() { if eval "$2" > /dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }
wf=.github/workflows/ci.yml
check "package-lock.json pins every dependency with an integrity hash" 'node -e "const l = require(\"./package-lock.json\"); const p = Object.entries(l.packages).filter(([k]) => k); if (!p.length || p.some(([, v]) => !/^sha512-/.test(v.integrity || \"\"))) process.exit(1)"'
check "the npm cache in npm-cache installs this project with no network" 't=$(mktemp -d) && cp package.json package-lock.json "$t" && (cd "$t" && npm ci --offline --no-audit --no-fund --cache "$OLDPWD/npm-cache") && rm -rf "$t"'
check "the workflow caches npm downloads (~/.npm), not node_modules" 'grep -E "^ +path: ~/.npm$" $wf && ! grep -E "path: .*node_modules" $wf'
check "the cache key comes from package-lock.json" 'grep -F "hashFiles('\''package-lock.json'\'')" $wf'
check "restore-keys allow a partial hit after a dependency change" 'grep -A1 "restore-keys:" $wf | grep "npm-"'
check "the workflow installs with npm ci" 'grep -E "run: npm ci$" $wf'
if [ "$fail" -eq 0 ]; then echo "All checks passed"; else echo "Some checks failed"; exit 1; fi
CHECK
```

```text output
PASS: package-lock.json pins every dependency with an integrity hash
PASS: the npm cache in npm-cache installs this project with no network
PASS: the workflow caches npm downloads (~/.npm), not node_modules
PASS: the cache key comes from package-lock.json
PASS: restore-keys allow a partial hit after a dependency change
PASS: the workflow installs with npm ci
All checks passed
```

## Reset

The lab only creates the `cache-lab` folder. To start again, leave it and delete it — `cd .. && rm -rf cache-lab` — then begin at step 1.

## What you practised

A dependency cache is a folder of downloads saved under a key. A key built from the lockfile gives an exact hit while dependencies stay the same, and `restore-keys` still saves most downloads when one changes. Cache the downloads (`~/.npm`), let `npm ci` build `node_modules`, and keep secrets out of cached paths.
