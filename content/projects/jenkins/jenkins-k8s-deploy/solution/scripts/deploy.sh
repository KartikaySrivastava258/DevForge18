#!/usr/bin/env bash
# Usage: scripts/deploy.sh NAMESPACE IMAGE
# Renders the manifests with IMAGE, validates them against the cluster (server-side dry run), applies them and
# waits for the rollout. If the new pods do not become ready in time, it rolls the Deployment back to the
# previous revision and exits 1, so the pipeline stops before the next environment.
# KUBECONFIG must point to a kubeconfig (in Jenkins: the "kubeconfig" secret-file credential).
set -euo pipefail
ns="$1"
image="$2"
mkdir -p out
sed "s|IMAGE_PLACEHOLDER|$image|" k8s/deployment.yaml > out/deployment.yaml
cp k8s/service.yaml out/service.yaml
kubectl apply --dry-run=server -n "$ns" -f out/
kubectl apply -n "$ns" -f out/
if ! kubectl rollout status deployment/campus-notes-api -n "$ns" --timeout=40s; then
  echo "The rollout of $image to $ns did not become ready: rolling back."
  kubectl rollout undo deployment/campus-notes-api -n "$ns"
  kubectl rollout status deployment/campus-notes-api -n "$ns" --timeout=60s
  exit 1
fi
echo "$image is running in $ns."
