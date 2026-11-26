---
id: nginx-access-control
title: Access control and connection limits
track: nginx
order: 6
level: intermediate
estimated_minutes: 35
prerequisites: [nginx-serving-static-files]
learning_objectives:
  - Allow or deny requests by IP address and network, and predict which rule applies.
  - Protect a location with HTTP basic authentication from an htpasswd file, and know its limits.
  - Combine the two with satisfy any, and limit concurrent connections per client with limit_conn.
resources:
  - title: Module ngx_http_access_module
    url: https://nginx.org/en/docs/http/ngx_http_access_module.html
    publisher: nginx.org
    type: documentation
    level: beginner
    official: true
    why: allow and deny, and that rules are checked in order until the first match.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Module ngx_http_auth_basic_module
    url: https://nginx.org/en/docs/http/ngx_http_auth_basic_module.html
    publisher: nginx.org
    type: documentation
    level: beginner
    official: true
    why: auth_basic, auth_basic_user_file, and the password hash formats it accepts (including openssl passwd -apr1).
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Module ngx_http_limit_conn_module
    url: https://nginx.org/en/docs/http/ngx_http_limit_conn_module.html
    publisher: nginx.org
    type: documentation
    level: intermediate
    official: true
    why: limit_conn_zone, limit_conn and limit_conn_status (503 by default).
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: order
    prompt: "A location has: allow 10.0.0.0/8; deny all; — a request comes from 192.168.1.5. What happens?"
    options:
      - { id: a, text: "Allowed, because allow comes first" }
      - { id: b, text: "Denied with 403: rules are checked in order until the first match, and the first rule that matches 192.168.1.5 is deny all" }
      - { id: c, text: "Nginx asks for a password" }
    answer: b
    explanation: 192.168.1.5 is not in 10.0.0.0/8, so the first rule does not match; deny all does.
  - id: basic-auth
    prompt: Why must basic authentication only be used over HTTPS?
    options:
      - { id: a, text: "It is faster over HTTPS" }
      - { id: b, text: "The browser sends the user name and password with every request, only base64-encoded — anyone who can read plain HTTP traffic can decode them" }
      - { id: c, text: "Nginx refuses it over HTTP" }
    answer: b
    explanation: Base64 is an encoding, not encryption. Combine basic auth with TLS (previous lesson).
  - id: satisfy
    prompt: "A location has satisfy any; allow 10.0.0.0/8; deny all; and basic auth. Who gets in?"
    options:
      - { id: a, text: "Only requests from 10.0.0.0/8 that also send a valid password" }
      - { id: b, text: "Requests from 10.0.0.0/8 without a password, and requests from anywhere else with a valid password" }
      - { id: c, text: "Nobody" }
    answer: b
    explanation: satisfy any lets a request in if at least one access check passes; satisfy all (the default) requires all of them.
verification:
  method: executed
  details: Every command is run by the test suite with Nginx 1.24, OpenSSL 3 and curl, and its output is compared with this lesson. The behaviour of each module was checked against the nginx.org documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

Before a request reaches the application, Nginx can decide **who** may make it — by **IP address** (`allow`/`deny`), by **password** (`auth_basic`), or either (`satisfy any`) — and **how much** one client may use at once (`limit_conn`).

## Explain it like I'm twelve

A school event has three ways in: pupils from this school walk in (an IP rule), visitors show a ticket at the door (a password), and nobody is allowed to bring twenty friends at once (a connection limit).

Where the analogy breaks: an IP address says which network a request came from, not which person sent it.

## What problem it solves

Admin pages, staging sites and internal reports should not be open to the internet, and one client opening hundreds of connections can starve everyone else. Putting these checks in Nginx protects every application behind it in the same way — before a single line of application code runs.

## How it works

![](media:nginx/access-control.svg)

- `allow` and `deny` take addresses or networks (`10.0.0.0/8`); the rules are checked **in order until the first match**. A denied request gets `403 Forbidden`.
- `auth_basic "realm"` with `auth_basic_user_file` asks for a user name and password, checked against hashed entries (for example made with `openssl passwd -apr1`). A request without valid credentials gets `401 Unauthorized` and a `WWW-Authenticate` header.
- `satisfy all` (default) requires every access check to pass; `satisfy any` requires at least one.
- `limit_conn_zone` and `limit_conn` cap how many connections a key — usually the client address — may have open at once; extra ones get `503` unless `limit_conn_status` says otherwise.

## Try it yourself

> **Local lab** — needs Nginx, `openssl` and `curl`. Nginx runs as your user from a throwaway folder on port 8089. Your requests come from `127.0.0.1`, which the rules below use. The password is for this lesson only. Every command is run automatically in DevForge's tests.

### 1. A password file and four protected locations

```bash run
mkdir -p nginx-access-lab/tmp && cd nginx-access-lab
for area in admin local staff reports downloads; do mkdir -p "www/$area"; done
for area in admin local staff reports; do echo "$area page" > "www/$area/index.html"; done
head -c 65536 /dev/zero | tr '\0' 'x' > www/downloads/slides.txt
printf 'asha:%s\n' "$(openssl passwd -apr1 'lesson-only-pw')" > htpasswd
cat > nginx.conf <<'EOF'
pid nginx.pid;
events {}
http {
    access_log off;
    client_body_temp_path tmp/body;
    proxy_temp_path tmp/proxy;
    fastcgi_temp_path tmp/fastcgi;
    uwsgi_temp_path tmp/uwsgi;
    scgi_temp_path tmp/scgi;
    default_type text/plain;
    limit_conn_zone $binary_remote_addr zone=perip:1m;

    server {
        listen 127.0.0.1:8089;
        root www;

        location /admin/ {            # only the 10.x office network
            allow 10.0.0.0/8;
            deny all;
        }
        location /local/ {            # only this machine
            allow 127.0.0.1;
            deny all;
        }
        location /staff/ {            # anyone with a password
            auth_basic "Staff area";
            auth_basic_user_file htpasswd;
        }
        location /reports/ {          # this machine without a password, everyone else with one
            satisfy any;
            allow 127.0.0.1;
            deny all;
            auth_basic "Reports";
            auth_basic_user_file htpasswd;
        }
        location /downloads/ {        # one download at a time per client
            limit_conn perip 1;
            limit_rate 16k;
        }
    }
}
EOF
cut -d: -f1 htpasswd
nginx -p "$PWD" -e error.log -c nginx.conf -t 2>&1 | tail -n 1
nginx -p "$PWD" -e error.log -c nginx.conf
```

```text output
asha
nginx: configuration file …/nginx.conf test is successful
```

The `htpasswd` file holds the user name and a salted hash, never the password itself. Every protected location serves real files from `www`: none of them uses `return`, because `return` answers a request in Nginx's rewrite phase — *before* the access phase where `allow`, `deny` and `auth_basic` are checked — so a location that only says `return 200` would let everyone in (the same trap as `limit_req` in the Nginx lab). `limit_rate 16k` slows the download to 16 KB per second, so one download stays open long enough to see the connection limit.

### 2. IP rules

```bash run
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
echo "/admin/ from 127.0.0.1: $(code http://127.0.0.1:8089/admin/)"
echo "/local/ from 127.0.0.1: $(code http://127.0.0.1:8089/local/)"
```

```text output
/admin/ from 127.0.0.1: 403
/local/ from 127.0.0.1: 200
```

`127.0.0.1` is not in `10.0.0.0/8`, so `/admin/` fell through to `deny all`. `/local/` allows exactly this address.

### 3. Basic authentication

```bash run
echo "no password:    $(code http://127.0.0.1:8089/staff/)"
echo "wrong password: $(code -u asha:guess http://127.0.0.1:8089/staff/)"
echo "right password: $(code -u asha:lesson-only-pw http://127.0.0.1:8089/staff/)"
curl -s -o /dev/null -D - http://127.0.0.1:8089/staff/ | grep -i '^www-authenticate' | tr -d '\r'
echo "what curl sends: Authorization: Basic $(printf 'asha:lesson-only-pw' | base64)"
```

```text output
no password:    401
wrong password: 401
right password: 200
WWW-Authenticate: Basic realm="Staff area"
what curl sends: Authorization: Basic YXNoYTpsZXNzb24tb25seS1wdw==
```

- `401` with `WWW-Authenticate` is what makes a browser show its login box; the realm is the text shown.
- The credentials travel as base64 — which anyone can decode back to `asha:lesson-only-pw`. Basic authentication is only safe over HTTPS.

### 4. Either the network or a password

```bash run
echo "/reports/ from 127.0.0.1, no password: $(code http://127.0.0.1:8089/reports/)"
```

```text output
/reports/ from 127.0.0.1, no password: 200
```

With `satisfy any`, the IP rule alone was enough. A request from any other address would get the password prompt instead of a `403`.

### 5. One connection at a time

```bash run
curl -s -o /dev/null http://127.0.0.1:8089/downloads/slides.txt &
first=$!
sleep 0.5
echo "second download while the first is running: $(code http://127.0.0.1:8089/downloads/slides.txt)"
wait "$first"
echo "after the first finished: $(code http://127.0.0.1:8089/downloads/slides.txt)"
```

```text output
second download while the first is running: 503
after the first finished: 200
```

The 64 KB file takes about four seconds at 16 KB/s. While the first download is open, a second connection from the same address is refused with `503`; afterwards it succeeds.

### 6. Stop Nginx

```bash run
nginx -p "$PWD" -e error.log -c nginx.conf -s stop
```

## Common mistakes

- **Rule order.** `deny all;` before `allow …;` blocks everyone; the first matching rule wins.
- **Trusting addresses behind a proxy.** Behind a load balancer every request seems to come from the load balancer; configure the real-IP module carefully, or the rules check the wrong address.
- **Basic auth over HTTP.** The password is readable on the network; use TLS.
- **Limits that are too tight.** Browsers open several connections per page, and many users can share one address (offices, campuses); test limits with realistic traffic.

## Where this fits in a real system

Nginx guards admin and staging paths in front of applications built with any framework; the application still checks *what* a signed-in user may do (as in the **Postman** authentication lesson). Larger setups move IP rules into firewalls or **Kubernetes** network policies, and connection limits into load balancers.
