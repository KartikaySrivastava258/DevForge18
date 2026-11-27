#!/usr/bin/env bash
# Acceptance check for "College course registration database".
# Usage: bash check.sh path/to/your/project   (the folder with schema.sql and seed.sql)
# Needs Docker. Starts a throwaway PostgreSQL 16 container, loads your files into fresh databases, tries valid
# and invalid data against every rule, and removes the container. Prints PASS or FAIL per criterion and exits
# non-zero if any fails.
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

for f in schema.sql seed.sql; do
  [ -f "$dir/$f" ] || { fail "$dir/$f is missing"; finish; }
done

trap 'docker rm -f -v "$name" > /dev/null 2>&1' EXIT
docker run -d --name "$name" -e POSTGRES_PASSWORD=check "$image" > /dev/null || { fail "could not start PostgreSQL in Docker"; finish; }
# The image's first start runs a temporary server on a Unix socket only; TCP answers once the real one is up.
for _ in $(seq 1 60); do docker exec "$name" pg_isready -q -h 127.0.0.1 -U postgres && break; sleep 1; done
# psql on a database, SQL on stdin; quiet, unaligned, stops at the first error.
q() { docker exec -i -e PGPASSWORD=check "$name" psql -X -q -A -t -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$1"; }
echo "CREATE DATABASE reg_schema; CREATE DATABASE reg_seed;" | q postgres > /dev/null

if out="$(q reg_schema < "$dir/schema.sql" 2>&1)"; then pass "schema.sql loads into an empty database"; else fail "schema.sql does not load: $out"; finish; fi
if out="$( (cat "$dir/schema.sql" "$dir/seed.sql") | q reg_seed 2>&1)"; then
  counts="$(echo "SELECT (SELECT count(*) FROM students) || ' ' || (SELECT count(*) FROM courses) || ' ' || (SELECT count(*) FROM enrollments)" | q reg_seed)"
  read -r ns nc ne <<< "$counts"
  if [ "$ns" -ge 5 ] && [ "$nc" -ge 3 ] && [ "$ne" -ge 8 ]; then pass "seed.sql loads after schema.sql ($ns students, $nc courses, $ne enrolments)"; else fail "seed.sql needs at least 5 students, 3 courses and 8 enrolments (has $ns, $nc, $ne)"; fi
else
  fail "seed.sql does not load after schema.sql: $out"
fi

# Valid sample data the rules must accept. If this fails, the column names or types were changed.
base="INSERT INTO students (roll_number, full_name, email, enrolled_year) VALUES ('T001', 'Test One', 'one@test.example', 2025), ('T002', 'Test Two', 'two@test.example', 2025);
INSERT INTO courses (code, title, credits, capacity) VALUES ('T101', 'Testing', 4, 30), ('T102', 'Quality', 2, 10), ('T103', 'Empty', 3, 5);
INSERT INTO enrollments (student_id, course_code, grade) SELECT id, 'T101', NULL FROM students WHERE roll_number = 'T001';
INSERT INTO enrollments (student_id, course_code, grade) SELECT id, 'T101', 'A' FROM students WHERE roll_number = 'T002';
INSERT INTO enrollments (student_id, course_code) SELECT id, 'T102' FROM students WHERE roll_number = 'T002';"
if ! out="$(echo "$base" | q reg_schema 2>&1)"; then
  fail "valid data was rejected — keep the tables, columns and types from the starter ($out)"
  finish
fi
ids="$(echo "SELECT count(*) FROM students WHERE id IS NOT NULL" | q reg_schema)"
pks="$(echo "SELECT string_agg(conrelid::regclass::text, ',' ORDER BY conrelid::regclass::text) FROM pg_constraint WHERE contype = 'p' AND conrelid IN ('students'::regclass, 'courses'::regclass, 'enrollments'::regclass)" | q reg_schema)"
if [ "$ids" = "2" ] && [ "$pks" = "courses,enrollments,students" ]; then pass "students, courses and enrollments have primary keys, and student ids are generated"; else fail "every table needs a primary key and student ids must be generated (primary keys found on: ${pks:-none})"; fi

# rejects <rule> <expected error text> <SQL>: the statement must fail with that kind of constraint error.
rejects() {
  local out
  if out="$(printf 'BEGIN;\n%s;\nROLLBACK;\n' "$3" | q reg_schema 2>&1)"; then fail "$1 (the database accepted it)"
  elif echo "$out" | grep -q "$2"; then pass "$1"
  else fail "$1 (rejected, but not by a constraint: $(echo "$out" | head -n 1))"; fi
}
accepts() {
  local out
  if out="$(printf 'BEGIN;\n%s;\nROLLBACK;\n' "$2" | q reg_schema 2>&1)"; then pass "$1"; else fail "$1 ($(echo "$out" | head -n 1))"; fi
}
student="INSERT INTO students (roll_number, full_name, email) VALUES"
rejects "rule 2: a student without an email is rejected" "violates not-null constraint" "$student ('T009', 'No Mail', NULL)"
rejects "rule 2: a student without a name is rejected" "violates not-null constraint" "$student ('T009', NULL, 'x@test.example')"
rejects "rule 2: a second student with the same email is rejected" "violates unique constraint" "$student ('T009', 'Copy', 'one@test.example')"
rejects "rule 2: a second student with the same roll number is rejected" "violates unique constraint" "$student ('T001', 'Copy', 'copy@test.example')"
rejects "rule 3: a course without a title is rejected" "violates not-null constraint" "INSERT INTO courses (code, title, credits, capacity) VALUES ('T109', NULL, 3, 10)"
rejects "rule 3: a second course with the same code is rejected" "violates unique constraint" "INSERT INTO courses (code, title, credits, capacity) VALUES ('T101', 'Again', 3, 10)"
rejects "rule 4: 7 credits is rejected" "violates check constraint" "INSERT INTO courses (code, title, credits, capacity) VALUES ('T109', 'Heavy', 7, 10)"
rejects "rule 4: 0 credits is rejected" "violates check constraint" "INSERT INTO courses (code, title, credits, capacity) VALUES ('T109', 'Light', 0, 10)"
rejects "rule 4: a capacity of 0 is rejected" "violates check constraint" "INSERT INTO courses (code, title, credits, capacity) VALUES ('T109', 'No seats', 3, 0)"
rejects "rule 4: a course without credits is rejected" "violates not-null constraint" "INSERT INTO courses (code, title, credits, capacity) VALUES ('T109', 'Unknown', NULL, 10)"
rejects "rule 5: an enrolment for a student who does not exist is rejected" "violates foreign key constraint" "INSERT INTO enrollments (student_id, course_code) VALUES (999999, 'T101')"
rejects "rule 5: an enrolment in a course that does not exist is rejected" "violates foreign key constraint" "INSERT INTO enrollments (student_id, course_code) SELECT id, 'NOPE' FROM students WHERE roll_number = 'T001'"
rejects "rule 5: enrolling the same student in the same course twice is rejected" "violates unique constraint" "INSERT INTO enrollments (student_id, course_code) SELECT id, 'T101' FROM students WHERE roll_number = 'T001'"
rejects "rule 6: grade E is rejected" "violates check constraint" "UPDATE enrollments SET grade = 'E' WHERE course_code = 'T101'"
accepts "rule 6: grades A to D and F, and no grade yet, are accepted" "UPDATE enrollments SET grade = 'F' WHERE course_code = 'T101'; UPDATE enrollments SET grade = NULL WHERE course_code = 'T101'"
rejects "rule 8: a course that has enrolments cannot be deleted" "violates foreign key constraint" "DELETE FROM courses WHERE code = 'T101'"
left="$(printf "BEGIN;\nDELETE FROM students WHERE roll_number = 'T002';\nSELECT count(*) FROM enrollments e WHERE NOT EXISTS (SELECT 1 FROM students s WHERE s.id = e.student_id);\nROLLBACK;\n" | q reg_schema 2>&1)"
if [ "$left" = "0" ]; then pass "rule 7: deleting a student also deletes their enrolments"; else fail "rule 7: deleting a student must also delete their enrolments (got: $(echo "$left" | head -n 1))"; fi

report="$(echo "SELECT code || ' ' || enrolled || ' ' || capacity || ' ' || seats_left FROM course_enrolment_counts WHERE code LIKE 'T1%' ORDER BY code" | q reg_schema 2>&1)"
expected="$(printf 'T101 2 30 28\nT102 1 10 9\nT103 0 5 5')"
if [ "$report" = "$expected" ]; then
  pass "course_enrolment_counts shows enrolled, capacity and seats_left for every course, including empty ones"
else
  fail "course_enrolment_counts should give (code enrolled capacity seats_left): $(echo "$expected" | tr '\n' ';') — got: $(echo "$report" | tr '\n' ';')"
fi
finish
