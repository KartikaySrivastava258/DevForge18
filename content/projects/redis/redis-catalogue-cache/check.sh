#!/usr/bin/env bash
# Acceptance check for "Product catalogue cache".
# Usage: bash check.sh path/to/your/project   (the folder with catalogue.sh)
# Needs Docker. Starts a throwaway Redis 7.4 container, copies your catalogue.sh into it next to the check's own
# fake database, and calls get_product and update_price — each call in a new shell, as separate API requests
# would — while counting the database queries and reading the keys in Redis. Prints PASS or FAIL per criterion;
# non-zero exit if any fails. The container and its volume are removed at the end.
set -uo pipefail
dir="${1:-.}"
# redis:7.4.11-bookworm (the Debian variant, like the redis:7 image the lessons use), digest as listed on
# Docker Hub (pushed 2026-10-21).
image="redis:7.4.11-bookworm@sha256:44960b3100c48159a66d28c18b0588c193492e25f7551d60e51dd464fc3eca5b"
name="devforge-check-redis-catalogue-$$"
[ -f "$dir/catalogue.sh" ] || { echo "FAIL: $dir/catalogue.sh is missing"; echo "1 criterion check(s) failed."; exit 1; }

tmp="$(mktemp -d)"
trap 'docker rm -f -v "$name" > /dev/null 2>&1; rm -rf "$tmp"' EXIT

# The database stand-in and its data: the same files as in the starter.
cat > "$tmp/fake-db.sh" <<'EOF_DB'
# fake-db.sh — a stand-in for the shop's product database. Do not change it: the check uses its own copy.
# Every query takes 0.2 seconds and is written to a query log, so you can count how often the cache saves a trip.
#   db_get_product <id>        prints "id|name|price" and returns 0, or prints nothing and returns 1
#   db_set_price <id> <price>  changes the product's price in the database
DB_FILE="${DB_FILE:-products.db}"
DB_LOG="${DB_LOG:-db-queries.log}"

db_get_product() {
  echo "get $1" >> "$DB_LOG"
  sleep 0.2
  grep -m1 "^$1|" "$DB_FILE"
}

db_set_price() {
  echo "set $1 $2" >> "$DB_LOG"
  awk -F'|' -v OFS='|' -v id="$1" -v price="$2" '$1 == id { $3 = price } { print }' "$DB_FILE" > "$DB_FILE.tmp" &&
    mv "$DB_FILE.tmp" "$DB_FILE"
}
EOF_DB
cat > "$tmp/products.db" <<'EOF_DATA'
P100|Steel water bottle|349
P200|A4 ruled notebook (pack of 5)|180
P300|Scientific calculator|1150
P400|USB-C charging cable|299
EOF_DATA

# The tests run inside the container, where redis-cli talks to the container's own Redis.
cat > "$tmp/tests.sh" <<'EOF_TESTS'
set -u
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; }
cd /work
cp /check/products.db products.db
export DB_FILE=/work/products.db DB_LOG=/work/db.log
: > "$DB_LOG"
# call <function> <args…>: one request, in a new shell, with the check's database functions.
call() {
  timeout 20 bash -c 'source /check/fake-db.sh; source /project/catalogue.sh > /dev/null; source /check/fake-db.sh; "$@"' _ "$@"
}
queries() { grep -c "^get $1\$" "$DB_LOG"; }

if timeout 20 bash -c 'source /check/fake-db.sh; source /project/catalogue.sh > /dev/null; declare -F get_product && declare -F update_price' > /dev/null 2>&1; then
  pass "catalogue.sh defines get_product and update_price"
else
  fail "catalogue.sh must load with bash and define get_product and update_price"; echo "DONE"; exit 0
fi

# Positive control: a first read returns the database's line.
out="$(call get_product P100 2> /dev/null)"; status=$?
if [ "$status" = 0 ] && [ "$out" = "P100|Steel water bottle|349" ] && [ "$(queries P100)" = 1 ]; then
  pass "first read (a miss): get_product P100 prints the database's line and queries the database once"
else
  fail "get_product P100 must print exactly \"P100|Steel water bottle|349\" and return 0 (got \"$out\", status $status, $(queries P100) database queries)"
fi

out="$(call get_product P100 2> /dev/null)"
if [ "$out" = "P100|Steel water bottle|349" ] && [ "$(queries P100)" = 1 ]; then
  pass "second read (a hit): the same answer comes from Redis, without a database query"
else
  fail "a second get_product P100 must come from Redis — same answer, no new database query (got \"$out\", $(queries P100) database queries in all)"
fi

type="$(redis-cli TYPE product:P100)"; ttl="$(redis-cli TTL product:P100)"
if [ "$type" != none ] && [ "$ttl" -ge 60 ] 2> /dev/null && [ "$ttl" -le 3600 ]; then
  pass "the cached copy is stored under product:P100 with a TTL between 60 s and 1 hour ($ttl s)"
else
  fail "the cached copy must be stored under product:P100 with a TTL between 60 and 3600 seconds (type: $type, TTL: $ttl)"
fi

hits="$(redis-cli GET stats:cache_hits)"; misses="$(redis-cli GET stats:cache_misses)"
if [ "$hits" = 1 ] && [ "$misses" = 1 ]; then pass "stats:cache_hits and stats:cache_misses count one hit and one miss"
else fail "after one miss and one hit, stats:cache_misses and stats:cache_hits must both be 1 (got misses=${misses:-none}, hits=${hits:-none})"; fi

before="$(queries P100)"
out2="$(call get_product P200 2> /dev/null)"; out1="$(call get_product P100 2> /dev/null)"
if [ "$out2" = "P200|A4 ruled notebook (pack of 5)|180" ] && [ "$out1" = "P100|Steel water bottle|349" ] && [ "$(queries P200)" = 1 ] && [ "$(queries P100)" = "$before" ]; then
  pass "each product has its own cache entry (P200 is loaded from the database, P100 is still a hit)"
else
  fail "each product needs its own cache entry: P200 → \"$out2\", then P100 → \"$out1\" (database queries: P200 $(queries P200), P100 $((  $(queries P100) - before )) new)"
fi

# Invalidation: after a price change, the next read must show the new price. Only meaningful when the old price
# is in the cache, so read it first.
call get_product P100 > /dev/null 2>&1
cached_before="$(redis-cli EXISTS product:P100)"
before="$(queries P100)"
call update_price P100 399 > /dev/null 2>&1
if ! grep -q '^P100|Steel water bottle|399$' "$DB_FILE"; then
  fail "update_price P100 399 must change the price in the database (call db_set_price)"
elif [ "$cached_before" != 1 ]; then
  fail "not checked: product:P100 was not in the cache before the price change, so there was nothing to invalidate"
else
  out="$(call get_product P100 2> /dev/null)"
  if [ "$out" = "P100|Steel water bottle|399" ] && [ "$(queries P100)" -le $((before + 1)) ]; then
    pass "update_price changes the database and invalidates the cached copy: the next read shows the new price"
  else
    fail "after update_price P100 399, get_product P100 must print the new price (got \"$out\") — delete the cached copy when the price changes"
  fi
fi

# Expiry: when the cached copy expires, the next read goes back to the database.
call get_product P100 > /dev/null 2>&1
if [ "$(redis-cli EXPIRE product:P100 1)" != 1 ]; then
  fail "not checked: product:P100 is not in the cache after a read, so there is nothing to expire"
else
sleep 1.5
before="$(queries P100)"
out="$(call get_product P100 2> /dev/null)"
if [ "$out" = "P100|Steel water bottle|399" ] && [ "$(queries P100)" = $((before + 1)) ]; then
  pass "when the cached copy expires, the next read loads the product from the database again"
else
  fail "after product:P100 expired, get_product P100 must load it from the database again (got \"$out\", $(( $(queries P100) - before )) database queries) — keep the cache in Redis only"
fi
fi

out="$(call get_product P999 2> /dev/null)"; status=$?
ttl="$(redis-cli TTL product:P999)"
if [ "$status" != 0 ] && [ -z "$out" ] && [ "$ttl" != -1 ]; then
  pass "an unknown product prints nothing, returns non-zero and leaves no key without an expiry"
else
  fail "get_product P999 must print nothing and return non-zero, and must not leave product:P999 without a TTL (output \"$out\", status $status, TTL $ttl)"
fi
echo "DONE"
EOF_TESTS

docker run -d --name "$name" "$image" > /dev/null || { echo "FAIL: could not start Redis in Docker"; echo "1 criterion check(s) failed."; exit 1; }
for _ in $(seq 1 50); do [ "$(docker exec "$name" redis-cli PING 2> /dev/null)" = PONG ] && break; sleep 0.2; done
docker exec "$name" mkdir -p /check /project /work
docker cp "$tmp/." "$name:/check/" > /dev/null
docker cp "$dir/." "$name:/project/" > /dev/null
docker exec "$name" bash /check/tests.sh > "$tmp/out" 2>&1
grep -v '^DONE$' "$tmp/out"
failures="$(grep -c '^FAIL:' "$tmp/out")"
if ! grep -q '^DONE$' "$tmp/out"; then echo "FAIL: the tests stopped before the end"; failures=$((failures + 1)); fi
if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
echo "All criteria pass."
