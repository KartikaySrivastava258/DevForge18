-- Rule 1: indexes for the analysts' queries in report_queries.sql.
-- Queries 1 and 2 select a time range: a B-tree on ordered_at finds just those rows.
CREATE INDEX orders_ordered_at ON orders (ordered_at);
-- Query 3: one customer's newest orders — equality column first, then the ORDER BY column, so the 10 rows
-- come straight from the index in order.
CREATE INDEX orders_customer_recent ON orders (customer_id, ordered_at DESC);
-- Trade-off: plain CREATE INDEX blocks writes to orders while it builds. On a large, busy table you would use
-- CREATE INDEX CONCURRENTLY, which cannot run inside a transaction — so it needs a migration runner that
-- applies such a file without --single-transaction (and checks for an INVALID index if it fails).
