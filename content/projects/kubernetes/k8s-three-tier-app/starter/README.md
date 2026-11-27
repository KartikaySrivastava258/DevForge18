# Campus notice board on Kubernetes

Three tiers, each in its own Deployment and Service, all in the namespace `campus`:

| Tier | Deployment / Service | Image | Port | Labels on the Pods |
| --- | --- | --- | --- | --- |
| frontend | `frontend` | nginx:1.27-alpine | 80 | `app: campus`, `tier: frontend` |
| API | `api` | busybox:1.37 (httpd running a small script) | 8080 | `app: campus`, `tier: api` |
| database | `redis` | redis:7.4-alpine | 6379 | `app: campus`, `tier: database` |

A request travels frontend → api → redis: `GET /api/visits` on the frontend is passed to the API, which
increments a counter in Redis and returns `{"visits": N, …}`.

What to do (the names above are what the check looks for):

1. `k8s/redis.yaml` is complete — read it first.
2. `k8s/api.yaml` runs, but the Service finds no Pods. Fix it, run 2 replicas, and take `REDIS_HOST` from a
   ConfigMap named `api-config` instead of writing it into the Deployment.
3. `k8s/frontend.yaml` has the nginx configuration and page; add the Deployment (2 replicas) and the Service.
4. Every Service is `ClusterIP` — nothing is exposed outside the cluster; use `kubectl port-forward` to test.
5. Pin every image (a tag and a digest; never `latest`).

Try it on your own kind cluster:

```bash
kubectl apply -R -f k8s/
kubectl -n campus get deploy,svc,endpointslices
kubectl -n campus port-forward service/frontend 8080:80   # then open http://localhost:8080
```

Then run `bash check.sh path/to/this/folder` (needs Docker, kind and kubectl).
