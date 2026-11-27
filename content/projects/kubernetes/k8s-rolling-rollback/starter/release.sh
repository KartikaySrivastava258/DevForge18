#!/usr/bin/env bash
# Usage: bash release.sh IMAGE
# Releases IMAGE to the container "web" of the Deployment "web".
# First attempt: it changes the image and hopes for the best.
set -euo pipefail
image="${1:?usage: release.sh IMAGE}"
kubectl set image deployment/web web="$image"
