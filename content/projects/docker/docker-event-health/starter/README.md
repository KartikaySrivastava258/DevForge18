# Campus events — API, worker and Redis

Clubs post events (room bookings, ticket sales) to an **API**, which queues them in **Redis**; a **worker**
takes them from the queue and processes them in the background. The code in `app/` is finished and has no npm
dependencies:

- `app/api.js` — `GET /health` (200 only when Redis answers), `POST /events` (needs
  `Authorization: Bearer <API key>`, answers 202 with the event's id), `GET /events/<id>` (`queued` or
  `processed`). It reads the API key from `/run/secrets/api_key` (falling back to an `API_KEY` environment
  variable, for quick experiments only). It finds Redis at `REDIS_HOST`.
- `app/worker.js` — processes events; after every successful round trip to Redis it writes a heartbeat to
  `/tmp/worker-heartbeat`, and on `SIGTERM` it finishes the event in hand and exits with 0.
- `app/healthcheck.js` — `node healthcheck.js` exits 0 if the worker reached Redis in the last 5 seconds.

The `Dockerfile` and `compose.yaml` are first drafts. Replace them, and add a `.dockerignore`.

## Requirements

1. **One pinned image.** The `Dockerfile` builds one image with a base pinned by digest; Compose starts it as
   `api` (`node api.js`) and as `worker` (`node worker.js`). Redis 7.4 on Alpine, also pinned by digest.
2. **The API key is a secret.** It comes from a Compose secret read from `secrets/api_key.txt` and mounted at
   `/run/secrets/api_key`. It is in no container's environment and in no file of the image; `.dockerignore`
   keeps `secrets/` out of the build context.
3. **One way in.** Only `api` publishes a port: `"127.0.0.1:${API_PORT:-8090}:3000"`.
4. **Health that means something.** Every service has a health check: Redis answers `PING`; the API's
   `/health` answers; the worker's heartbeat is fresh (`node healthcheck.js`). `api` and `worker` wait until
   `redis` is healthy, and `docker compose up -d --wait` returns once all three are healthy. When Redis stops,
   the API becomes unhealthy; when Redis is back, healthy again.
5. **Least privilege for api and worker.** Not root; a read-only root filesystem (the worker gets a writable
   in-memory `/tmp` for its heartbeat); all capabilities dropped; `no-new-privileges`; a memory limit; logs
   rotated (`json-file` with `max-size`).
6. **Clean shutdown.** `docker compose stop worker` takes under 5 seconds and the worker exits with code 0.
   Events posted while the worker is stopped wait in the queue and are processed when it is back.

## Try it

```bash
cp secrets/api_key.txt.example secrets/api_key.txt     # then replace the value with a long random one
chmod 644 secrets/api_key.txt                          # the app runs as uid 1000 and must be able to read it
docker compose up -d --build --wait                    # with your compose.yaml: API_PORT=8091 if 8090 is taken
KEY="$(cat secrets/api_key.txt)"
curl -s -X POST -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"type":"room-booking","payload":{"room":"LT-2"}}' http://127.0.0.1:8090/events
curl -s http://127.0.0.1:8090/events/<id from the previous answer>
docker compose ps                                      # (healthy) for every service
docker compose stop redis; sleep 20; docker compose ps api; docker compose start redis   # unhealthy after ~3 failed checks
docker compose down -v                                 # remove everything, including the queue
```

`secrets/api_key.txt` must never be committed or copied into the image — only the `.example` file is shared.
