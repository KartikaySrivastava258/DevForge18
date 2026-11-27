-- Expense tracker: the database behind a small expense-tracking API.
-- Table and column names are fixed (the API uses them). users is finished as an example; categories and
-- expenses have their columns but none of the rules in README.md yet — and one type that is wrong for money.

CREATE TABLE users (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email        text NOT NULL UNIQUE,
  display_name text NOT NULL
);

CREATE TABLE categories (
  id      integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer,
  name    text
);

CREATE TABLE expenses (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     integer,
  category_id integer,
  amount      real,
  currency    text,
  spent_on    date,
  note        text,
  created_at  timestamptz DEFAULT now()
);

-- TODO: monthly_category_totals(p_user_id integer, p_month date)
-- TODO: an index for the API's "latest expenses" query
-- TODO: the expense_api role
