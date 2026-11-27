#!/bin/sh
# Runs the campus events API regression suite — the one command CI will call.
# Usage: sh run-api-tests.sh [base URL]   (default http://127.0.0.1:7403)
# TODO: see "What the runner must do" in the README.
base_url="${1:-http://127.0.0.1:7403}"
npx newman run tests/events-regression.postman_collection.json --env-var "baseUrl=$base_url"
