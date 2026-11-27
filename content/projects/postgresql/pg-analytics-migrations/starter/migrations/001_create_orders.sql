-- Applied to production on 2026-01-12. Never edit an applied migration: add a new one.
CREATE TABLE customers (
  id           integer PRIMARY KEY,
  city         text NOT NULL,
  signed_up_on date NOT NULL
);

CREATE TABLE products (
  id       integer PRIMARY KEY,
  name     text NOT NULL,
  category text NOT NULL
);

CREATE TABLE orders (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES customers (id),
  product_id  integer NOT NULL REFERENCES products (id),
  quantity    integer NOT NULL,
  unit_price  numeric(10, 2) NOT NULL,
  ordered_at  timestamptz NOT NULL,
  status      text NOT NULL DEFAULT 'placed'
);
