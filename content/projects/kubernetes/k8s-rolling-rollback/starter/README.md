# Timetable web tier: safe releases

The timetable site runs as the Deployment `web` (container `web`, nginx) behind the Service `web`. Releases
are made with `release.sh IMAGE`. Last term a release with a broken image took the site down for an hour.

Make releases safe:

1. `deployment.yaml` — at least 3 replicas; a rolling update that never takes a serving Pod away before its
   replacement is ready (`maxUnavailable: 0`); a readiness probe, so a Pod receives traffic only when nginx
   answers; images pinned by digest.
2. `release.sh IMAGE` — record why the Deployment changed (the `kubernetes.io/change-cause` annotation),
   change the image, wait for the rollout with `kubectl rollout status` and a timeout taken from the
   environment variable `ROLLOUT_TIMEOUT` (default `120s`). If the rollout does not finish in time, roll back
   with `kubectl rollout undo`, wait for that to finish, and exit with a non-zero status. Exit 0 on success.

The check releases `nginx:1.28-alpine` (a good release) and then a broken build that starts but never
answers, and watches the traffic while it happens. Run it with `bash check.sh path/to/this/folder` (needs
Docker, kind and kubectl).
