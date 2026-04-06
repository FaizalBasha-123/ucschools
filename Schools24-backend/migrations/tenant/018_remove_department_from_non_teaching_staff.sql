-- 018_remove_department_from_non_teaching_staff.sql
-- Department column is redundant for non-teaching staff; designation is sufficient.
-- All staff in this table are non-teaching; no department routing needed.
ALTER TABLE non_teaching_staff DROP COLUMN IF EXISTS department;
