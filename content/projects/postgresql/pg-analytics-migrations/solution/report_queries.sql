-- The three queries the analysts run every day. Days are UTC days. Do not change these queries:
-- make the database answer them quickly instead.

-- 1. Revenue per day for one week (the Monday report), cancelled orders excluded.
SELECT (ordered_at AT TIME ZONE 'UTC')::date AS day, sum(quantity * unit_price) AS revenue
FROM orders
WHERE ordered_at >= TIMESTAMPTZ '2026-03-02 00:00:00+00' AND ordered_at < TIMESTAMPTZ '2026-03-09 00:00:00+00'
  AND status <> 'cancelled'
GROUP BY 1
ORDER BY 1;

-- 2. Top 10 products by revenue in one month.
SELECT p.name, sum(o.quantity * o.unit_price) AS revenue
FROM orders o
JOIN products p ON p.id = o.product_id
WHERE o.ordered_at >= TIMESTAMPTZ '2026-03-01 00:00:00+00' AND o.ordered_at < TIMESTAMPTZ '2026-04-01 00:00:00+00'
  AND o.status <> 'cancelled'
GROUP BY p.name
ORDER BY revenue DESC, p.name
LIMIT 10;

-- 3. One customer's 10 most recent orders (the support screen).
SELECT id, product_id, quantity, unit_price, ordered_at, status
FROM orders
WHERE customer_id = 1234
ORDER BY ordered_at DESC
LIMIT 10;
