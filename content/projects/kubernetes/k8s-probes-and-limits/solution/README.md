# Grades service: probes, requests and limits

`app.yaml` is the application (busybox httpd running small scripts) — do not change it. `deployment.yaml` runs
three replicas behind the Service `grades` (port 80 → 8080). Today Kubernetes only knows whether the process
exists. Teach it the rest, in `deployment.yaml` only (keep the names, labels and the container's command):

1. **Resources** — CPU and memory requests and limits for the container, with a memory limit of at most
   256Mi (the service itself needs only a few MiB). A leaking container must be stopped, not starve the node.
2. **Startup** — the service needs about 12 seconds before it listens. A startup probe must give it that time,
   so no container is restarted while it starts.
3. **Readiness** — `GET /cgi-bin/ready` on port 8080 answers 503 while a Pod is draining for maintenance; such a
   Pod must leave the Service but must not be restarted.
4. **Liveness** — `GET /cgi-bin/healthz` stops answering when the process hangs; a hung container must be
   restarted within about 30 seconds.

The check applies both files to a throwaway kind cluster and then, on three different Pods at once, drains one,
hangs one and makes one leak memory (`/cgi-bin/drain`, `/cgi-bin/hang`, `/cgi-bin/hog`), and watches what
Kubernetes does. Run it with `bash check.sh path/to/this/folder` (needs Docker, kind and kubectl).
