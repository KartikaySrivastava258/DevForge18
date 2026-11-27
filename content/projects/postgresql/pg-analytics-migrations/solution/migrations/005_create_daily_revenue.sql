-- Rule 2: the dashboard's daily figures, stored so they are not recomputed on every page load.
CREATE MATERIALIZED VIEW daily_revenue AS
SELECT (ordered_at AT TIME ZONE 'UTC')::date AS day,
       count(*)                          AS orders,
       sum(quantity * unit_price)        AS revenue
FROM orders
WHERE status <> 'cancelled'
GROUP BY 1;

-- REFRESH MATERIALIZED VIEW CONCURRENTLY (which lets the dashboard keep reading during a refresh) requires
-- a unique index on the view; day is unique by construction.
CREATE UNIQUE INDEX daily_revenue_day ON daily_revenue (day);
-- Refresh from a scheduler (cron, Airflow) with: REFRESH MATERIALIZED VIEW CONCURRENTLY daily_revenue;
