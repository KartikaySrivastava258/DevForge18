# catalogue.sh — product lookups for the campus shop's API, with a cache-aside Redis cache.
# Use it after fake-db.sh:   source fake-db.sh; source catalogue.sh; get_product P100
#
#   get_product <id>          prints "id|name|price" (exactly as the database returns it) and returns 0,
#                             or prints nothing and returns 1 when there is no such product
#   update_price <id> <price> changes the price in the database and removes the cached copy
#
# Cache: the database's line for product <id> is kept as a string under product:<id> for CACHE_TTL seconds.
# Counters stats:cache_hits and stats:cache_misses show how well the cache works (hit ratio = hits / all reads).

CACHE_TTL="${CACHE_TTL:-300}" # 5 minutes: the longest a price can be out of date if an invalidation is ever missed

get_product() {
  local key="product:$1" cached value
  # --raw prints the plain value; a missing key prints an empty line, so cached is empty on a miss.
  cached=$(redis-cli --raw GET "$key")
  if [ -n "$cached" ]; then
    redis-cli INCR stats:cache_hits > /dev/null
    echo "$cached"
    return 0
  fi
  redis-cli INCR stats:cache_misses > /dev/null
  # Unknown products are not cached: there is nothing to store, and the database answers "no" quickly enough
  # for a shop this size (see "Cache stampede and failures" for negative caching).
  value=$(db_get_product "$1") || return 1
  # Value and expiry in one command, so the key can never exist without a TTL.
  redis-cli SET "$key" "$value" EX "$CACHE_TTL" > /dev/null
  echo "$value"
}

update_price() {
  db_set_price "$1" "$2" || return 1
  # Write the database first, then delete the cached copy: the next read is a miss and loads the new price.
  # (Deleting first would let a read in between put the old price back into the cache.)
  redis-cli DEL "product:$1" > /dev/null
}
