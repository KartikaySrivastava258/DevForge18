#!/usr/bin/env bash
# Usage: bash release.sh IMAGE
# Releases IMAGE to the container "web" of the Deployment "web", waits for the rollout, and rolls back
# automatically if it does not finish within $ROLLOUT_TIMEOUT (default 120s). Exit 0 = released, 1 = rolled back.
set -uo pipefail
image="${1:?usage: release.sh IMAGE}"
timeout="${ROLLOUT_TIMEOUT:-120s}"

# Record the reason first: the Deployment controller copies this annotation to the new ReplicaSet, so it
# appears in the CHANGE-CAUSE column of kubectl rollout history.
kubectl annotate deployment/web kubernetes.io/change-cause="release $image" --overwrite > /dev/null || exit 1
kubectl set image deployment/web web="$image" || exit 1

if kubectl rollout status deployment/web --timeout="$timeout"; then
  echo "released $image"
  exit 0
fi

echo "the rollout of $image did not finish within $timeout — rolling back" >&2
kubectl rollout undo deployment/web
kubectl rollout status deployment/web --timeout="$timeout" || echo "the rollback has not finished yet — check kubectl get pods" >&2
exit 1
