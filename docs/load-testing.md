# Load testing

The API is load-tested with [k6](https://grafana.com/docs/k6/latest/) (`load/api.js`). `npm run test:load` (`scripts/load-test.sh`) starts the production server exactly as `npm start` does (`NODE_ENV=production`, scrypt at its production cost N = 2¹⁷, normal request logging) on a throwaway SQLite database, waits until it is ready, runs k6, prints the server's peak memory and CPU time, and removes the database. CI runs it nightly and on manual runs (job *API load test (k6)*); it does not run on every push.

## What the test does

Three groups of virtual users (VUs) run at the same time:

| Scenario | Who | Requests per iteration |
|---|---|---|
| `browse` | Anonymous visitors, ramped up over 20 s | App shell (`/tracks/:slug`), `/api/tracks`, `/api/tracks/:slug`, `/api/lessons/:id`, `/api/search`, `/api/paths`, `/api/graph`; the hashed app script once per VU; 1–3 s think time |
| `learners` | Signed-in students | Sign in once, then per iteration: read a lesson, 2–4 s reading, submit its self-check (`POST /api/lessons/:id/check`, CSRF header and `Origin` as a browser sends them, progress saved), dashboard data (`/api/me/progress`), 1–3 s pause |
| `signin` | New sessions at a fixed rate | `POST /api/auth/login` with a fresh cookie jar |

Accounts are registered in k6's `setup()`, before the measured load.

**Client addresses.** The server runs with `TRUST_PROXY=true` and every VU sends its own `X-Forwarded-For`, standing for a different student behind the production Nginx proxy. Without this, all requests would come from `127.0.0.1` and the per-address limits (1,200 API requests a minute, 200 sign-ins per 15 minutes) would be measured instead of the server. See [Limits that apply before the server's capacity](#limits-that-apply-before-the-servers-capacity).

**Thresholds** (a breach fails the run): error rate below 1 %, checks above 99 %, p95 latency below 100 ms for `browse`, below 200 ms for `learners`, and below 2 s for sign-in. They were set from the measurements below (default load: browse p95 7–13 ms, learners p95 6–12 ms, sign-in p95 0.8–1.05 s), with headroom because CI runners are slower and noisier than the machine below: 8–17× for reads, 2× for sign-in (scrypt is CPU-bound and scales with the CPU).

Settings: `BROWSE_VUS` (default 50), `LEARNER_VUS` (20), `SIGNIN_RATE` (sign-ins per second, 2), `DURATION` (steady phase, `2m`), passed as `npm run test:load -- -e BROWSE_VUS=200`. `LOAD_PORT` (default 8090) and `K6` (path to the binary) are read by the runner script.

## Installing k6

Use the pinned release, **k6 v2.4.0** (GitHub release published 2026-11-12), and verify it — the CI job does exactly this:

```bash
curl -fsSLO https://github.com/grafana/k6/releases/download/v2.4.0/k6-v2.4.0-linux-amd64.tar.gz
curl -fsSLO https://github.com/grafana/k6/releases/download/v2.4.0/k6-v2.4.0-checksums.txt
echo "5a5ecf23529ccf93135bc7e5b0c1cd5126ecf5f2672e22eed1556a0ab74abb87  k6-v2.4.0-linux-amd64.tar.gz" | sha256sum -c -
grep " k6-v2.4.0-linux-amd64.tar.gz$" k6-v2.4.0-checksums.txt | sha256sum -c -
tar -xzf k6-v2.4.0-linux-amd64.tar.gz && K6=$PWD/k6-v2.4.0-linux-amd64/k6 npm run test:load
```

## Measured results (2026-11-27)

**Machine:** AMD Ryzen 7 7735HS laptop (8 cores / 16 threads), 14.4 GiB RAM, Linux Mint 22.2, Node v22.23.2, k6 v2.4.0. k6 ran on the same machine as the server, and the machine was shared with other work (containers and builds from other sessions); the 1-minute load average at the start of each run is given because it visibly changed the results. Each run adds a 20 s ramp-up and a 10 s ramp-down to the steady phase. All numbers are copied from the k6 summaries and the runner's output; nothing is estimated.

| Run | Browse VUs / learner VUs / sign-ins per s, steady phase | Load avg. at start | Requests (rate) | Errors | p95 browse | p95 learners | Sign-in median / p95 | Slowest request | Server peak memory / CPU time |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 50 / 20 / 2, 2 min (default) | 9.7 | 25,527 (155/s) | 0 % | 12.8 ms | 11.6 ms | 623 ms / 1.05 s | 1.12 s | 447 MiB / 239 s |
| 2 | 100 / 50 / 2, 1 min | 4.5 | 28,995 (250/s) | 0 % | 7.5 ms | 6.9 ms | 431 ms / 639 ms | 894 ms | 439 MiB / 134 s |
| 3 | 200 / 100 / 4, 1 min | 4.8 | 48,871 (336/s) | 0 % | **272 ms** | **255 ms** | 763 ms / 1.26 s | 3.5 s | 663 MiB / 379 s |
| 4 | 200 / 100 / 1, 1 min | 1.2 | 55,647 (412/s) | 0 % | 65 ms | 97 ms | 581 ms / 776 ms | 1.0 s | 568 MiB / 203 s |
| 5 | 50 / 20 / 2, 2 min (default, final thresholds, via `npm run test:load`) | 1.4 | 25,754 (155/s) | 0 % | 7.2 ms | 5.5 ms | 411 ms / 808 ms | 894 ms | 461 MiB / 179 s |

Every check passed in every run (lesson grading saved progress, every sign-in set a session cookie). Run 3 crossed the browse threshold in force at the time (p95 < 250 ms) and would also fail today's; no run had a failed request.

### What the numbers say

- **Reads are cheap.** At the default load and at 100 + 50 users, 95 % of catalogue, lesson, search and progress requests took under 13 ms, and the median about 1 ms or less.
- **One Node.js process starts to queue at around 300 concurrent active users.** With 200 browsing and 100 learning users (336–412 requests a second), p95 latency rose to 65–272 ms depending on the sign-in rate and on the other load on the machine; still no errors. The single event loop is the likely limit; this was not profiled.
- **Sign-in is the expensive request**, by design: scrypt with N = 2¹⁷ took a median of 0.4–0.8 s per sign-in here, and needs 128 MiB of memory while it runs (N × r × 128 bytes with r = 8). Peak server memory grew from about 440 MiB at 2 sign-ins a second to 663 MiB at 4 a second. Plan memory for the expected number of simultaneous sign-ins (for example the start of a class), not for the number of users.
- The server sent about 2 MB/s uncompressed at the default load (Nginx compresses in production; this test bypasses it).

### Limits that apply before the server's capacity

These come from the configuration, not from the measurements above, and matter for a campus where many students share one public address (NAT):

- The app allows **1,200 API requests a minute per client address** and **200 sign-ins per 15 minutes per address**; Nginx allows 30 requests a second per address (burst 60). By the script's design a `browse` user makes 6 API requests and then pauses 1–3 s (roughly 120–360 a minute) and a `learner` makes 3 requests in 3–7 s (roughly 25–60 a minute), so a room of students behind one address would reach the app limit at a few dozen active students, earlier for heavy browsing. Students would see "Too many requests" (429), not a slow site.
- Before institution-wide use, find out whether students reach the server from distinct addresses; if not, raise the per-address limits (in `server/src/app.ts` and `deploy/nginx/nginx.conf`) or key them on the account for signed-in requests, and repeat this test without per-VU addresses.

### Not covered

- Through Nginx (compression, `limit_req`) — the Compose smoke test covers Nginx's behaviour, not its throughput.
- More than one instance (rate limits are per process; ADR 0004), PostgreSQL, long soak runs, memory growth over days.
- Write-heavy paths other than lesson checks (quizzes, simulations, labs, bookmarks) and admin pages.
- A CI runner's numbers: the nightly job has not run yet; read the first run's summary (artifact `load-summary`) and adjust the thresholds if they prove too tight for the runner.
