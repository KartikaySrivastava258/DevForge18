# Deployment

> The Docker and Nginx files in `deploy/` were written and syntax-checked but **not executed** in the build environment. Expect to validate them on first deployment, and report any fix back to the repository.

## Option A — Docker Compose (recommended)

```bash
cd deploy
PUBLIC_ORIGIN=http://localhost:8080 docker compose up --build -d
docker compose exec app node --disable-warning=ExperimentalWarning scripts/create-user.ts \
  --email you@college.edu --name "Your Name" --role admin   # prompts for a password
```

- `app` runs as the unprivileged `node` user with a read-only filesystem; data lives in the `devforge-data` volume at `/data`.
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

## Backups and restore

```bash
npm run db:backup                       # ./backups/devforge-<timestamp>.db, integrity-checked
```

`VACUUM INTO` produces a consistent copy while the server runs. Copy backups off the machine. To restore: stop the server, replace the file at `DATABASE_PATH` with the backup, delete any `-wal`/`-shm` files beside it, start the server. **Test a restore at least once per term.**

## Upgrades

1. Back up the database.
2. Pull the new version, `npm install`, `npm run build`.
3. Start the server — pending migrations apply automatically at start-up (or run `npm run db:migrate` first).
4. Check `/api/ready` and the logs.

Migrations are forward-only. To roll back code, restore the pre-upgrade backup as well.

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
