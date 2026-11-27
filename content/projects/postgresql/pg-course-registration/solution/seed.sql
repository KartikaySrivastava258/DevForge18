-- Sample data for trying out the schema. Load it after schema.sql:
--   psql -v ON_ERROR_STOP=1 -f schema.sql -f seed.sql
-- Names and addresses are invented; .example is a domain reserved for examples.

INSERT INTO students (roll_number, full_name, email, enrolled_year) VALUES
  ('CS24001', 'Aarav Mehta',   'aarav.mehta@college.example',   2024),
  ('CS24002', 'Diya Rawat',    'diya.rawat@college.example',    2024),
  ('CS24003', 'Kabir Negi',    'kabir.negi@college.example',    2024),
  ('EC23014', 'Meera Bisht',   'meera.bisht@college.example',   2023),
  ('ME23021', 'Rohan Thapa',   'rohan.thapa@college.example',   2023),
  ('CS25007', 'Sana Qureshi',  'sana.qureshi@college.example',  2025);

INSERT INTO courses (code, title, credits, capacity) VALUES
  ('CS101', 'Programming Fundamentals', 4, 60),
  ('CS201', 'Database Systems',         4, 40),
  ('MA102', 'Discrete Mathematics',     3, 80),
  ('HS110', 'Technical Communication',  2, 30);   -- nobody enrolled yet: the report must still show it

INSERT INTO enrollments (student_id, course_code, enrolled_on, grade)
SELECT s.id, e.course_code, e.enrolled_on::date, e.grade
FROM (VALUES
  ('CS24001', 'CS101', '2025-07-21', 'A'),
  ('CS24001', 'MA102', '2025-07-21', 'B'),
  ('CS24002', 'CS101', '2025-07-22', 'B'),
  ('CS24002', 'CS201', '2026-01-08', NULL),
  ('CS24003', 'CS201', '2026-01-08', NULL),
  ('EC23014', 'MA102', '2024-07-19', 'A'),
  ('ME23021', 'MA102', '2024-07-19', 'C'),
  ('CS25007', 'CS101', '2026-01-09', NULL),
  ('CS25007', 'MA102', '2026-01-09', NULL)
) AS e (roll_number, course_code, enrolled_on, grade)
JOIN students s ON s.roll_number = e.roll_number;
