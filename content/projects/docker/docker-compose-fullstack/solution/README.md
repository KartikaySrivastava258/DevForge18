# Campus Noticeboard — Compose

Three services make up the noticeboard:

- `web` — Nginx (official image) serving `web/site/` and forwarding `/api/` to `api:3000` (`web/nginx.conf`).
- `api` — the Node.js API in `api/` (its `Dockerfile` is finished). It finds Redis at `REDIS_HOST` and has a
  health endpoint, `GET /api/health`, that answers 200 only when Redis answers.
- `redis` — Redis, where the notices are stored. The official image keeps its data in `/data`.

`compose.yaml` is the author's first draft. It starts — on their laptop — but it is not fit to share.

## Requirements for compose.yaml

1. **Pinned images.** `web` uses Nginx 1.27 and `redis` uses Redis 7.4, both on Alpine and both pinned by
   **digest** (`image: name:tag@sha256:…`). The API's base image is already pinned in `api/Dockerfile`.
2. **One way in.** Only `web` publishes a port, bound to `127.0.0.1`, with the host port taken from the
   `WEB_PORT` variable (default 8080): `"127.0.0.1:${WEB_PORT:-8080}:80"`. `api` and `redis` publish nothing —
   they talk over the project network by service name.
3. **Start in the right order, for real.** `redis` has a health check (`redis-cli ping`); `api` waits until
   `redis` is **healthy**. `api` has a health check on `/api/health`; `web` waits until `api` is **healthy**.
   `docker compose up -d --wait` returns only when all of this has happened.
4. **Data that outlives containers.** Redis keeps `/data` in a **named volume**, so notices survive
   `docker compose down` followed by `docker compose up`. (`down -v` deletes them, on purpose.)

## Try it

```bash
docker compose up -d --build --wait        # with your compose.yaml: WEB_PORT=8081 if 8080 is taken
curl -s http://127.0.0.1:8080/api/notices
curl -s -X POST -H 'Content-Type: application/json' -d '{"title":"Library closes at 6 pm on Friday"}' http://127.0.0.1:8080/api/notices
docker compose ps                          # STATUS shows (healthy) for services with a health check
docker compose down && docker compose up -d --wait && curl -s http://127.0.0.1:8080/api/notices
docker compose down -v                     # remove everything, including the data
```

Open `http://127.0.0.1:8080/` in a browser to use the page.
