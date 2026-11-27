-- College course registration: the tables, columns and types are fixed (the registration app and the
-- check script use these names). Your job is to add the rules from README.md as constraints, and the view.
-- Load it into an empty database with: psql -v ON_ERROR_STOP=1 -f schema.sql

CREATE TABLE students (
  id            integer GENERATED ALWAYS AS IDENTITY,
  roll_number   text,
  full_name     text,
  email         text,
  enrolled_year integer
);

CREATE TABLE courses (
  code     text,
  title    text,
  credits  integer,
  capacity integer
);

CREATE TABLE enrollments (
  student_id  integer,
  course_code text,
  enrolled_on date DEFAULT current_date,
  grade       text
);

-- TODO: CREATE VIEW course_enrolment_counts ...
