-- Expense tracker: the database behind a small expense-tracking API.
-- Load into an empty database: psql -v ON_ERROR_STOP=1 -f schema.sql

CREATE TABLE users (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email        text NOT NULL UNIQUE,
  display_name text NOT NULL
);

CREATE TABLE categories (
  id      integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,       -- rules 2 and 4
  name    text NOT NULL,
  UNIQUE (user_id, name),                                                 -- rule 2
  -- Lets expenses reference (category, owner) together — rule 3. id alone is already unique,
  -- so this adds no restriction; it only gives the composite foreign key below a target.
  UNIQUE (id, user_id)
);

CREATE TABLE expenses (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,   -- rules 2 and 4
  category_id integer NOT NULL,
  -- rule 1: numeric is exact (real is binary floating point: 0.1 + 0.2 is not 0.3).
  -- 12 digits with 2 after the point: up to 9,999,999,999.99.
  amount      numeric(12, 2) NOT NULL CHECK (amount > 0),
  currency    text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  spent_on    date NOT NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- rule 3: the category must belong to the same user as the expense.
  FOREIGN KEY (category_id, user_id) REFERENCES categories (id, user_id)
);

-- The home screen's query: equality on user_id, then the ORDER BY columns, so PostgreSQL reads the newest
-- 20 entries straight from the index (no sort, no full scan). The same index works read backwards.
CREATE INDEX expenses_user_latest ON expenses (user_id, spent_on DESC, id DESC);
-- PostgreSQL does not index foreign keys automatically; without this, deleting or re-keying a category
-- scans every expense to check the reference.
CREATE INDEX expenses_category ON expenses (category_id, user_id);

-- Monthly report: one row per category and currency, largest total first. Amounts in different currencies
-- are never added together.
CREATE FUNCTION monthly_category_totals(p_user_id integer, p_month date)
RETURNS TABLE (category text, currency text, total numeric)
LANGUAGE sql STABLE
AS $$
  SELECT c.name, e.currency, sum(e.amount)
  FROM expenses e
  JOIN categories c ON c.id = e.category_id
  WHERE e.user_id = p_user_id
    AND e.spent_on >= date_trunc('month', p_month)::date
    AND e.spent_on < (date_trunc('month', p_month) + interval '1 month')::date
  GROUP BY c.name, e.currency
  ORDER BY sum(e.amount) DESC, c.name
$$;

-- The API's role. Roles belong to the whole server, not one database, so create it only if missing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'expense_api') THEN
    CREATE ROLE expense_api NOLOGIN;
  END IF;
END
$$;
GRANT SELECT ON users TO expense_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON categories, expenses TO expense_api;
GRANT EXECUTE ON FUNCTION monthly_category_totals(integer, date) TO expense_api;
-- Not granted: DELETE/UPDATE/INSERT on users, TRUNCATE anywhere. Only the owner can DROP a table.
