---
id: postgresql-backups-restores-migrations
title: Backups, restores and migrations
track: postgresql
order: 7
level: intermediate
estimated_minutes: 35
prerequisites: [postgresql-transactions-and-acid]
learning_objectives:
  - Back up a database with pg_dump and restore it with pg_restore — and prove the restore worked.
  - Apply schema changes as numbered migration files, each once, in order, inside a transaction.
  - Explain why a backup you have never restored is not yet a backup.
resources:
  - title: PostgreSQL documentation — pg_dump
    url: https://www.postgresql.org/docs/16/app-pgdump.html
    publisher: PostgreSQL Global Development Group
    type: documentation
    level: intermediate
    official: true
    why: Consistent backups of a running database, and the custom archive format used with pg_restore.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: PostgreSQL documentation — SQL Dump
    url: https://www.postgresql.org/docs/16/backup-dump.html
    publisher: PostgreSQL Global Development Group
    type: documentation
    level: beginner
    official: true
    why: Dumping and restoring, and what a dump does and does not include.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: PostgreSQL documentation — pg_restore
    url: https://www.postgresql.org/docs/16/app-pgrestore.html
    publisher: PostgreSQL Global Development Group
    type: documentation
    level: intermediate
    official: true
    why: Restoring archives, listing their contents and restoring selected objects.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: consistent
    prompt: pg_dump takes two minutes on a busy database. Does the dump mix rows from different moments?
    options:
      - { id: a, text: "Yes, it copies tables one after another as they are at that moment" }
      - { id: b, text: "No: it represents a snapshot of the database as it was when pg_dump began, and it does not block other users" }
      - { id: c, text: "Only if you stop the database first" }
    answer: b
    explanation: PostgreSQL's documentation says dumps are internally consistent — a snapshot from when pg_dump started — and that pg_dump does not block readers or writers.
  - id: tested
    prompt: Why restore a backup when nothing is broken?
    options:
      - { id: a, text: "To make the backup smaller" }
      - { id: b, text: "Because the only proof that a backup works is a successful restore; a corrupt, incomplete or unreadable backup is discovered too late otherwise" }
      - { id: c, text: "pg_restore deletes old backups" }
    answer: b
    explanation: Teams schedule restore tests (and time them) so they know both that recovery works and how long it takes.
  - id: migrations
    prompt: What does the schema_migrations table in this lesson do?
    options:
      - { id: a, text: "Stores a backup of every table" }
      - { id: b, text: "Records which migration files have already been applied, so each runs exactly once and every environment ends up with the same schema" }
      - { id: c, text: "Speeds up queries" }
    answer: b
    explanation: Migration tools (Flyway, Alembic, Rails, Prisma and others) all keep such a table; the runner applies only files that are not in it yet.
verification:
  method: executed
  details: Every command is run by the test suite against PostgreSQL 16 with the PostgreSQL 16 client tools, after the previous lessons, and its output is compared with this lesson. Facts about pg_dump were checked against the PostgreSQL 16 documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

**Backups** (`pg_dump`, `pg_restore`) protect the data you have, and **migrations** — numbered SQL files applied once, in order — change the schema in recorded, repeatable steps; neither is trustworthy until you have run it end to end.

## Explain it like I'm twelve

A backup is a photo of your Lego castle before your little brother visits; you only know the photo is useful if you have once rebuilt the castle from it. Migrations are the numbered instructions in a Lego booklet: everyone who follows steps 1, 2, 3 in order builds the same model, and you tick off each step so you never do one twice.

Where the analogy breaks: `pg_dump` takes its "photo" while people keep playing, and the photo is still of one single moment.

## What problem it solves

Data is lost to mistakes far more often than to hardware: a wrong `DELETE`, a dropped table, a bad deployment. And schemas drift when people change them by hand in each environment. Backups make mistakes recoverable; migrations make every database — laptop, test, production — reach the same schema the same way.

## How it works

![](media:postgresql/backup-migrations.svg)

- `pg_dump -Fc` writes a **custom-format archive** of one database: its tables, data, indexes and constraints. It is a consistent snapshot from when it started, and it does not block other users.
- `pg_restore -d target archive` recreates those objects in another (usually empty) database. `pg_restore --list` shows what an archive contains.
- `pg_dump` does not include cluster-wide objects such as roles (`pg_dumpall --globals-only` does), and it captures one moment: changes after it are not in it. Continuous archiving of the WAL allows point-in-time recovery for that.
- A **migration runner** keeps a `schema_migrations` table, applies each file not listed there inside a transaction, and records it.

## Try it yourself

> **Local lab** — with your `PG…` settings from the earlier lessons (`export PGHOST=… PGUSER=… PGPASSWORD=…`). This lesson uses its own databases, `shop_lab` and `shop_restore`, and removes them at the end. Every command is run automatically in DevForge's tests.

### 1. A small database worth protecting

```bash run
mkdir -p backup-practice && cd backup-practice
dropdb --if-exists shop_lab 2> /dev/null; dropdb --if-exists shop_restore 2> /dev/null
createdb shop_lab
psql -X -q -d shop_lab <<'SQL'
CREATE TABLE products (id integer PRIMARY KEY, name text NOT NULL, price numeric(8, 2) NOT NULL CHECK (price >= 0));
INSERT INTO products SELECT g, 'Product ' || g, g * 1.50 FROM generate_series(1, 1000) AS g;
SQL
psql -X -A -t -d shop_lab -c "SELECT count(*) || ' products, total value ' || sum(price) FROM products"
```

```text output
1000 products, total value 750750.00
```

### 2. Back it up

```bash run
pg_dump -Fc -d shop_lab -f shop.dump
pg_restore --list shop.dump | grep -E 'TABLE|CONSTRAINT' | sed 's/^[0-9]*; [0-9]* [0-9]* //'
```

```text output
TABLE public products postgres
TABLE DATA public products postgres
CONSTRAINT public products products_pkey postgres
```

The archive lists the table, its data and its primary-key constraint (the last word is the owner). The `CHECK` rule is part of the table definition.

### 3. Disaster

```bash run fails
psql -X -q -d shop_lab -c "DROP TABLE products"
psql -X -d shop_lab -c "SELECT count(*) FROM products" 2>&1 | sed 's/^psql:[^ ]* //'
```

```text output
ERROR:  relation "products" does not exist
LINE 1: SELECT count(*) FROM products
                             ^
```

### 4. Restore, and prove it

Restore into a **new** database first: you can check the backup without touching what is left of the original.

```bash run fails
createdb shop_restore
pg_restore -d shop_restore shop.dump
psql -X -A -t -d shop_restore -c "SELECT count(*) || ' products, total value ' || sum(price) FROM products"
psql -X -d shop_restore -c "INSERT INTO products VALUES (9999, 'Broken', -5)" 2>&1 | grep -o 'violates check constraint "[a-z_]*"'
```

```text output
1000 products, total value 750750.00
violates check constraint "products_price_check"
```

The same rows and the same total — and the rules came back too: a negative price is still refused. Only now do you *know* the backup works. In a real incident you would then restore into the production database (or switch the application to the restored one) — after deciding what to do about changes made since the backup.

### 5. Migrations: schema changes as numbered files

```bash run
mkdir -p migrations
cat > migrations/001_create_categories.sql <<'EOF'
CREATE TABLE categories (id integer PRIMARY KEY, name text NOT NULL UNIQUE);
INSERT INTO categories VALUES (1, 'General');
EOF
cat > migrations/002_add_category_to_products.sql <<'EOF'
ALTER TABLE products ADD COLUMN category_id integer NOT NULL DEFAULT 1 REFERENCES categories (id);
EOF
cat > migrate.sh <<'EOF'
#!/usr/bin/env bash
# Usage: bash migrate.sh <database>. Applies each migrations/*.sql file once, in order.
set -euo pipefail
db=$1
psql -X -q -d "$db" -c "SET client_min_messages TO warning" \
  -c "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
for file in migrations/*.sql; do
  version=$(basename "$file" .sql)
  if [ -n "$(psql -X -A -t -d "$db" -c "SELECT 1 FROM schema_migrations WHERE version = '$version'")" ]; then
    echo "skip  $version (already applied)"
    continue
  fi
  # The file and its record are one transaction: both or neither.
  { cat "$file"; echo "INSERT INTO schema_migrations (version) VALUES ('$version');"; } \
    | psql -X -q -v ON_ERROR_STOP=1 --single-transaction -d "$db"
  echo "apply $version"
done
EOF
bash migrate.sh shop_restore
echo "--- run it again"
bash migrate.sh shop_restore
```

```text output
apply 001_create_categories
apply 002_add_category_to_products
--- run it again
skip  001_create_categories (already applied)
skip  002_add_category_to_products (already applied)
```

- Files are applied in name order, which is why they start with numbers.
- `--single-transaction` wraps each file *and its record* in one transaction: if a statement fails, neither the change nor the record remains, and the next run tries again.
- The second run changes nothing, so the same command is safe on every environment and in every deployment.

```bash run
psql -X -A -t -d shop_restore -c "SELECT version FROM schema_migrations ORDER BY version"
psql -X -A -t -d shop_restore -c "SELECT count(*) || ' products in category ' || c.name FROM products p JOIN categories c ON c.id = p.category_id GROUP BY c.name"
```

```text output
001_create_categories
002_add_category_to_products
1000 products in category General
```

### 6. Clean up

```bash run
cd .. && dropdb shop_lab && dropdb shop_restore && echo "dropped"
```

```text output
dropped
```

## Common mistakes

- **Never testing a restore.** Schedule restores into a scratch database and check row counts or totals, as in step 4.
- **Keeping the backup next to the database.** If the disk or the account is lost, so is the backup. Copy backups to separate storage, ideally another location.
- **Forgetting roles.** `pg_dump` covers one database; dump roles and other cluster-wide objects with `pg_dumpall --globals-only`.
- **Editing a migration that has already run.** Environments that applied the old version will never see the change. Add a new migration instead — DevForge's own migration runner refuses edited files for exactly this reason.

## Where this fits in a real system

Migrations run as a step in deployment pipelines (**GitHub Actions**, **Jenkins**) before the new application version starts; backups run on a schedule (for example from **Airflow** or a cron job) with alerts in **Prometheus** when they fail; and managed services such as Amazon RDS automate backups and point-in-time recovery — which still need restore tests.
