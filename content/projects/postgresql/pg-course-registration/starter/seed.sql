-- Sample data for trying out the schema. Load it after schema.sql:
--   psql -v ON_ERROR_STOP=1 -f schema.sql -f seed.sql
-- TODO: at least 5 students, 3 courses and 8 enrolments.

INSERT INTO students (roll_number, full_name, email, enrolled_year)
VALUES ('CS24001', 'Example Student', 'example.student@college.example', 2024);
