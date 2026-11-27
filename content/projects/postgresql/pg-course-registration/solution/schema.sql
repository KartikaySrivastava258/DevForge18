-- College course registration: tables, rules (as constraints) and the morning seats report.
-- Load it into an empty database with: psql -v ON_ERROR_STOP=1 -f schema.sql

CREATE TABLE students (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,           -- rule 1
  roll_number   text NOT NULL UNIQUE,                                       -- rule 2
  full_name     text NOT NULL,
  email         text NOT NULL UNIQUE,
  enrolled_year integer
);

CREATE TABLE courses (
  code     text PRIMARY KEY,                                                -- rule 3
  title    text NOT NULL,
  credits  integer NOT NULL CHECK (credits BETWEEN 1 AND 6),                -- rule 4
  capacity integer NOT NULL CHECK (capacity > 0)
);

CREATE TABLE enrollments (
  student_id  integer NOT NULL REFERENCES students (id) ON DELETE CASCADE,  -- rules 5 and 7
  course_code text NOT NULL REFERENCES courses (code) ON DELETE RESTRICT,   -- rules 5 and 8
  enrolled_on date NOT NULL DEFAULT current_date,
  grade       text CHECK (grade IN ('A', 'B', 'C', 'D', 'F')),              -- rule 6 (NULL until graded)
  PRIMARY KEY (student_id, course_code)                                     -- rule 5: at most once
);

-- The morning report. LEFT JOIN keeps courses with no enrolments; count(e.student_id) counts only real
-- matches, so those courses show 0 (count(*) would show 1).
CREATE VIEW course_enrolment_counts AS
SELECT c.code,
       c.title,
       count(e.student_id)              AS enrolled,
       c.capacity,
       c.capacity - count(e.student_id) AS seats_left
FROM courses c
LEFT JOIN enrollments e ON e.course_code = c.code
GROUP BY c.code, c.title, c.capacity;
