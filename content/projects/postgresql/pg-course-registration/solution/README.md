# Course registration database

The registration office keeps students, courses and enrolments in spreadsheets, and every term someone is
enrolled twice or enrolled in a course that was cancelled, and nobody knows how many seats are left. Move it
to PostgreSQL and let the database enforce the rules.

## Rules the database must enforce

Students

1. Every student has an `id` that the database generates.
2. `roll_number`, `full_name` and `email` are required; no two students share a roll number or an email.

Courses

3. A course is identified by its `code` (for example `CS101`); `title` is required.
4. `credits` is between 1 and 6; `capacity` (seats) is greater than zero. Both are required.

Enrolments

5. An enrolment links an existing student to an existing course; a student is enrolled in a course at most once.
6. `grade` is empty until the course ends, then one of `A`, `B`, `C`, `D` or `F`.
7. Deleting a student (for example when an application is withdrawn) also deletes their enrolments.
8. A course that still has enrolments cannot be deleted.

## Report

The office checks seats every morning. Create a view `course_enrolment_counts` with the columns
`code`, `title`, `enrolled`, `capacity` and `seats_left` — one row per course, **including courses nobody has
enrolled in yet** (with `enrolled` = 0).
