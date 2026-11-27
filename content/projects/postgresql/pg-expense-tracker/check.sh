#!/usr/bin/env bash
# Acceptance check for "Expense tracking API database".
# Usage: bash check.sh path/to/your/project   (the folder with schema.sql)
# Needs Docker. Starts a throwaway PostgreSQL 16 container, loads schema.sql into a fresh database, tests every
# rule with valid and invalid data, checks the report function, the query plan of the API's main query and the
# API role's privileges, and removes the container. Prints PASS or FAIL per criterion; non-zero exit if any fails.
set -uo pipefail
dir="${1:-.}"
image="postgres:16.15-bookworm@sha256:5264710be20f409750ac6dc4e5706dcef929c87e241605463f0f9aefa932a8d9"
name="devforge-check-pg-$$"
failures=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
}
[ -f "$dir/schema.sql" ] || { fail "$dir/schema.sql is missing"; finish; }

trap 'docker rm -f -v "$name" > /dev/null 2>&1' EXIT
docker run -d --name "$name" -e POSTGRES_PASSWORD=check "$image" > /dev/null || { fail "could not start PostgreSQL in Docker"; finish; }
for _ in $(seq 1 60); do docker exec "$name" pg_isready -q -h 127.0.0.1 -U postgres && break; sleep 1; done
q() { docker exec -i -e PGPASSWORD=check "$name" psql -X -q -A -t -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$1"; }
echo "CREATE DATABASE expenses_check" | q postgres > /dev/null

if out="$(q expenses_check < "$dir/schema.sql" 2>&1)"; then pass "schema.sql loads into an empty database"; else fail "schema.sql does not load: $out"; finish; fi

amount_type="$(echo "SELECT data_type || ' ' || coalesce(numeric_scale::text, '-') FROM information_schema.columns WHERE table_name = 'expenses' AND column_name = 'amount'" | q expenses_check)"
if [ "$amount_type" = "numeric 2" ]; then pass "amount is an exact numeric with 2 decimal places"; else fail "amount must be numeric with 2 decimal places, not floating point (it is: ${amount_type:-missing})"; fi

base="INSERT INTO users (email, display_name) VALUES ('asha@test.example', 'Asha'), ('ben@test.example', 'Ben');
INSERT INTO categories (user_id, name) SELECT id, n FROM users, (VALUES ('Food'), ('Rent'), ('Travel')) AS c (n) WHERE email = 'asha@test.example';
INSERT INTO categories (user_id, name) SELECT id, 'Rent' FROM users WHERE email = 'ben@test.example';
INSERT INTO expenses (user_id, category_id, amount, currency, spent_on, note)
SELECT u.id, c.id, e.amount, e.currency, e.spent_on::date, e.note
FROM (VALUES
  ('asha@test.example', 'Food',   120.50, 'INR', '2026-03-02', 'lunch'),
  ('asha@test.example', 'Food',    79.50, 'INR', '2026-03-15', 'snacks'),
  ('asha@test.example', 'Rent',  9000.00, 'INR', '2026-03-01', 'March rent'),
  ('asha@test.example', 'Travel',  45.00, 'EUR', '2026-03-20', 'train'),
  ('asha@test.example', 'Travel', 300.00, 'INR', '2026-03-31', 'bus pass'),
  ('asha@test.example', 'Food',    10.00, 'INR', '2026-04-01', 'April, not March'),
  ('asha@test.example', 'Food',    10.00, 'INR', '2026-02-28', 'February, not March'),
  ('ben@test.example',  'Rent',  5000.00, 'INR', '2026-03-01', 'Ben, not Asha')
) AS e (email, cat, amount, currency, spent_on, note)
JOIN users u ON u.email = e.email
JOIN categories c ON c.user_id = u.id AND c.name = e.cat;"
if ! out="$(echo "$base" | q expenses_check 2>&1)"; then
  fail "valid data was rejected — keep the tables, columns and the users table from the starter ($out)"
  finish
fi

rejects() {
  local out
  if out="$(printf 'BEGIN;\n%s;\nROLLBACK;\n' "$3" | q expenses_check 2>&1)"; then fail "$1 (the database accepted it)"
  elif echo "$out" | grep -q "$2"; then pass "$1"
  else fail "$1 (rejected, but not by a constraint: $(echo "$out" | head -n 1))"; fi
}
accepts() {
  local out
  if out="$(printf 'BEGIN;\n%s;\nROLLBACK;\n' "$2" | q expenses_check 2>&1)"; then pass "$1"; else fail "$1 ($(echo "$out" | head -n 1))"; fi
}
asha="(SELECT id FROM users WHERE email = 'asha@test.example')"
ben="(SELECT id FROM users WHERE email = 'ben@test.example')"
food="(SELECT id FROM categories WHERE name = 'Food' AND user_id = $asha)"
ben_rent="(SELECT id FROM categories WHERE name = 'Rent' AND user_id = $ben)"
expense="INSERT INTO expenses (user_id, category_id, amount, currency, spent_on) VALUES"
rejects "rule 1: an amount of 0 is rejected" "violates check constraint" "$expense ($asha, $food, 0, 'INR', '2026-03-03')"
rejects "rule 1: a negative amount is rejected" "violates check constraint" "$expense ($asha, $food, -5, 'INR', '2026-03-03')"
rejects "rule 1: a lower-case currency is rejected" "violates check constraint" "$expense ($asha, $food, 5, 'inr', '2026-03-03')"
rejects "rule 1: a currency that is not three letters is rejected" "violates check constraint" "$expense ($asha, $food, 5, 'RUPEE', '2026-03-03')"
rejects "rule 2: an expense without a date is rejected" "violates not-null constraint" "$expense ($asha, $food, 5, 'INR', NULL)"
rejects "rule 2: an expense without an amount is rejected" "violates not-null constraint" "$expense ($asha, $food, NULL, 'INR', '2026-03-03')"
rejects "rule 2: an expense without a category is rejected" "violates not-null constraint" "$expense ($asha, NULL, 5, 'INR', '2026-03-03')"
rejects "rule 2: a category without a name is rejected" "violates not-null constraint" "INSERT INTO categories (user_id, name) VALUES ($asha, NULL)"
rejects "rule 2: a second category with the same name for the same user is rejected" "violates unique constraint" "INSERT INTO categories (user_id, name) VALUES ($asha, 'Food')"
accepts "rule 2: two users may each have a category with the same name" "INSERT INTO categories (user_id, name) VALUES ($ben, 'Food')"
rejects "rule 3: an expense filed under another user's category is rejected" "violates foreign key constraint" "$expense ($asha, $ben_rent, 5, 'INR', '2026-03-03')"
exact="$(printf "BEGIN;\n%s (%s, %s, 0.10, 'INR', '2026-05-01'), (%s, %s, 0.20, 'INR', '2026-05-01');\nSELECT sum(amount) = 0.30 FROM expenses WHERE spent_on = '2026-05-01';\nROLLBACK;\n" "$expense" "$asha" "$food" "$asha" "$food" | q expenses_check 2>&1)"
if [ "$exact" = "t" ]; then pass "rule 1: 0.10 + 0.20 adds up to exactly 0.30"; else fail "rule 1: 0.10 + 0.20 must add up to exactly 0.30 (got: $exact)"; fi
left="$(printf "BEGIN;\nDELETE FROM users WHERE email = 'ben@test.example';\nSELECT (SELECT count(*) FROM categories c WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c.user_id)) + (SELECT count(*) FROM expenses e WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = e.user_id));\nROLLBACK;\n" | q expenses_check 2>&1)"
if [ "$left" = "0" ]; then pass "rule 4: deleting a user deletes their categories and expenses"; else fail "rule 4: deleting a user must delete their categories and expenses (got: $(echo "$left" | head -n 1))"; fi

report="$(echo "SELECT category || '|' || currency || '|' || total FROM monthly_category_totals($asha, DATE '2026-03-17')" | q expenses_check 2>&1)"
expected="$(printf 'Rent|INR|9000.00\nTravel|INR|300.00\nFood|INR|200.00\nTravel|EUR|45.00')"
if [ "$report" = "$expected" ]; then pass "monthly_category_totals gives one row per category and currency for the calendar month, largest first"; else fail "monthly_category_totals(user, '2026-03-17') should give $(echo "$expected" | tr '\n' ';') — got: $(echo "$report" | tr '\n' ';')"; fi

# The API's main query on a realistically sized table: 1,000 users with 100 expenses each.
plan="$(printf "BEGIN;\nINSERT INTO users (email, display_name) SELECT 'load' || g || '@test.example', 'Load ' || g FROM generate_series(1, 1000) g;\nINSERT INTO categories (user_id, name) SELECT id, 'General' FROM users WHERE email LIKE 'load%%';\nINSERT INTO expenses (user_id, category_id, amount, currency, spent_on) SELECT c.user_id, c.id, 1 + (g %% 500), 'INR', DATE '2025-01-01' + (g * 7 + c.user_id) %% 365 FROM categories c, generate_series(1, 100) g WHERE c.name = 'General';\nANALYZE;\nSELECT id AS uid FROM users WHERE email = 'load42@test.example' \\gset\nEXPLAIN (COSTS OFF) SELECT id, amount, currency, spent_on, note FROM expenses WHERE user_id = :uid ORDER BY spent_on DESC, id DESC LIMIT 20;\nROLLBACK;\n" | q expenses_check 2>&1)"
if echo "$plan" | grep -Eq 'Index (Only )?Scan( Backward)? using [^ ]+ on expenses' && ! echo "$plan" | grep -Eq 'Sort|Seq Scan'; then
  pass "the latest-expenses query reads the newest 20 rows from an index, without a sort or a full scan"
else
  fail "the latest-expenses query should use an index that matches WHERE user_id and ORDER BY spent_on DESC, id DESC; plan was: $(echo "$plan" | tr '\n' ' ' | tr -s ' ')"
fi

as_api() { printf 'BEGIN;\nSET ROLE expense_api;\n%s;\nROLLBACK;\n' "$1" | q expenses_check 2>&1; }
if out="$(as_api "SELECT count(*) FROM users; INSERT INTO categories (user_id, name) VALUES ($asha, 'Books'); $expense ($asha, $food, 15, 'INR', '2026-03-04'); UPDATE expenses SET note = 'edited' WHERE user_id = $asha; DELETE FROM expenses WHERE amount = 15; SELECT count(*) FROM monthly_category_totals($asha, DATE '2026-03-01')")"; then
  pass "expense_api can read users, add, change and delete categories and expenses, and run the report"
else
  fail "expense_api must be able to read users, write categories and expenses, and run the report: $(echo "$out" | head -n 1)"
fi
for stmt in "DELETE FROM users" "UPDATE users SET display_name = 'x'" "TRUNCATE expenses" "DROP TABLE expenses"; do
  out="$(as_api "$stmt")"
  if echo "$out" | grep -Eq 'permission denied|must be owner'; then pass "expense_api cannot $stmt"; else fail "expense_api must not be allowed to $stmt (got: $(echo "${out:-accepted}" | head -n 1))"; fi
done
finish
