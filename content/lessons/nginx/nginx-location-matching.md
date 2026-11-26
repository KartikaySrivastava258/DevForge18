---
id: nginx-location-matching
title: Location matching rules in depth
track: nginx
order: 3
level: beginner
estimated_minutes: 30
prerequisites: [nginx-serving-static-files]
learning_objectives:
  - Predict which location block Nginx chooses for a request, using the documented matching order.
  - Use exact matches, prefixes, ^~ and regular expressions deliberately.
  - Find out which location answered a request by testing, not guessing.
resources:
  - title: ngx_http_core_module — location
    url: https://nginx.org/en/docs/http/ngx_http_core_module.html#location
    publisher: Nginx
    type: documentation
    level: intermediate
    official: true
    why: The matching order, and the meaning of =, ^~, ~ and ~*.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: How nginx processes a request
    url: https://nginx.org/en/docs/http/request_processing.html
    publisher: Nginx
    type: documentation
    level: beginner
    official: true
    why: The same rules explained with a worked example.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: longest-prefix
    prompt: With "location /api/" and "location /api/v1/", which one handles /api/v1/users — and does their order in the file matter?
    options:
      - { id: a, text: "/api/, because it comes first" }
      - { id: b, text: "/api/v1/ — Nginx picks the longest matching prefix, whatever the order in the file" }
      - { id: c, text: "Both, one after the other" }
    answer: b
    explanation: Prefix locations are compared by length, not position. You see it in the lesson with C and D.
  - id: regex-beats-prefix
    prompt: Why did /api/v1/logo.png go to the .png regular expression instead of the /api/v1/ prefix?
    options:
      - { id: a, text: "Regular expressions are always longer" }
      - { id: b, text: "After finding the longest prefix, Nginx checks the regular expressions in file order; the first one that matches wins over the remembered prefix" }
      - { id: c, text: "Because .png files are special" }
    answer: b
    explanation: The remembered prefix is only used if no regular expression matches — unless that prefix has ^~.
  - id: caret-tilde
    prompt: How do you make /static/ win even for files a regular expression would match?
    options:
      - { id: a, text: "Put it first in the file" }
      - { id: b, text: "Use location ^~ /static/ — if it is the longest matching prefix, regular expressions are not checked" }
      - { id: c, text: "Use location = /static/" }
    answer: b
    explanation: = only matches the exact URI /static/ itself; ^~ applies to everything under the prefix.
verification:
  method: executed
  details: Every command is run by the test suite with Nginx as an unprivileged process in a throwaway folder, and its output is compared with this lesson; recorded with Nginx 1.24.0, the version CI uses. The matching rules were checked against the Nginx documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

For every request, Nginx picks **one** `location` block by a fixed order — an **exact** `=` match wins at once; otherwise the **longest prefix** is remembered, a `^~` prefix wins immediately, and if not, the first **regular expression** in file order that matches beats the remembered prefix.

## Explain it like I'm twelve

A post office sorts letters into pigeonholes. A pigeonhole labelled with a whole exact address gets its letter at once. Otherwise the clerk finds the most specific area label that fits ("Delhi", then "Delhi, Connaught Place"), but before using it, checks a short list of special rules in order — "anything marked FRAGILE goes to the counter" — unless the area pigeonhole has a "no special rules" sticker.

The exact address is `=`, the area labels are **prefixes**, the special rules are **regular expressions**, and the sticker is `^~`.

Where the analogy breaks: Nginx does all of this in microseconds, and only ever chooses one pigeonhole.

## What problem it solves

Real configurations mix static files, an API, health checks and special cases. When a request lands in the wrong block — the API served as a file, or images going to the application — the cause is almost always the matching order. Knowing it, and testing which block answers, turns a mystery into a one-line fix.

## How it works

```diagram steps=nginx/location-order
```

1. If a `location = …` matches the URI exactly, it is used and the search ends.
2. All prefix locations are compared; the **longest** one that matches is remembered — their order in the file does not matter.
3. If that longest prefix has `^~`, it is used, and regular expressions are not checked.
4. Otherwise the regular expressions (`~` case-sensitive, `~*` case-insensitive) are tried **in the order they appear**; the first match is used.
5. If none matches, the remembered prefix is used.

## Try it yourself

> **Local lab** — needs Nginx, as in lesson 1. Nginx runs as your own user in a throwaway folder, on port 8089. Every command is run automatically in DevForge's tests.

### 1. A configuration where every location says its name

```bash run
mkdir -p nginx-locations/tmp && cd nginx-locations
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
    server {
        listen 127.0.0.1:8089;
        location = /               { return 200 "A: exact = /\n"; }
        location /                 { return 200 "B: prefix /\n"; }
        location /api/             { return 200 "C: prefix /api/\n"; }
        location /api/v1/          { return 200 "D: prefix /api/v1/\n"; }
        location ^~ /static/       { return 200 "E: prefix ^~ /static/\n"; }
        location ~ \.png$          { return 200 "F: regex, ends in .png\n"; }
        location ~ ^/api/.*\.json$ { return 200 "G: regex, /api/ and ends in .json\n"; }
    }
}
EOF
nginx -p "$PWD" -e error.log -c nginx.conf -t 2>&1 | tail -n 1
nginx -p "$PWD" -e error.log -c nginx.conf
```

```text output
nginx: configuration file …/nginx.conf test is successful
```

Instead of serving files, every location answers with its own letter (`return 200 "…"`), so each response tells you which block was chosen.

### 2. Ask for nine paths

```bash run
for path in / /about /api/ /api/users /api/v1/users /api/v1/users.json /static/logo.png /img/logo.png /api/v1/logo.png; do
  printf '%-20s ' "$path"
  curl -s "http://127.0.0.1:8089$path"
done
```

```text output
/                    A: exact = /
/about               B: prefix /
/api/                C: prefix /api/
/api/users           C: prefix /api/
/api/v1/users        D: prefix /api/v1/
/api/v1/users.json   G: regex, /api/ and ends in .json
/static/logo.png     E: prefix ^~ /static/
/img/logo.png        F: regex, ends in .png
/api/v1/logo.png     F: regex, ends in .png
```

Read each line with the five rules:

- `/` — an exact `=` match: **A**, and the search stops. `/about` only matches the prefix `/`: **B**.
- `/api/users` — **C**; `/api/v1/users` — **D**, the longer prefix, although C comes first in the file.
- `/api/v1/users.json` — the longest prefix is D, but the regular expression **G** matches, so G wins.
- `/static/logo.png` — the `.png` regex would match, but the longest prefix `/static/` has `^~`: regexes are never checked, **E**.
- `/img/logo.png` and `/api/v1/logo.png` — the first matching regex, **F**, beats the prefixes `/` and `/api/v1/`.

### 3. Order matters — for regular expressions only

Swap the two regular expressions and ask again for a path both could match:

```bash run
sed -i 's#location ~ \\.png\$ #location ~ \\.json\$#; s#return 200 "F: regex, ends in .png\\n"#return 200 "F2: regex, ends in .json\\n"#' nginx.conf
grep -o 'location ~ [^ ]*' nginx.conf
nginx -p "$PWD" -e error.log -c nginx.conf -s reload
sleep 1
curl -s http://127.0.0.1:8089/api/v1/users.json
```

```text output
location ~ \.json$
location ~ ^/api/.*\.json$
F2: regex, ends in .json
```

Now a `.json` regex comes **before** G in the file, and both match `/api/v1/users.json`: the first one wins. Moving prefix locations around never changes the result; moving regular expressions can.

### 4. Stop Nginx

```bash run
nginx -p "$PWD" -e error.log -c nginx.conf -s stop
```

## Try it in the simulation

Add, remove and reorder locations, send paths, and read why each one wins. It is a labelled teaching model of Nginx's matching order, checked against the answers real Nginx gave in this lesson.

```simulation nginx-location-matcher scenario=docs
```

## Common mistakes

- **Expecting the first location in the file to win.** Prefixes are chosen by length; only regular expressions are tried in order.
- **A regex that unexpectedly catches requests** meant for a prefix — such as `\.png$` catching `/api/v1/logo.png`. Use `^~` on prefixes that must not be overridden.
- **Using `=` for a whole folder.** `location = /static/` matches only the URI `/static/` itself.
- **Too many regular expressions.** They are checked one by one on every request that reaches them; prefer prefixes where you can.
- **Guessing instead of testing.** A temporary `return 200 "name"` per location, as here, shows exactly which block answers.

## Where this fits in a real system

In front of an application, a typical server sends `/api/` to the app with `proxy_pass` (lesson 2), serves `/static/` from disk with `^~`, and adds an exact `location = /health` for a load balancer or **Kubernetes** probe. The same matching rules decide where **Prometheus** scrapes and which paths are cached.
