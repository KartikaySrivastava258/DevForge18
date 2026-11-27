-- Invented, deterministic sample data at a realistic size: 2,000 customers, 200 products and 300,000 orders
-- from 2025-01-01 to 2026-06-30 (UTC), inserted in time order like a real order stream.
-- Load it after migration 001: psql -v ON_ERROR_STOP=1 -d analytics -f sample_data.sql
INSERT INTO customers (id, city, signed_up_on)
SELECT g, (ARRAY['Dehradun', 'Delhi', 'Lucknow', 'Jaipur', 'Pune'])[1 + g % 5], DATE '2024-01-01' + g % 540
FROM generate_series(1, 2000) g;

INSERT INTO products (id, name, category)
SELECT g, 'Product ' || g, (ARRAY['books', 'stationery', 'electronics', 'clothing'])[1 + g % 4]
FROM generate_series(1, 200) g;

INSERT INTO orders (customer_id, product_id, quantity, unit_price, ordered_at, status)
SELECT 1 + (g::bigint * 7919) % 2000,
       1 + (g::bigint * 104729) % 200,
       1 + g % 4,
       round((50 + (g * 31) % 4950) / 10.0, 2),
       TIMESTAMPTZ '2025-01-01 00:00:00+00' + (g - 1) * (interval '546 days' / 300000),
       (ARRAY['placed', 'shipped', 'delivered', 'delivered', 'delivered', 'delivered', 'cancelled'])[1 + g % 7]
FROM generate_series(1, 300000) g;

ANALYZE;
