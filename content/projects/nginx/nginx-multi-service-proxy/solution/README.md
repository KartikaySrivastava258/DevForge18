# Campus Hub entry point

Campus Hub is a student portal made of four services. Each one listens on port 8000 inside the private network
and is reached by its name: `web` (the frontend), `courses`, `notices` and `admin`. Only Nginx is public, on
port 80. `nginx.conf` is its whole configuration — the first draft sends everything to `web`.

In this folder the services are stand-ins (`services/echo.js`) that answer with what they received, so every
response shows which service answered and which headers arrived.

## Routing

| Host                   | Path              | Goes to   |
|------------------------|-------------------|-----------|
| `campus.example`       | `/api/courses/…`  | `courses` |
| `campus.example`       | `/api/notices/…`  | `notices` |
| `campus.example`       | any other `/api/…`| nobody: Nginx answers `404` |
| `campus.example`       | everything else   | `web`     |
| `admin.campus.example` | everything        | `admin`   |
| any other host, or none| everything        | nobody: Nginx refuses it (`404` or `444`) |

Paths and query strings reach the services **unchanged**: `/api/courses/42?term=2` arrives at `courses` as
`/api/courses/42?term=2`.

## What every service must receive

- `Host` — the name the client asked for (`campus.example`), not the internal service name.
- `X-Forwarded-For` — the client's address, appended to any `X-Forwarded-For` the request already carried.
- `X-Forwarded-Proto` — `http` today (`https` once TLS is added).

## Responses

`Server: nginx`, without the version number.

## Try it

```bash
docker compose up -d             # port 8080 taken? PROXY_PORT=8081 docker compose up -d
curl -H "Host: campus.example" http://127.0.0.1:8080/api/courses/42?term=2
curl -H "Host: admin.campus.example" http://127.0.0.1:8080/
curl -i -H "Host: unknown.example" http://127.0.0.1:8080/
docker compose logs proxy        # Nginx's access and error log
```

After each edit: `docker compose exec proxy nginx -t && docker compose exec proxy nginx -s reload`.

Check your work with `bash check.sh .` (from the project page). It starts its own copies of the services and of
Nginx 1.24, so `docker compose` does not need to be running.
