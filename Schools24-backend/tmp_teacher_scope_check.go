package main

import (
  "context"
  "fmt"
  "os"
  "github.com/jackc/pgx/v5"
)

func main() {
  connStr := "postgres://postgres:password@localhost:5432/schools24?sslmode=disable"
  if v := os.Getenv("DATABASE_URL"); v != "" { connStr = v }
  ctx := context.Background()
  conn, err := pgx.Connect(ctx, connStr)
  if err != nil { panic(err) }
  defer conn.Close(ctx)

  var userID, teacherID, schoolID, schoolName string
  var fullName, email string
  err = conn.QueryRow(ctx, `
    SELECT u.id::text, u.full_name, u.email, t.id::text, COALESCE(t.school_id::text,''), COALESCE(s.name,'')
    FROM users u
    JOIN teachers t ON t.user_id = u.id
    LEFT JOIN schools s ON s.id = t.school_id
    WHERE LOWER(u.email) = LOWER($1)
    LIMIT 1`, "teacher@gmail.com").Scan(&userID, &fullName, &email, &teacherID, &schoolID, &schoolName)
  if err != nil { panic(err) }

  fmt.Println("USER", userID, fullName, email)
  fmt.Println("TEACHER", teacherID)
  fmt.Println("SCHOOL", schoolID, schoolName)

  fmt.Println("\nCLASS_TEACHER_CLASSES")
  rows, err := conn.Query(ctx, `
    SELECT c.id::text,
           c.name,
           COALESCE(c.grade::text,''),
           COALESCE(c.section,''),
           COALESCE(c.academic_year,'')
    FROM classes c
    WHERE c.class_teacher_id = $1
    ORDER BY c.name, c.section`, teacherID)
  if err != nil { panic(err) }
  defer rows.Close()
  for rows.Next() {
    var id, name, grade, section, ay string
    if err := rows.Scan(&id, &name, &grade, &section, &ay); err != nil { panic(err) }
    fmt.Println(id, "|", name, "| grade=", grade, "| section=", section, "| ay=", ay)
  }
  rows.Close()

  fmt.Println("\nTEACHER_ASSIGNMENTS")
  rows, err = conn.Query(ctx, `
    SELECT ta.id::text,
           ta.class_id::text,
           COALESCE(c.name,''),
           COALESCE(c.grade::text,''),
           COALESCE(c.section,''),
           COALESCE(ta.subject_id::text,''),
           COALESCE(s.name,''),
           COALESCE(ta.academic_year,''),
           ta.updated_at::text
    FROM teacher_assignments ta
    LEFT JOIN classes c ON c.id = ta.class_id
    LEFT JOIN subjects s ON s.id = ta.subject_id
    WHERE ta.teacher_id = $1
    ORDER BY ta.academic_year DESC, c.name, c.section, s.name`, teacherID)
  if err != nil { panic(err) }
  for rows.Next() {
    var id, classID, className, grade, section, subjectID, subjectName, ay, updated string
    if err := rows.Scan(&id, &classID, &className, &grade, &section, &subjectID, &subjectName, &ay, &updated); err != nil { panic(err) }
    fmt.Println(id, "| class=", classID, className, grade, section, "| subject=", subjectID, subjectName, "| ay=", ay, "| updated=", updated)
  }
  rows.Close()

  fmt.Println("\nTIMETABLE_CLASSES")
  rows, err = conn.Query(ctx, `
    SELECT DISTINCT
           t.class_id::text,
           COALESCE(c.name,''),
           COALESCE(c.grade::text,''),
           COALESCE(c.section,''),
           COALESCE(t.academic_year,''),
           COUNT(*) OVER (PARTITION BY t.class_id, t.academic_year)
    FROM timetables t
    LEFT JOIN classes c ON c.id = t.class_id
    WHERE t.teacher_id = $1
    ORDER BY t.academic_year DESC, c.name, c.section`, teacherID)
  if err != nil { panic(err) }
  for rows.Next() {
    var classID, className, grade, section, ay string
    var count int
    if err := rows.Scan(&classID, &className, &grade, &section, &ay, &count); err != nil { panic(err) }
    fmt.Println(classID, "|", className, "| grade=", grade, "| section=", section, "| ay=", ay, "| slots=", count)
  }
  rows.Close()

  fmt.Println("\nDASHBOARD_QUERY_SIMULATION_2025_2026")
  rows, err = conn.Query(ctx, `
    WITH timetable_classes AS (
      SELECT DISTINCT t.class_id
      FROM timetables t
      WHERE t.teacher_id = $1 AND t.academic_year = $2
    ),
    assignment_classes AS (
      SELECT DISTINCT ta.class_id
      FROM teacher_assignments ta
      WHERE ta.teacher_id = $1 AND ta.academic_year = $2
    ),
    eligible_classes AS (
      SELECT c.id AS class_id,
             COALESCE(c.class_teacher_id = $1, false) AS is_class_teacher,
             (
               EXISTS (SELECT 1 FROM timetable_classes tc WHERE tc.class_id = c.id)
               OR EXISTS (SELECT 1 FROM assignment_classes ac WHERE ac.class_id = c.id)
             ) AS is_subject_teacher
      FROM classes c
      WHERE c.class_teacher_id = $1
         OR EXISTS (SELECT 1 FROM timetable_classes tc WHERE tc.class_id = c.id)
         OR EXISTS (SELECT 1 FROM assignment_classes ac WHERE ac.class_id = c.id)
    )
    SELECT ec.class_id::text,
           CASE
             WHEN COALESCE(c.section, '') = '' THEN c.name
             WHEN LOWER(c.name) LIKE '%' || LOWER('-' || c.section) THEN c.name
             ELSE c.name || '-' || c.section
           END AS class_name,
           COALESCE(c.grade::text,''),
           COALESCE(c.section,''),
           ec.is_class_teacher,
           ec.is_subject_teacher
    FROM eligible_classes ec
    JOIN classes c ON c.id = ec.class_id
    ORDER BY c.name, c.section`, teacherID, "2025-2026")
  if err != nil { panic(err) }
  for rows.Next() {
    var classID, className, grade, section string
    var isClassTeacher, isSubjectTeacher bool
    if err := rows.Scan(&classID, &className, &grade, &section, &isClassTeacher, &isSubjectTeacher); err != nil { panic(err) }
    fmt.Println(classID, "|", className, "| grade=", grade, "| section=", section, "| classTeacher=", isClassTeacher, "| subjectTeacher=", isSubjectTeacher)
  }
}
