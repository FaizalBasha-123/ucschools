from pathlib import Path
import sys
import json
import psycopg
from psycopg.rows import dict_row

ROOT = Path(r"d:\Schools24-Workspace")
ENV_PATH = ROOT / "Schools24-backend" / ".env"


def load_neon_url() -> str:
    text = ENV_PATH.read_text(encoding="utf-8")
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("# DATABASE_URL=") and "neon.tech" in stripped:
            return stripped.split("=", 1)[1].strip()
    raise RuntimeError("Neon DATABASE_URL not found in Schools24-backend/.env")


def print_section(title: str):
    print("\n" + "=" * 100)
    print(title)
    print("=" * 100)


def main():
    email = sys.argv[1] if len(sys.argv) > 1 else "teacher@gmail.com"
    school_name = sys.argv[2] if len(sys.argv) > 2 else "Test School"
    academic_year = sys.argv[3] if len(sys.argv) > 3 else "2025-2026"
    dsn = load_neon_url()

    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            print_section("Teacher Identity")
            cur.execute(
                """
                select
                    u.id as user_id,
                    u.email,
                    u.full_name,
                    u.role,
                    t.id as teacher_id,
                    t.school_id,
                    s.name as school_name,
                    t.employee_id,
                    t.designation,
                    t.subjects_taught,
                    t.status
                from users u
                join teachers t on t.user_id = u.id
                left join schools s on s.id = t.school_id
                where lower(u.email) = lower(%s)
                order by s.name
                """,
                (email,),
            )
            teachers = cur.fetchall()
            print(json.dumps(teachers, indent=2, default=str))
            if not teachers:
                raise SystemExit("Teacher not found")

            teacher = next((row for row in teachers if row.get("school_name") == school_name), teachers[0])
            teacher_id = teacher["teacher_id"]
            school_id = teacher["school_id"]

            print_section("School Classes")
            cur.execute(
                """
                select
                    c.id,
                    c.name,
                    c.grade,
                    c.section,
                    c.class_teacher_id,
                    case
                        when coalesce(c.section, '') = '' then c.name
                        when lower(c.name) like '%' || lower('-' || c.section) then c.name
                        else c.name || '-' || c.section
                    end as resolved_label,
                    case when c.class_teacher_id = %s then true else false end as is_class_teacher
                from classes c
                where c.school_id = %s
                order by c.grade nulls first, c.section nulls first, c.name
                """,
                (teacher_id, school_id),
            )
            print(json.dumps(cur.fetchall(), indent=2, default=str))

            print_section("Teacher Assignments (teacher_assignments)")
            cur.execute(
                """
                select
                    ta.id,
                    ta.teacher_id,
                    ta.class_id,
                    ta.subject_id,
                    ta.academic_year,
                    ta.created_at,
                    case
                        when coalesce(c.section, '') = '' then c.name
                        when lower(c.name) like '%' || lower('-' || c.section) then c.name
                        else c.name || '-' || c.section
                    end as resolved_label,
                    sub.name as subject_name
                from teacher_assignments ta
                left join classes c on c.id = ta.class_id
                left join subjects sub on sub.id = ta.subject_id
                where ta.teacher_id = %s
                order by ta.academic_year desc, resolved_label, subject_name nulls first
                """,
                (teacher_id,),
            )
            print(json.dumps(cur.fetchall(), indent=2, default=str))

            print_section("Teacher Timetable Rows")
            cur.execute(
                """
                select
                    t.id,
                    t.academic_year,
                    t.day_of_week,
                    t.period_number,
                    t.class_id,
                    case
                        when coalesce(c.section, '') = '' then c.name
                        when lower(c.name) like '%' || lower('-' || c.section) then c.name
                        else c.name || '-' || c.section
                    end as resolved_label,
                    sub.name as subject_name,
                    t.room_number,
                    t.start_time,
                    t.end_time
                from timetables t
                left join classes c on c.id = t.class_id
                left join subjects sub on sub.id = t.subject_id
                where t.teacher_id = %s
                order by t.academic_year desc, t.day_of_week, t.period_number
                """,
                (teacher_id,),
            )
            print(json.dumps(cur.fetchall(), indent=2, default=str))

            print_section(f"Teacher Timetable Class Set For {academic_year}")
            cur.execute(
                """
                select distinct
                    t.class_id,
                    case
                        when coalesce(c.section, '') = '' then c.name
                        when lower(c.name) like '%' || lower('-' || c.section) then c.name
                        else c.name || '-' || c.section
                    end as resolved_label
                from timetables t
                left join classes c on c.id = t.class_id
                where t.teacher_id = %s and t.academic_year = %s
                order by resolved_label
                """,
                (teacher_id, academic_year),
            )
            print(json.dumps(cur.fetchall(), indent=2, default=str))

            print_section(f"Teacher Classes Query Logic Result For {academic_year}")
            cur.execute(
                """
                with timetable_classes as (
                    select distinct t.class_id
                    from timetables t
                    where t.teacher_id = %s and t.academic_year = %s
                ),
                assignment_classes as (
                    select distinct ta.class_id
                    from teacher_assignments ta
                    where ta.teacher_id = %s and ta.academic_year = %s
                ),
                eligible_classes as (
                    select
                        c.id as class_id,
                        coalesce(c.class_teacher_id = %s, false) as is_class_teacher,
                        (
                            exists (select 1 from timetable_classes tc where tc.class_id = c.id)
                            or exists (select 1 from assignment_classes ac where ac.class_id = c.id)
                        ) as is_subject_teacher
                    from classes c
                    where c.class_teacher_id = %s
                       or exists (select 1 from timetable_classes tc where tc.class_id = c.id)
                       or exists (select 1 from assignment_classes ac where ac.class_id = c.id)
                )
                select
                    ec.class_id,
                    case
                        when coalesce(c.section, '') = '' then c.name
                        when lower(c.name) like '%' || lower('-' || c.section) then c.name
                        else c.name || '-' || c.section
                    end as resolved_label,
                    ec.is_class_teacher,
                    ec.is_subject_teacher
                from eligible_classes ec
                join classes c on c.id = ec.class_id
                order by c.grade, c.section nulls first, c.name
                """,
                (teacher_id, academic_year, teacher_id, academic_year, teacher_id, teacher_id),
            )
            print(json.dumps(cur.fetchall(), indent=2, default=str))

            print_section(f"Teacher Timetable Endpoint Logic Result For {academic_year}")
            cur.execute(
                """
                select distinct on (t.day_of_week, t.period_number)
                    t.day_of_week,
                    t.period_number,
                    t.academic_year,
                    t.class_id,
                    case
                        when coalesce(c.section, '') = '' then c.name
                        when lower(c.name) like '%' || lower('-' || c.section) then c.name
                        else c.name || '-' || c.section
                    end as resolved_label,
                    sub.name as subject_name,
                    t.room_number
                from timetables t
                left join classes c on c.id = t.class_id
                left join subjects sub on sub.id = t.subject_id
                where t.teacher_id = %s
                order by t.day_of_week, t.period_number, t.academic_year desc
                """,
                (teacher_id,),
            )
            print(json.dumps(cur.fetchall(), indent=2, default=str))

            print_section(f"Dashboard Class Scope For {academic_year}")
            cur.execute(
                """
                with timetable_classes as (
                    select distinct t.class_id
                    from timetables t
                    where t.teacher_id = %s and t.academic_year = %s
                ),
                assignment_classes as (
                    select distinct ta.class_id
                    from teacher_assignments ta
                    where ta.teacher_id = %s and ta.academic_year = %s
                ),
                teacher_classes as (
                    select c.id, c.name, c.grade, c.section
                    from classes c
                    where c.class_teacher_id = %s
                       or exists (select 1 from timetable_classes tc where tc.class_id = c.id)
                       or exists (select 1 from assignment_classes ac where ac.class_id = c.id)
                )
                select
                    tc.id as class_id,
                    case
                        when coalesce(tc.section, '') = '' then tc.name
                        when lower(tc.name) like '%' || lower('-' || tc.section) then tc.name
                        else tc.name || '-' || tc.section
                    end as resolved_label,
                    tc.grade,
                    tc.section,
                    (
                        select count(*) from students s where s.class_id = tc.id and s.status = 'active'
                    ) as active_students
                from teacher_classes tc
                order by tc.grade, tc.section nulls first, tc.name
                """,
                (teacher_id, academic_year, teacher_id, academic_year, teacher_id),
            )
            print(json.dumps(cur.fetchall(), indent=2, default=str))

if __name__ == "__main__":
    main()
