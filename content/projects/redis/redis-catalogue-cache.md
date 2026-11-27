---
id: redis-catalogue-cache
track: redis
title: Product catalogue cache
level: beginner
estimated_hours: 4
prerequisites: [redis-data-structures, redis-caching-and-rate-limiting]
related_tracks: [postgresql]
user_stories:
  - As a student shopping at the start of term, I want product pages to load quickly so that I am not waiting while everyone else buys the same notebooks.
  - As a manager of the shop, I want a new price to appear on the product page as soon as I change it so that nobody is charged a price the page did not show.
  - As a developer of the shop's app, I want hit and miss counters in Redis so that I can see whether the cache is actually saving database queries.
acceptance_criteria:
  - The first get_product for a product prints exactly the database's line and queries the database once; a second call prints the same line from Redis with no new database query.
  - Each cached copy is stored under product:<id> with a TTL between 60 seconds and one hour, and each product has its own entry.
  - After update_price, the database has the new price and the next get_product prints it, even though the old price was cached.
  - When a cached copy expires, the next read loads the product from the database again.
  - An unknown product prints nothing, returns a non-zero status and leaves no key without an expiry.
  - stats:cache_hits and stats:cache_misses count every hit and miss.
rubric:
  - { criterion: "Cache-aside logic", excellent: "One GET on the fast path, the value and its TTL written in one command (SET … EX), and comments explaining the order of the steps.", good: "Correct hits and misses with a TTL on every key.", needs_work: "The database is queried on hits, or keys are written without an expiry." }
  - { criterion: "Invalidation", excellent: "Writes the database first and deletes the cached key after, with a comment explaining why the other order can put the old price back.", good: "The next read after a price change shows the new price.", needs_work: "A changed price stays stale until the TTL runs out." }
  - { criterion: "Choice of TTL", excellent: "The TTL is a named setting with a comment that ties it to how stale a price may be, and the README explains the trade-off.", good: "A sensible TTL within the allowed range.", needs_work: "No TTL, or a TTL picked without a reason." }
  - { criterion: "Observability", excellent: "Hit and miss counters, and a short note on how to compute the hit ratio and what a falling ratio would mean.", good: "Hit and miss counters are correct.", needs_work: "No way to tell whether the cache is used." }
hints:
  - Start from get_course_title in "Caching and rate limiting" — it is the same pattern. redis-cli --raw GET prints an empty line for a missing key, so an empty result means a miss.
  - SET key value EX seconds stores the value and its expiry in one command, so the key can never exist without a TTL. Check with redis-cli TTL product:P100 — -1 means no expiry.
  - The product line contains spaces. Quote it everywhere ("$value"), or redis-cli will treat each word as a separate argument.
  - "Watch the database log while you test: tail -f db-queries.log in a second terminal shows every query. A hit must not add a line."
stretch_goals:
  - Store each product as a hash (HSET product:P100 name … price …) instead of a string, and keep the TTL — find the moment where the key exists without an expiry and close it.
  - Cache "not found" for 10 seconds (negative caching, from "Cache stampede and failures") and show with the query log that repeated requests for P999 reach the database only once.
  - Add get_products for a list of ids that uses one MGET for all the cached ones.
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The campus shop's app shows a product page for every item, and each page view asks the product database for the
item's name and price. At the start of term the database cannot keep up — although most prices change only a
few times a term, so nearly every query returns the same answer as the last one.

You will put a **cache-aside** Redis cache in front of the database, as in *Caching and rate limiting*: read from
Redis first, load from the database on a miss and store the result with a **TTL**, and **invalidate** the cached
copy when a price changes. Counters for hits and misses let the shop see whether the cache works.

The starter has a stand-in for the database (`fake-db.sh`, shell functions that take 0.2 s per query and log each
one), its data, and `catalogue.sh` — the two functions the shop's API calls, which go to the database every time.
The README in the starter is the specification.

## Getting started

1. Start a throwaway Redis as in *Keys, values and data structures* (it is only reachable from your computer):

   ```bash
   docker run --name devforge-redis -p 127.0.0.1:6379:6379 -d redis:7
   ```

   You also need `redis-cli` on your computer; or run everything inside the container — copy the folder in with
   `docker cp` and open a shell with `docker exec -it devforge-redis bash`.
2. Copy the starter files into a folder, load the functions and try them:

   ```bash
   source fake-db.sh; source catalogue.sh
   time get_product P100
   time get_product P100
   cat db-queries.log
   ```

3. Add the cache to `get_product`, then invalidation to `update_price`, then the counters. After each step, look
   inside Redis: `redis-cli --scan --pattern 'product:*'`, `redis-cli TTL product:P100`, `redis-cli MGET stats:cache_hits stats:cache_misses`.
4. Run the check. It needs Docker; it starts its own Redis container, so your Redis is not touched:

   ```bash
   bash check.sh path/to/your/project
   ```

5. When you are done: `docker rm -f -v devforge-redis`.
