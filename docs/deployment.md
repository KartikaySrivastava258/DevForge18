# Deployment

> The files in `deploy/` are tested: `npm run test:compose` (`scripts/compose-smoke.sh`, also the CI job *Docker Compose and Nginx smoke test*) builds the image, starts Compose and checks through Nginx the health and readiness endpoints, an SPA route with the strict CSP and security headers, 18 tracks from the API, CSRF rejections, caching of hashed assets, gzip, the hidden `/metrics`, sign-up and sessions, `user:create` and `db:backup` inside the read-only container, data surviving a restart, Nginx's 429 rate limit, and that only Nginx's port is published. Set `DEVFORGE_HTTP_PORT` to run it when port 8080 is taken; it removes its containers, volume and image afterwards (`KEEP=1` keeps them).

## Option A — Docker Compose (recommended)

```bash
cd deploy
PUBLIC_ORIGIN=http://localhost:8080 docker compose up --build -d
docker compose exec app node --disable-warning=ExperimentalWarning scripts/create-user.ts \
  --email you@college.edu --name "Your Name" --role admin   # prompts for a password
```

- `app` runs as the unprivileged `node` user with a read-only filesystem; data lives in the `devforge-data` volume at `/data`.
- Both containers run with `read_only: true` and `no-new-privileges`; Nginx writes only to tmpfs mounts. Images are pinned by version and digest (`deploy/Dockerfile`, `deploy/docker-compose.yml`); update them deliberately and rerun `npm run test:compose`.
- To publish Nginx on another host port, set both `DEVFORGE_HTTP_PORT=8090` and `PUBLIC_ORIGIN=http://localhost:8090` (the origin must match what browsers use, or the CSRF check refuses sign-in).
- Backups inside the container must go to the volume, because the image's filesystem is read-only: `docker compose exec app node --disable-warning=ExperimentalWarning scripts/db-backup.ts /data/backups/devforge-$(date +%F).db`, then copy the file off the machine (`docker compose cp app:/data/backups/… .`).
- `nginx` is the only published port. For HTTPS, terminate TLS in Nginx (add a `listen 443 ssl` server block with your certificate, for example from Let's Encrypt), then set `PUBLIC_ORIGIN=https://your.host` and `COOKIE_SECURE=true`.

## Option B — Node directly (a lab machine or VM)

```bash
npm install
npm run build
NODE_ENV=production HOST=127.0.0.1 PORT=8080 \
PUBLIC_ORIGIN=https://devforge.example.edu COOKIE_SECURE=true TRUST_PROXY=true \
DATABASE_PATH=/var/lib/devforge/devforge.db npm start
```

Run it under a process manager (systemd, for example) and put Nginx in front using `deploy/nginx/nginx.conf` as a starting point (change `server app:8080` to `127.0.0.1:8080`).

## Content editor (optional)

Faculty and admins can edit content files in the browser (**Edit content** in the menu); each edit becomes a pull request on GitHub, so review and CI still decide what is published ([ADR 0011](adr/0011-cms-pull-requests.md)). Without the settings below the page says the editor is turned off; the server starts either way.

| Variable | Example | Purpose |
|---|---|---|
| `GITHUB_REPOSITORY` | `your-org/devforge18` | Repository that holds `content/` (`owner/name`) |
| `GITHUB_TOKEN` | — | Fine-grained token for that repository only: **Contents: read and write**, **Pull requests: read and write**. No other permissions. |
| `GITHUB_API_URL` | `https://api.github.com` (default) | API base URL; set it for GitHub Enterprise Server (`https://ghe.example.edu/api/v3`). Must be `https://`. |

1. On GitHub: *Settings → Developer settings → Fine-grained tokens → Generate new token*. Resource owner: the repository's owner; repository access: only this repository; permissions as above; set an expiry and note it in your calendar.
2. Protect the default branch (required review and the CI checks) so editor pull requests cannot be merged unreviewed.
3. Pass the variables to the app container or service (for Compose, an `env_file:` that is not committed), restart, and check the start-up log line `contentEditor: "enabled"`.
4. Try one edit as a faculty account and confirm the pull request appears. The automated tests use a local fake of the GitHub API, so this first real run is the integration test.

Changes appear on the site only after the pull request is merged and the site is rebuilt and redeployed.

## Backups and restore

Run backups with the server's own `DATABASE_PATH` (Option B: `/var/lib/devforge/devforge.db`; the default is `./data/devforge.db`). `db:backup` refuses a path where no database exists.

```bash
DATABASE_PATH=/var/lib/devforge/devforge.db npm run db:backup     # ./backups/devforge-<timestamp>.db, integrity-checked
DATABASE_PATH=/var/lib/devforge/devforge.db npm run db:backup -- /srv/backups/devforge-$(date +%F).db
```

`VACUUM INTO` produces a consistent copy while the server runs; the script then opens the copy, runs `PRAGMA integrity_check` and prints `Backup OK: … (integrity ok, N user(s))`. Copy backups off the machine.

To restore:

1. Stop the server.
2. Replace the file at `DATABASE_PATH` with the backup (`cp backup.db "$DATABASE_PATH"`), and delete any `-wal`/`-shm` files beside it (`rm -f "$DATABASE_PATH-wal" "$DATABASE_PATH-shm"`): they belong to the database you replaced.
3. Start the server and check `/api/ready`. Everything written after the backup was taken is gone.

**Test a restore at least once per term.** `npm run test:upgrade` (below) runs exactly these steps: a backup while the server runs, a change, stop, restore, start, and checks that every user sees the state at backup time.

## Upgrades

1. Back up the database (as above).
2. Pull the new version, `npm install`, `npm run build`.
3. Start the server — pending migrations apply automatically at start-up and are logged (`migrations applied`). Or run them first with the same `DATABASE_PATH` as the server: `DATABASE_PATH=/var/lib/devforge/devforge.db npm run db:migrate` prints the database it migrated and the migrations it applied.
4. Check `/api/ready` and the logs.

Existing accounts, passwords, sessions, progress and bookmarks are kept; signed-in users stay signed in. Migrations are forward-only. To roll back code, restore the pre-upgrade backup (as above) and start the old version on it.

`npm run test:upgrade` (`scripts/upgrade-test.sh`, also the CI job *Upgrade, backup and restore*) tests this procedure from two older versions — `eeac236` (Milestone 8, migrations 0001–0004) and `21ad03b` (Phase 0, migration 0001 only). It extracts each with `git archive`, creates an admin and learners with progress, bookmarks, quiz attempts, labs and simulation challenges through the old server's API, takes the old version's backup, stops it, migrates a copy with the current `db:migrate` and checks that every existing row is unchanged, that the same users sign in with the same passwords and see the same data, and that certificates, cohorts, assignments and data export work on it; then backup and restore with the current version, and the rollback. `UPGRADE_FROM=<commit>` picks other old versions; see [testing](testing.md).

## Monitoring

Point Prometheus at `http://app:8080/metrics` from inside the private network. Useful starting queries:

```promql
sum(rate(devforge_http_requests_total{status=~"5.."}[5m])) / sum(rate(devforge_http_requests_total[5m]))
histogram_quantile(0.95, sum by (le, route) (rate(devforge_http_request_duration_seconds_bucket[5m])))
```

Alert on symptoms (error ratio, p95 latency, `/api/ready` failing), not on causes.

### Tracing (optional)

Set `OTEL_EXPORTER_OTLP_ENDPOINT` (for example `http://otel-collector:4318`) and `OTEL_SERVICE_NAME=devforge` to send one span per request to an OpenTelemetry Collector as OTLP/HTTP JSON ([ADR 0009](adr/0009-opentelemetry-tracing.md)). Each access log line then carries a `traceId` you can paste into Jaeger or another trace UI. Watch `devforge_otel_spans_dropped_total`: it grows when the Collector is unreachable. The OpenTelemetry lab *Trace DevForge's own requests* walks through it with a Collector and Jaeger.

## Several instances: shared rate limits

Rate limits are counted in each process by default. When more than one DevForge instance serves the same site, set `REDIS_URL=redis://redis:6379/0` (Redis 7.x on the private network; `rediss://` for TLS, `redis://user:password@host:6379/0` with ACLs) so all instances share one limit ([ADR 0010](adr/0010-shared-rate-limits-redis.md)). If Redis becomes unreachable, each instance falls back to its own counters and logs `rate-limit store unavailable`; alert on `devforge_rate_limit_store_up == 0`. Sessions are still stored in SQLite, so several instances also need a shared database before this is useful in production.
