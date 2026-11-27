#!/usr/bin/env bash
# Acceptance check for "Analytics-ready schema with indexes and migration scripts".
# Usage: bash check.sh path/to/your/project   (the folder with migrate.sh and migrations/)
# Needs Docker. In a throwaway PostgreSQL 16 container it (1) migrates an empty database twice, then
# (2) simulates production: applies only 001, loads 300,000 orders, and applies your new migrations to that
# data; then it checks the query plans, the dashboard view, the new rules and the analyst role.
# Prints PASS or FAIL per criterion and exits non-zero if any fails. The container is removed afterwards.
set -uo pipefail
# grep -q stops reading at its first match; under pipefail the writer then dies of SIGPIPE and the pipeline
# fails at random (CI run 46038301566). grep_quiet reads all of its input.
grep_quiet() { grep "$@" > /dev/null; }
dir="${1:-.}"
image="postgres:16.15-bookworm@sha256:5264710be20f409750ac6dc4e5706dcef929c87e241605463f0f9aefa932a8d9"
name="devforge-check-pg-$$"
# sha256 of migration 001 as shipped in the starter (it is "already in production").
m001_sha="138299cf08ba4cb76dac4d99f5112eff7c58be07c4b471ecfc695bc0ac8c1658"
failures=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
}
[ -f "$dir/migrate.sh" ] && [ -d "$dir/migrations" ] || { fail "$dir needs migrate.sh and a migrations/ folder"; finish; }

if [ "$(sha256sum < "$dir/migrations/001_create_orders.sql" 2> /dev/null | cut -d' ' -f1)" = "$m001_sha" ]; then
  pass "migration 001 is unchanged (it is already applied in production)"
else
  fail "migrations/001_create_orders.sql was changed or removed; add new migrations instead"
fi
new_migrations="$(cd "$dir/migrations" && ls ./*.sql 2> /dev/null | sed 's|^\./||' | grep -v '^001_create_orders\.sql$')"
if [ "$(echo "$new_migrations" | grep -c .)" -ge 2 ]; then pass "$(echo "$new_migrations" | grep -c .) new migrations after 001"; else fail "write the changes as new numbered migrations after 001 (found: ${new_migrations:-none})"; fi

trap 'docker rm -f -v "$name" > /dev/null 2>&1' EXIT
docker run -d --name "$name" -e POSTGRES_PASSWORD=check "$image" > /dev/null || { fail "could not start PostgreSQL in Docker"; finish; }
for _ in $(seq 1 60); do docker exec "$name" pg_isready -q -h 127.0.0.1 -U postgres && break; sleep 1; done
q() { docker exec -i -e PGPASSWORD=check "$name" psql -X -q -A -t -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$1"; }
# Run the project's migrate.sh inside the container, on a copy of the project with the given migrations.
migrate() { # <database> <folder in the container>
  docker exec -w "$2" -e PGHOST=127.0.0.1 -e PGUSER=postgres -e PGPASSWORD=check "$name" bash migrate.sh "$1" 2>&1
}
docker exec "$name" mkdir -p /check/full /check/first
docker cp "$dir/." "$name:/check/full" > /dev/null
docker cp "$dir/migrate.sh" "$name:/check/first/migrate.sh" > /dev/null
docker exec "$name" mkdir -p /check/first/migrations
docker cp "$dir/migrations/001_create_orders.sql" "$name:/check/first/migrations/" > /dev/null 2>&1
echo "CREATE DATABASE fresh; CREATE DATABASE production" | q postgres > /dev/null

# 1. An empty database: everything applies, and a second run changes nothing.
first="$(migrate fresh /check/full)"; first_status=$?
second="$(migrate fresh /check/full)"
total="$(ls "$dir/migrations"/*.sql | wc -l)"
if [ "$first_status" -eq 0 ] && [ "$(echo "$first" | grep -c '^apply ')" -eq "$total" ]; then pass "all $total migrations apply to an empty database"; else fail "migrations must apply cleanly to an empty database: $(echo "$first" | tail -n 3 | tr '\n' ' ')"; fi
if [ "$(echo "$second" | grep -c '^skip ')" -eq "$total" ] && ! echo "$second" | grep_quiet '^apply '; then pass "running the migrations again changes nothing"; else fail "a second run must skip every migration: $(echo "$second" | tr '\n' ' ')"; fi

# 2. Production: 001 and the data exist first; the new migrations run on top.
sample="INSERT INTO customers (id, city, signed_up_on) SELECT g, (ARRAY['Dehradun', 'Delhi', 'Lucknow', 'Jaipur', 'Pune'])[1 + g % 5], DATE '2024-01-01' + g % 540 FROM generate_series(1, 2000) g;
INSERT INTO products (id, name, category) SELECT g, 'Product ' || g, (ARRAY['books', 'stationery', 'electronics', 'clothing'])[1 + g % 4] FROM generate_series(1, 200) g;
INSERT INTO orders (customer_id, product_id, quantity, unit_price, ordered_at, status)
SELECT 1 + (g::bigint * 7919) % 2000, 1 + (g::bigint * 104729) % 200, 1 + g % 4, round((50 + (g * 31) % 4950) / 10.0, 2),
       TIMESTAMPTZ '2025-01-01 00:00:00+00' + (g - 1) * (interval '546 days' / 300000),
       (ARRAY['placed', 'shipped', 'delivered', 'delivered', 'delivered', 'delivered', 'cancelled'])[1 + g % 7]
FROM generate_series(1, 300000) g;"
migrate production /check/first > /dev/null
if ! out="$(echo "$sample" | q production 2>&1)" || [ "$(echo "SELECT count(*) FROM orders" | q production)" != "300000" ]; then
  fail "the sample orders could not be loaded after migration 001 alone: $(echo "$out" | head -n 1)"
  finish
fi
upgrade="$(migrate production /check/full)"; upgrade_status=$?
if [ "$upgrade_status" -eq 0 ] && [ "$(echo "$upgrade" | grep -c '^apply ')" -eq "$((total - 1))" ]; then pass "the new migrations apply to a database that already holds 300,000 orders"; else fail "the new migrations must apply on top of existing data: $(echo "$upgrade" | tail -n 3 | tr '\n' ' ')"; finish; fi
echo "ANALYZE" | q production > /dev/null

query1="SELECT (ordered_at AT TIME ZONE 'UTC')::date AS day, sum(quantity * unit_price) AS revenue FROM orders WHERE ordered_at >= TIMESTAMPTZ '2026-03-02 00:00:00+00' AND ordered_at < TIMESTAMPTZ '2026-03-09 00:00:00+00' AND status <> 'cancelled' GROUP BY 1 ORDER BY 1"
query2="SELECT p.name, sum(o.quantity * o.unit_price) AS revenue FROM orders o JOIN products p ON p.id = o.product_id WHERE o.ordered_at >= TIMESTAMPTZ '2026-03-01 00:00:00+00' AND o.ordered_at < TIMESTAMPTZ '2026-04-01 00:00:00+00' AND o.status <> 'cancelled' GROUP BY p.name ORDER BY revenue DESC, p.name LIMIT 10"
query3="SELECT id, product_id, quantity, unit_price, ordered_at, status FROM orders WHERE customer_id = 1234 ORDER BY ordered_at DESC LIMIT 10"
n=0
for query in "$query1" "$query2" "$query3"; do
  n=$((n + 1))
  plan="$(echo "EXPLAIN (COSTS OFF) $query" | q production 2>&1)"
  if echo "$plan" | grep_quiet -E 'Seq Scan on orders|ERROR'; then
    fail "report query $n reads the whole orders table: $(echo "$plan" | tr '\n' ' ' | tr -s ' ')"
  else
    pass "report query $n is answered without reading the whole orders table"
  fi
done
plan3="$(echo "EXPLAIN (COSTS OFF) $query3" | q production 2>&1)"
if echo "$plan3" | grep_quiet 'Sort'; then fail "report query 3 should read its 10 rows already in order from an index (the plan sorts)"; else pass "report query 3 reads the customer's newest orders in index order (no sort)"; fi

# 3. The dashboard.
kind="$(echo "SELECT relkind FROM pg_class WHERE relname = 'daily_revenue'" | q production 2>&1)"
if [ "$kind" = "m" ]; then pass "daily_revenue is stored (a materialized view)"; else fail "daily_revenue must be a materialized view (stored results); found relkind '${kind:-none}'"; fi
diff_rows="$(printf "%s\n" "WITH direct AS (SELECT (ordered_at AT TIME ZONE 'UTC')::date AS day, count(*) AS orders, sum(quantity * unit_price) AS revenue FROM orders WHERE status <> 'cancelled' GROUP BY 1)
SELECT (SELECT count(*) FROM (SELECT day, orders, revenue FROM daily_revenue EXCEPT SELECT * FROM direct) a) + (SELECT count(*) FROM (SELECT * FROM direct EXCEPT SELECT day, orders, revenue FROM daily_revenue) b)" | q production 2>&1)"
if [ "$diff_rows" = "0" ]; then pass "daily_revenue has the right day, orders and revenue for every day"; else fail "daily_revenue differs from the orders data (rows that differ, or error: $(echo "$diff_rows" | head -n 1))"; fi
if out="$(printf "INSERT INTO orders (customer_id, product_id, quantity, unit_price, ordered_at) VALUES (1, 1, 2, 10.00, TIMESTAMPTZ '2026-06-30 12:00:00+00');\nREFRESH MATERIALIZED VIEW CONCURRENTLY daily_revenue;\nSELECT orders FROM daily_revenue WHERE day = DATE '2026-06-30';\n" | q production 2>&1)"; then
  pass "daily_revenue can be refreshed CONCURRENTLY (the dashboard keeps reading during a refresh)"
else
  fail "REFRESH MATERIALIZED VIEW CONCURRENTLY daily_revenue must work: $(echo "$out" | head -n 1)"
fi

# 4. Data rules, on the migrated production database.
rejects() {
  local out
  if out="$(printf 'BEGIN;\n%s;\nROLLBACK;\n' "$2" | q production 2>&1)"; then fail "$1 (the database accepted it)"
  elif echo "$out" | grep_quiet "violates check constraint"; then pass "$1"
  else fail "$1 (rejected, but not by a CHECK constraint: $(echo "$out" | head -n 1))"; fi
}
order="INSERT INTO orders (customer_id, product_id, quantity, unit_price, ordered_at, status) VALUES (1, 1"
rejects "a quantity of 0 is rejected" "$order, 0, 10.00, now(), 'placed')"
rejects "a negative unit price is rejected" "$order, 1, -1.00, now(), 'placed')"
rejects "an unknown status is rejected" "$order, 1, 10.00, now(), 'lost')"
validated="$(echo "SELECT count(*) FROM pg_constraint WHERE conrelid = 'orders'::regclass AND contype = 'c' AND NOT convalidated" | q production 2>&1)"
if [ "$validated" = "0" ]; then pass "every CHECK constraint on orders is validated against the existing rows"; else fail "$validated CHECK constraint(s) on orders are still NOT VALID; validate them in a migration"; fi

# 5. The analyst role.
as_analyst() { printf 'BEGIN;\nSET ROLE analyst;\n%s;\nROLLBACK;\n' "$1" | q production 2>&1; }
if out="$(as_analyst "SELECT count(*) FROM daily_revenue; SELECT count(*) FROM orders o JOIN customers c ON c.id = o.customer_id JOIN products p ON p.id = o.product_id")"; then
  pass "analyst can read orders, customers, products and daily_revenue"
else
  fail "analyst must be able to read the order data and daily_revenue: $(echo "$out" | head -n 1)"
fi
for stmt in "INSERT INTO products VALUES (999, 'x', 'y')" "UPDATE orders SET status = 'cancelled'" "DELETE FROM customers" "REFRESH MATERIALIZED VIEW daily_revenue"; do
  out="$(as_analyst "$stmt")"
  if echo "$out" | grep_quiet -E 'permission denied|must be owner'; then pass "analyst cannot $(echo "$stmt" | cut -d' ' -f1-3)"; else fail "analyst must not be allowed to $stmt (got: $(echo "${out:-accepted}" | head -n 1))"; fi
done
finish
