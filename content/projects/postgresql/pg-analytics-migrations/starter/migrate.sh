#!/usr/bin/env bash
# Usage: bash migrate.sh <database>. Applies each migrations/*.sql file once, in name order.
# Connection settings come from the usual PG* environment variables (PGHOST, PGUSER, PGPASSWORD, ...).
# Each file and its schema_migrations record are one transaction: both are applied, or neither.
set -euo pipefail
db=$1
psql -X -q -d "$db" -c "SET client_min_messages TO warning" \
  -c "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
for file in migrations/*.sql; do
  version=$(basename "$file" .sql)
  if [ -n "$(psql -X -A -t -d "$db" -c "SELECT 1 FROM schema_migrations WHERE version = '$version'")" ]; then
    echo "skip  $version (already applied)"
    continue
  fi
  { cat "$file"; echo "INSERT INTO schema_migrations (version) VALUES ('$version');"; } \
    | psql -X -q -v ON_ERROR_STOP=1 --single-transaction -d "$db"
  echo "apply $version"
done
