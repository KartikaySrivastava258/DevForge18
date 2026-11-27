# Campus shop — product catalogue cache

The campus shop's app shows product pages, and every page view asks the product database for the product's
name and price. At the start of term the database cannot keep up. Most products change price a few times a
term, so almost every query returns the same answer as the one before. Put a Redis cache in front of it.

## The files

| File | What it is |
| --- | --- |
| `fake-db.sh` | A stand-in for the database (shell functions). Each query takes 0.2 s and is logged. Do not change it — the check uses its own copy. |
| `products.db` | The database's data: one product per line, with id, name and price separated by a vertical bar. |
| `catalogue.sh` | **Your work.** `get_product` and `update_price`, called by the API. Keep the function names and what they print. |

## What the cache must do

1. **Cache-aside reads.** `get_product <id>` looks in Redis first. On a miss it calls `db_get_product`, stores
   the line in Redis under the key `product:<id>`, and prints it. On a hit it prints the cached line without
   touching the database. The output is always exactly the database's line, for example
   `P100|Steel water bottle|349`.
2. **An expiry on every cached copy.** Each `product:<id>` key gets a TTL between 60 seconds and one hour, so a
   copy can never be out of date for longer than that — even if an invalidation is missed.
3. **Invalidation.** `update_price <id> <price>` changes the price with `db_set_price`, then makes sure the next
   `get_product` shows the new price.
4. **Unknown products.** `get_product P999` prints nothing and returns a non-zero status. It must not leave a key
   in Redis that never expires.
5. **Hit and miss counters.** Increment `stats:cache_hits` on every hit and `stats:cache_misses` on every miss,
   so the shop can chart its hit ratio.

Each call may run in a new process (as separate API requests would), so everything the cache remembers must be
in Redis — not in shell variables or files.
