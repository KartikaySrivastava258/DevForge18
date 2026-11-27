---
id: postgresql-transactions-and-isolation
title: Demonstrate transaction rollback and isolation
track: postgresql
level: advanced
mode: local
estimated_minutes: 40
prerequisites: [postgresql-tables-and-constraints]
objectives:
  - Show that a transaction which fails halfway leaves no partial change behind.
  - Compare what a transaction sees under READ COMMITTED and REPEATABLE READ while another session changes the data.
  - Recognise a serialization failure and explain why the application must retry it.
checkpoints:
  - { id: rollback, text: "After the failed transfer, both balances were exactly as before" }
  - { id: isolation, text: "READ COMMITTED saw the other session's update; REPEATABLE READ did not" }
  - { id: serialization, text: "I saw could not serialize access due to concurrent update" }
  - { id: check-passed, text: "The check script printed All checks passed" }
resources:
  - title: PostgreSQL documentation — Transaction Isolation
    url: https://www.postgresql.org/docs/16/transaction-iso.html
    publisher: PostgreSQL Global Development Group
    type: documentation
    level: advanced
    official: true
    why: What each isolation level guarantees, and when PostgreSQL reports a serialization failure.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: PostgreSQL documentation — Transactions (tutorial)
    url: https://www.postgresql.org/docs/16/tutorial-transactions.html
    publisher: PostgreSQL Global Development Group
    type: documentation
    level: beginner
    official: true
    why: The bank-transfer example of all-or-nothing transactions.
    verification: { status: verified, checked_on: 2026-11-26 }
verification:
  method: executed
  details: Every step and the check script are run by DevForge's test suite against PostgreSQL 16 with the psql client, and their output is compared with this page. The two-session steps are scripted with short pauses so their order is the same on every run. The check script is also run in an empty folder, where it must fail.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

Money moves between two accounts. You prove that a transfer is **all or nothing**, then watch two sessions work on the same row at the same time and see what each **isolation level** lets a transaction see — including the error PostgreSQL raises to protect you, which your application must handle.

## Before you start

You need the PostgreSQL server from *Tables, types and constraints* and the `psql`, `createdb` and `dropdb` client programs. Point them at your server once per terminal; with the container from that lesson:

```bash
export PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=choose-a-password
```

(Use the password you chose.) The lab creates its own database, `bank_lab`, and removes it at the end.

## Steps

### 1. Two accounts

```bash run
dropdb --if-exists bank_lab 2> /dev/null; createdb bank_lab
psql -X -q -d bank_lab <<'SQL'
CREATE TABLE accounts (
    id      integer PRIMARY KEY,
    owner   text NOT NULL,
    balance numeric(10, 2) NOT NULL CHECK (balance >= 0)
);
INSERT INTO accounts VALUES (1, 'Asha', 100.00), (2, 'Ravi', 50.00);
SQL
psql -X -d bank_lab -c 'SELECT * FROM accounts ORDER BY id'
```

```text output
 id | owner | balance
----+-------+---------
  1 | Asha  |  100.00
  2 | Ravi  |   50.00
(2 rows)
```

The `CHECK` constraint is the bank's rule: no balance may go below zero.

### 2. A transfer that fails halfway

Asha tries to send Ravi 500.00. The transaction credits Ravi first, then debits Asha — and the debit breaks the rule.

```bash run fails
psql -X -v ON_ERROR_STOP=1 -d bank_lab <<'SQL'
BEGIN;
UPDATE accounts SET balance = balance + 500 WHERE id = 2;
UPDATE accounts SET balance = balance - 500 WHERE id = 1;
COMMIT;
SQL
```

```text output
BEGIN
UPDATE 1
ERROR:  new row for relation "accounts" violates check constraint "accounts_balance_check"
DETAIL:  Failing row contains (1, Asha, -400.00).
```

Ravi's credit *did* run inside the transaction. Was it kept?

```bash run
psql -X -d bank_lab -c 'SELECT * FROM accounts ORDER BY id'
```

```text output
 id | owner | balance
----+-------+---------
  1 | Asha  |  100.00
  2 | Ravi  |   50.00
(2 rows)
```

No. The transaction never reached `COMMIT`, so PostgreSQL rolled back **everything** in it, including the update that had succeeded. This is atomicity: there is no half-done transfer to clean up.

### 3. A transfer that succeeds

```bash run
psql -X -q -d bank_lab <<'SQL'
BEGIN;
UPDATE accounts SET balance = balance - 30 WHERE id = 1;
UPDATE accounts SET balance = balance + 30 WHERE id = 2;
COMMIT;
SQL
psql -X -d bank_lab -c 'SELECT * FROM accounts ORDER BY id'
```

```text output
 id | owner | balance
----+-------+---------
  1 | Asha  |   70.00
  2 | Ravi  |   80.00
(2 rows)
```

### 4. Two sessions at once: READ COMMITTED

Now a reader reads Asha's balance twice inside one transaction, two seconds apart. One second in, a second session takes 10.00 from her account and commits. The script runs both sessions for you; you can also try it by hand in two terminals.

```bash run
cat > two-sessions.sh <<'EOF'
# Usage: bash two-sessions.sh "<isolation level>"
reader() {
  psql -X -q -A -t -d bank_lab <<SQL
BEGIN ISOLATION LEVEL $1;
SELECT 'first read:  ' || balance FROM accounts WHERE id = 1;
SELECT pg_sleep(2) \g /dev/null
SELECT 'second read: ' || balance FROM accounts WHERE id = 1;
COMMIT;
SQL
}
reader "$1" &
sleep 1
psql -X -q -d bank_lab -c 'UPDATE accounts SET balance = balance - 10 WHERE id = 1'
wait
EOF
bash two-sessions.sh "READ COMMITTED"
```

```text output
first read:  70.00
second read: 60.00
```

Under **READ COMMITTED** (PostgreSQL's default), each statement sees the data committed before *that statement* began. The second read saw the other session's update — the same transaction got two different answers.

### 5. The same experiment under REPEATABLE READ

```bash run
bash two-sessions.sh "REPEATABLE READ"
psql -X -A -t -d bank_lab -c 'SELECT balance FROM accounts WHERE id = 1'
```

```text output
first read:  60.00
second read: 60.00
50.00
```

Under **REPEATABLE READ**, the whole transaction reads from one snapshot taken at its first query. Both reads agree — even though, as the last line shows, the committed balance had already changed to 50.00.

### 6. When both sessions write the same row

What if the REPEATABLE READ transaction also wants to *change* the row that the other session changed?

```bash run fails
psql -X -q -v ON_ERROR_STOP=1 -A -t -d bank_lab <<'SQL' &
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT 'read: ' || balance FROM accounts WHERE id = 1;
SELECT pg_sleep(2) \g /dev/null
UPDATE accounts SET balance = balance - 5 WHERE id = 1;
COMMIT;
SQL
sleep 1
psql -X -q -d bank_lab -c 'UPDATE accounts SET balance = balance - 10 WHERE id = 1'
wait %1
```

```text output
read: 50.00
ERROR:  could not serialize access due to concurrent update
```

The transaction's snapshot says 50.00, but the row has been changed and committed since. Applying "50.00 − 5" would silently lose the other update, so PostgreSQL refuses with a **serialization failure** and the transaction is rolled back. The fix is not in the database: the application must catch this error and **retry the whole transaction**.

```bash run
psql -X -d bank_lab -c 'SELECT * FROM accounts ORDER BY id'
```

```text output
 id | owner | balance
----+-------+---------
  1 | Asha  |   40.00
  2 | Ravi  |   80.00
(2 rows)
```

Only the committed −10.00 is there; the failed −5.00 is not.

## Check your work

Run this from the same terminal (with your `PG…` settings).

```bash run check
bash <<'CHECK'
fail=0
check() { if eval "$2" > /dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }
q() { psql -X -A -t -d bank_lab -c "$1"; }
check "the bank_lab database exists" 'q "SELECT 1"'
check "the accounts table has the no-negative-balance rule" 'psql -X -d bank_lab -c "\d accounts" | grep accounts_balance_check > /dev/null'
check "no account is below zero" '[ "$(q "SELECT count(*) FROM accounts WHERE balance < 0")" = 0 ]'
check "Asha has 40.00" '[ "$(q "SELECT balance FROM accounts WHERE id = 1")" = 40.00 ]'
check "Ravi has 80.00" '[ "$(q "SELECT balance FROM accounts WHERE id = 2")" = 80.00 ]'
if [ "$fail" -eq 0 ]; then echo "All checks passed"; else echo "Some checks failed"; exit 1; fi
CHECK
```

```text output
PASS: the bank_lab database exists
PASS: the accounts table has the no-negative-balance rule
PASS: no account is below zero
PASS: Asha has 40.00
PASS: Ravi has 80.00
All checks passed
```

## Clean up

```bash run
dropdb bank_lab
```

## Reset

Run step 1 again: it deletes `bank_lab` if it exists and starts fresh.

## What you practised

Transactions make a group of changes all-or-nothing. Isolation levels decide what a transaction sees while others commit: READ COMMITTED gives each statement fresh data; REPEATABLE READ gives the whole transaction one snapshot, and so must reject writes that would overwrite changes it never saw. Code that uses REPEATABLE READ or SERIALIZABLE needs a retry loop.
