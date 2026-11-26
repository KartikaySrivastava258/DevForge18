---
id: nginx-tls-termination
title: TLS termination with a local certificate
track: nginx
order: 5
level: intermediate
estimated_minutes: 35
prerequisites: [nginx-serving-static-files]
learning_objectives:
  - Create a self-signed certificate for localhost and serve HTTPS from Nginx with it.
  - Explain why clients reject the certificate until they trust it, and why that check protects them.
  - Redirect HTTP to HTTPS, limit TLS versions, and send Strict-Transport-Security.
resources:
  - title: Module ngx_http_ssl_module
    url: https://nginx.org/en/docs/http/ngx_http_ssl_module.html
    publisher: nginx.org
    type: documentation
    level: intermediate
    official: true
    why: ssl_certificate, ssl_certificate_key and ssl_protocols (default TLSv1.2 TLSv1.3).
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: RFC 6797 — HTTP Strict Transport Security (HSTS)
    url: https://www.rfc-editor.org/rfc/rfc6797
    publisher: IETF
    type: reference
    level: advanced
    official: true
    why: What the Strict-Transport-Security header tells browsers, and the max-age directive.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: curl — SSL certificate verification
    url: https://curl.se/docs/sslcerts.html
    publisher: curl project
    type: documentation
    level: intermediate
    official: true
    why: Why curl rejects certificates it cannot verify, and --cacert.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: self-signed
    prompt: curl rejects https://localhost:8443 with "self-signed certificate". What does the error protect against?
    options:
      - { id: a, text: "Slow servers" }
      - { id: b, text: "Talking to an impostor: curl cannot confirm the server is who it claims to be, because no authority it trusts signed the certificate" }
      - { id: c, text: "Old versions of HTTP" }
    answer: b
    explanation: Encryption alone is not enough; the client must also know whose key it is using. Trusting the certificate explicitly (--cacert) or using one signed by a trusted CA solves it — skipping verification (-k) removes the protection.
  - id: termination
    prompt: What does "TLS termination at Nginx" mean?
    options:
      - { id: a, text: "Nginx turns TLS off" }
      - { id: b, text: "Nginx holds the certificate and decrypts the traffic; it then talks to the application behind it, often over plain HTTP on a private network" }
      - { id: c, text: "The browser stops using TLS" }
    answer: b
    explanation: One place manages certificates and TLS settings for every application behind it.
  - id: hsts
    prompt: What does Strict-Transport-Security max-age=31536000 ask a browser to do?
    options:
      - { id: a, text: "Cache the page for a year" }
      - { id: b, text: "Use only HTTPS for this host for the next year, even if a link or the user types http://" }
      - { id: c, text: "Renew the certificate every year" }
    answer: b
    explanation: HSTS (RFC 6797) closes the gap where a first plain-HTTP request could be intercepted before the redirect.
verification:
  method: executed
  details: Every command is run by the test suite with Nginx 1.24, OpenSSL 3 and curl, and its output is compared with this lesson. TLS settings were checked against the nginx.org documentation and HSTS against RFC 6797 on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

Nginx can **terminate TLS** — hold the certificate, encrypt the connection with browsers, and pass plain requests on to the application — and a **certificate** is only useful when the client can verify who signed it.

## Explain it like I'm twelve

A sealed envelope keeps a letter private, but you also need to know who sealed it — a stranger could seal an envelope too. A certificate is the seal *plus* a signature from someone you trust. A self-made seal works only for people you have told "this seal is mine".

Where the analogy breaks: the "envelope" (TLS) is opened at the building's front desk (Nginx), and the letter travels inside the building unsealed.

## What problem it solves

Without TLS, anyone on the network path — Wi-Fi, a campus router — can read and change traffic, including passwords and session cookies. Browsers mark plain HTTP sites as not secure and refuse some features on them. Terminating TLS at Nginx gives every application behind it HTTPS from one place.

## How it works

![](media:nginx/tls-termination.svg)

- A **certificate** binds a public key to a name (here `localhost`); the matching **private key** stays on the server. Certificates for public sites are signed by a certificate authority (CA) that browsers trust.
- `listen … ssl` with `ssl_certificate` and `ssl_certificate_key` makes Nginx speak TLS; `ssl_protocols TLSv1.2 TLSv1.3` (also the default) allows only modern versions.
- A plain-HTTP server block can answer every request with `301` to the HTTPS address.
- `Strict-Transport-Security` (HSTS) tells browsers to use HTTPS for this host for `max-age` seconds, even if asked for `http://`.

## Try it yourself

> **Local lab** — needs Nginx, `openssl` and `curl`. Nginx runs as your user from a throwaway folder on ports 8089 (HTTP) and 8443 (HTTPS). The certificate is only for `localhost` and only for this lesson. Every command is run automatically in DevForge's tests.

### 1. A certificate for localhost

```bash run
mkdir -p nginx-tls-lab/tmp && cd nginx-tls-lab
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 7 \
  -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost" \
  -keyout key.pem -out cert.pem 2> /dev/null
openssl x509 -in cert.pem -noout -subject -ext subjectAltName
```

```text output
subject=CN = localhost
X509v3 Subject Alternative Name:
    DNS:localhost
```

- `-x509` makes a *self-signed* certificate: it signs itself instead of being signed by a CA. Fine for development, never for a public site.
- `subjectAltName` is the name clients check; `-days 7` makes it expire soon; `-nodes` leaves the private key unencrypted so Nginx can start without a passphrase.

### 2. HTTPS, a redirect and HSTS

```bash run
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
        return 301 https://localhost:8443$request_uri;
    }

    server {
        listen 127.0.0.1:8443 ssl;
        server_name localhost;
        ssl_certificate cert.pem;
        ssl_certificate_key key.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        add_header Strict-Transport-Security "max-age=300" always;
        return 200 "hello over HTTPS\n";
    }
}
EOF
nginx -p "$PWD" -e error.log -c nginx.conf -t 2>&1 | tail -n 1
nginx -p "$PWD" -e error.log -c nginx.conf
```

```text output
nginx: configuration file …/nginx.conf test is successful
```

`max-age=300` (five minutes) is deliberately short for practice; real sites use months, once they are sure HTTPS works everywhere.

### 3. The client does not trust it — yet

```bash run fails
curl -sS https://localhost:8443/
```

```text output
curl: (60) SSL certificate problem: self-signed certificate
More details here: https://curl.se/docs/sslcerts.html

curl failed to verify the legitimacy of the server and therefore could not
establish a secure connection to it. To learn more about this situation and
how to fix it, please visit the web page mentioned above.
```

The connection would be encrypted, but curl cannot confirm *whose* key it is: no authority it trusts signed this certificate. An attacker could present a self-signed certificate too, so refusing is right.

### 4. Trust this certificate explicitly

```bash run
curl -sS --cacert cert.pem https://localhost:8443/
curl -s -o /dev/null -D - --cacert cert.pem https://localhost:8443/ | grep -i '^strict-transport-security' | tr -d '\r'
echo | openssl s_client -connect 127.0.0.1:8443 -servername localhost -brief 2>&1 | grep '^Protocol version'
echo | openssl s_client -connect 127.0.0.1:8443 -servername localhost -tls1_2 -brief 2>&1 | grep '^Protocol version'
```

```text output
hello over HTTPS
Strict-Transport-Security: max-age=300
Protocol version: TLSv1.3
Protocol version: TLSv1.2
```

- `--cacert cert.pem` tells curl to trust exactly this certificate — the honest way to test a development certificate. (`curl -k` would skip verification entirely; avoid it.)
- The client and Nginx agreed on TLS 1.3, the newest version both support; a client that offers only TLS 1.2 still connects. Older versions are refused by `ssl_protocols`.

### 5. Plain HTTP is redirected

```bash run
curl -s -o /dev/null -D - http://127.0.0.1:8089/timetable?week=1 | grep -iE '^(HTTP|location)' | tr -d '\r'
curl -s -L --cacert cert.pem http://127.0.0.1:8089/timetable
```

```text output
HTTP/1.1 301 Moved Permanently
Location: https://localhost:8443/timetable?week=1
hello over HTTPS
```

The redirect keeps the path and query (`$request_uri`). After the first HTTPS visit, HSTS makes a browser skip the plain-HTTP step entirely.

### 6. Stop Nginx

```bash run
nginx -p "$PWD" -e error.log -c nginx.conf -s stop
```

## Common mistakes

- **`curl -k` (or "accept the risk") as a habit.** It silently disables the check that makes HTTPS trustworthy; trust the specific certificate instead.
- **Committing private keys.** `key.pem` must never go into a repository — the same rule as the secrets in the Git and Jenkins labs.
- **Long HSTS before HTTPS is ready.** Browsers obey `max-age` for its whole duration; start short.
- **Self-signed certificates in production.** Public sites use certificates from a trusted CA — many get them free and renewed automatically (for example via the ACME protocol).

## Where this fits in a real system

Nginx (or a cloud load balancer, or a **Kubernetes** ingress) terminates TLS in front of the application; certificates are renewed automatically and stored as secrets; and **Prometheus** alerts before a certificate expires — an expired certificate is one of the most common causes of outages.
