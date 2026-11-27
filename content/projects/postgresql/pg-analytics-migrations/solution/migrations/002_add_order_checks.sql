-- Rule 3: data-quality constraints on orders.
-- NOT VALID: PostgreSQL enforces them for new and updated rows from now on, but does not scan the existing
-- rows yet, so this migration takes its lock only for a moment. 003 checks the existing rows.
ALTER TABLE orders
  ADD CONSTRAINT orders_quantity_positive CHECK (quantity >= 1) NOT VALID,
  ADD CONSTRAINT orders_unit_price_not_negative CHECK (unit_price >= 0) NOT VALID,
  ADD CONSTRAINT orders_status_known CHECK (status IN ('placed', 'shipped', 'delivered', 'cancelled')) NOT VALID;
