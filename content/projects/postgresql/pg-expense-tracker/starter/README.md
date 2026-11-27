# Expense tracker database

A small API lets students record what they spend. This folder is its database. The API connects as the
`expense_api` role and runs the queries below; the database must keep each user's data consistent on its own.

## Rules

1. Money is exact: `amount` holds rupees and paise (two decimal places) with no rounding error, and must be
   greater than zero. `currency` is a three-letter upper-case ISO 4217 code such as `INR`.
2. `user_id`, `category_id`, `amount`, `currency` and `spent_on` are required. A category belongs to one
   user and has a `name`; a user cannot have two categories with the same name.
3. An expense can only use a category **of the same user** — user 7 must not be able to file an expense
   under user 8's "Rent" category, even by mistake in the API.
4. Deleting a user deletes their categories and expenses.

## What the API runs

The home screen lists the latest expenses, many times a second, so it must not read the whole table:

```sql
SELECT id, amount, currency, spent_on, note
FROM expenses
WHERE user_id = $1
ORDER BY spent_on DESC, id DESC
LIMIT 20;
```

The monthly report calls a function:

```sql
SELECT * FROM monthly_category_totals($1, DATE '2026-03-01');
-- category | currency | total
-- one row per category and currency with expenses in that calendar month, largest total first
-- (ties by category name)
```

## Access

The API's role, `expense_api` (no login of its own — the deployment grants it to the login it uses), may
read, add, change and delete categories and expenses, read users, and call the report function. It may not
delete users, and may not `TRUNCATE` or drop anything.
