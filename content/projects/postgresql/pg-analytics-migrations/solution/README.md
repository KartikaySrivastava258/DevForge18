# Shop analytics database

The shop's orders database (migration 001, already in production) now also feeds the analysts' dashboard,
and it is slow: every report reads all 300,000 orders. Make it analytics-ready **with new migrations only** —
001 has been applied in production and must not change.

## What the analysts need

1. The three queries in `report_queries.sql` must not read the whole `orders` table. Do not change the
   queries; add what the database needs to answer them.
2. A dashboard reads `daily_revenue` — one row per UTC day with `day` (date), `orders` (number of orders) and
   `revenue` (sum of quantity × unit_price), cancelled orders excluded. Computing it from scratch on every page
   load is too slow, so store it, and make it possible to refresh it **without blocking the dashboard's
   reads** while the refresh runs.
3. Bad rows have started to appear. From now on a `quantity` must be at least 1, a `unit_price` cannot be
   negative, and `status` must be one of `placed`, `shipped`, `delivered` or `cancelled`. The existing data
   already follows these rules.
4. The analysts connect through a role named `analyst` (no login of its own) that can read the order data and
   the dashboard, and cannot change anything.

## How changes are applied

`bash migrate.sh <database>` applies each file in `migrations/` once, in name order, recording it in
`schema_migrations`. Running it again must change nothing. Production already has 001 and the data, so new
migrations must also work on a database that already contains orders.
