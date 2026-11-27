# Canteen ordering API — load balancing

At lunchtime the canteen's ordering API gets more traffic than one instance can take, so it now runs as three
instances, `app1`, `app2` and `app3`. Monthly reports come from a separate report service with two instances,
`r1` and `r2`; a report can take several seconds. A small `fallback` service shows a "please order at the
counter" message. Every instance listens on port 8000 and is reached by its name. Nginx is the only public
entry point, on port 80.

`nginx.conf` is a first draft from before the scale-up. In this folder every instance is a stand-in
(`services/echo.js`) that answers with its own name, so each `curl` shows who answered.

## Rules

1. **`/api/`** is spread evenly across `app1`, `app2` and `app3`, taking turns. All Nginx worker processes must
   share one view of the group (its turn and which instances have failed), so the spread stays even however
   many workers there are.
2. **`fallback`** gets requests only when `app1`, `app2` and `app3` are all unavailable.
3. **`/reports/`** goes to `r1` and `r2`, but a new request goes to the instance with the **fewest requests in
   progress** — not strictly taking turns, because one long report would otherwise make every second user wait.
4. **No errors for a crash.** If an instance refuses connections (crashed), users must not notice.
5. **No errors for maintenance.** An instance in maintenance answers `503`. A `GET` that meets it is tried on
   another instance instead of showing the `503`.
6. **Never order twice.** A `POST` (an order) that has reached an instance must never be sent to a second one,
   even if the first answered `503` — it may already have taken the payment.

## Try it

```bash
docker compose up -d             # port 8080 taken? PROXY_PORT=8081 docker compose up -d
for i in 1 2 3 4 5 6; do curl -s http://127.0.0.1:8080/api/menu | head -n 1; done
curl -s "http://127.0.0.1:8080/reports/yearly?delay_ms=3000" & sleep 0.5; curl -s http://127.0.0.1:8080/reports/daily; wait
docker compose exec app3 wget -qO- "http://127.0.0.1:9000/?mode=503"    # put app3 into maintenance
docker compose exec app2 wget -qO- "http://127.0.0.1:9000/?mode=down"   # crash app2
docker compose exec app1 wget -qO- "http://127.0.0.1:9000/"             # app1's mode and request counts
docker compose logs proxy                                               # Nginx's access and error log
```

`services/echo.js` lists every control command. After each edit of `nginx.conf`:
`docker compose exec proxy nginx -t && docker compose exec proxy nginx -s reload`.

Check your work with `bash check.sh .` (from the project page). It starts its own copies of the services and of
Nginx 1.24, so `docker compose` does not need to be running.
