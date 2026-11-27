# Campus Store — frontend and API gateway

Campus Store is a single-page app: `site/` holds the built frontend (`index.html` and fingerprinted files in
`site/assets/`, whose names change whenever their content does). The app's router shows pages such as
`/orders/42` in the browser; there is no file of that name on the server. The API is two services, `users`
and `orders`, each on port 8000 inside the private network. One Nginx on port 80 serves both the app and the
API; the services expect paths **without** the `/api/v1` prefix.

In this folder the services are stand-ins (`services/echo.js`) that answer with what they received.

## The frontend

- `/` and every path that is not a file (`/orders/42`, `/account`) get `index.html` with status 200.
- `index.html` is revalidated on every visit: `Cache-Control: no-cache`.
- Files in `/assets/` are cached for a year and marked immutable:
  `Cache-Control: public, max-age=31536000, immutable`. A missing asset gets **404**, never `index.html`.
- JavaScript and CSS are gzip-compressed for clients that accept it, with `Vary: Accept-Encoding`.
- The frontend is not rate-limited.

## The API gateway

| Request                     | Goes to  | Path the service sees |
|-----------------------------|----------|-----------------------|
| `/api/v1/users/42?x=1`      | `users`  | `/users/42?x=1`       |
| `/api/v1/users/avatar`      | `users`  | `/users/avatar`       |
| `/api/v1/orders/7/items`    | `orders` | `/orders/7/items`     |
| any other `/api/…`          | nobody   | Nginx answers `404` with `{"error":"not found"}` as `application/json` |

- The services receive `Host`, `X-Forwarded-For` (client address appended) and `X-Forwarded-Proto`.
- Request bodies: at most **100 KB** for the API, except avatar uploads (`/api/v1/users/avatar`), which may be
  up to **5 MB**. Larger requests get `413`.
- Each client may send **10 API requests per second**, with bursts of up to **20** extra served without delay.
  Requests beyond that get **`429 Too Many Requests`** (not Nginx's default 503).

## Every response

- `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` on **every** response — assets, API answers
  and errors (404, 413, 429) included. `snippets/security-headers.conf` has them.
- `Server: nginx`, without the version number.

## Try it

```bash
docker compose up -d             # port 8080 taken? PROXY_PORT=8081 docker compose up -d
curl -i http://127.0.0.1:8080/orders/42
curl -s -o /dev/null -D - http://127.0.0.1:8080/assets/app.3f9a1c7.js
curl -s "http://127.0.0.1:8080/api/v1/users/42?x=1"
for i in $(seq 1 40); do curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/api/v1/users/1; done | sort | uniq -c
head -c 204800 /dev/zero | curl -s -o /dev/null -w '%{http_code}\n' --data-binary @- http://127.0.0.1:8080/api/v1/orders/
```

After each edit: `docker compose exec proxy nginx -t && docker compose exec proxy nginx -s reload`.

Check your work with `bash check.sh .` (from the project page). It starts its own copies of the services and of
Nginx 1.24, with `nginx.conf`, `site/` and `snippets/` in the same places as `compose.yaml` mounts them.
