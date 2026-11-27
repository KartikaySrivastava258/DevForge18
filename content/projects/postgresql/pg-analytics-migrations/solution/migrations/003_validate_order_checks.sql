-- Checks the existing rows against 002's constraints. VALIDATE CONSTRAINT scans the table but holds a lock
-- that still allows reads and writes, unlike adding a validated constraint in one step.
-- If an old row breaks a rule, this migration fails and nothing is recorded: fix the data, then run it again.
ALTER TABLE orders VALIDATE CONSTRAINT orders_quantity_positive;
ALTER TABLE orders VALIDATE CONSTRAINT orders_unit_price_not_negative;
ALTER TABLE orders VALIDATE CONSTRAINT orders_status_known;
