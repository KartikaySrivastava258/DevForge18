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
