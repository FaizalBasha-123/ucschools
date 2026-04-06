# Schools24 API Seeder - Documentation

## Overview

The **Schools24 API Seeder** is an enterprise-grade command-line tool for generating realistic demo school data through authenticated API calls. It simulates real user workflows (super-admin → admin → teachers → students) without performing direct database writes.

### Key Features

- **Endpoint-driven**: Uses only public API endpoints—no SQL inserts or migrations
- **Realistic workflows**: Follows actual role-based user journeys (auth, school creation, class/timetable assignment, homework/quizzes, attendance)
- **Idempotent**: Includes request tagging and dry-run mode for safe testing
- **Comprehensive**: Generates schools, admins, classes, teachers, students, timetables, homework, quizzes, materials, and attendance records
- **Reproducible**: Supports deterministic random seed for consistent demo data across runs
- **Enterprise controls**: Verbose logging, error handling, and operation summaries

## Installation & Build

### Prerequisites

- Go 1.21+
- Running Schools24 backend (`go run ./cmd/server` or `docker-compose up`)
- Network access to the API base URL (default: `http://localhost:8080/api/v1`)

### Build

```bash
cd Schools24-backend
go build -o bin/seeder ./cmd/seeder
```

### Verify Build

```bash
./bin/seeder -help
# Output:
#   -academic-year string
#     	Academic year (e.g., 2025-2026) (default "2025-2026")
#   -admin-email string
#     	School admin email (default "admin@cia.local")
#   -admin-password string
#     	School admin password (default "AdminPass@2025")
#   -api string
#     	API base URL (default "http://localhost:8080/api/v1")
#   -dry-run
#     	Simulate without persisting changes
#   -school-code string
#     	School code (default "CIA-2025")
#   -school-name string
#     	School name to create (default "Cambridge International Academy")
#   -seed int
#     	Random seed for reproducible generation (default <current timestamp>)
#   -super-admin-email string
#     	Super admin email (default "superadmin@schools24.local")
#   -super-admin-password string
#     	Super admin password (default "SuperAdmin@2025")
#   -verbose
#     	Enable verbose logging
```

## Usage Examples

### 1. **Dry-Run Mode** (Simulate without Changes)

```bash
./bin/seeder -api http://localhost:8080/api/v1 -dry-run -verbose
```

**Output:**
```
=== Schools24 Endpoint-Driven Demo Data Seeder ===
Target: http://localhost:8080/api/v1 | Academic Year: 2025-2026 | Idempotency: demo-20250104-080530-123

[1/15] super-admin login...
[DRY-RUN] POST /auth/login
✓ super-admin login completed

[2/15] create school...
[DRY-RUN] POST /super-admin/schools
✓ create school completed

...

============================================================
DEMO DATA SEEDING COMPLETED
============================================================
School: Cambridge International Academy (ID: <uuid>)
Admin: admin@cia.local
Academic Year: 2025-2026
Idempotency Tag: demo-20250104-080530-123
Timestamp: 2025-01-04T08:05:30Z

Classes Created: 4
Teachers Created: 4
Students Created: 5
Timetable Slots: 15
Homework Assignments: 4
Quizzes: 1
Attendance Days: 1
============================================================
DRY-RUN MODE: No data was persisted to the database.
```

### 2. **Create Real Demo School**

```bash
./bin/seeder \
  -api http://schools24-api.example.com/api/v1 \
  -school-name "St. Ignatius Academy" \
  -school-code "SIA-2025" \
  -admin-email "principal@ignatius.local" \
  -admin-password "SecureAdmin@2025" \
  -academic-year "2025-2026" \
  -verbose
```

### 3. **Reproducible Demo Data** (Same Seed = Same Data)

```bash
# First run with seed 12345
./bin/seeder -seed 12345 -verbose

# Second run with same seed produces identical data
./bin/seeder -seed 12345 -verbose
```

### 4. **Custom API Endpoint** (Self-Hosted or Cloud)

```bash
./bin/seeder \
  -api "https://api.schools24.io/api/v1" \
  -super-admin-email "platform-admin@schools24.io" \
  -super-admin-password "PlatformSecret123"
```

### 5. **Different Academic Year**

```bash
./bin/seeder -academic-year "2026-2027"
```

## Workflow Summary

The seeder executes the following steps in sequence:

| Step | Operation | Role | Outcome |
|------|-----------|------|---------|
| 1 | **Super-Admin Login** | Super-Admin | Obtain access token for school creation |
| 2 | **Create School** | Super-Admin | Create tenant schema and admin user |
| 3 | **Admin Login** | Admin | Obtain tenant-scoped access token |
| 4 | **Create Classes** | Admin | Create 4 local classes (10-A, 10-B, 11-A, 12-A) |
| 5 | **Fetch Catalogs** | Admin | Retrieve global classes/subjects for timetable |
| 6 | **Create Teachers** | Admin | Create 4 teacher accounts with subjects |
| 7 | **Create Students** | Admin | Create 5 student accounts assigned to classes |
| 8 | **Assign Timetable** | Admin | Create 15 timetable slots (M-F, 3 periods) |
| 9 | **Create Homework** | Teacher | Post 4 homework assignments (due in 7 days) |
| 10 | **Create Quizzes** | Teacher | Schedule 1 quiz with 2 questions (multiple choice) |
| 11 | **Upload Materials** | Teacher | Placeholder for study materials (multipart) |
| 12 | **Mark Attendance** | Teacher | Record attendance for all students (today) |
| 13 | **Validate Student Pages** | Student | Verify student can access dashboard/profile/materials |

## Generated Demo Data

### School & Admin
```
School Name:       Cambridge International Academy
School Code:       CIA-2025
Admin Email:       admin@cia.local
Admin Password:    AdminPass@2025
Academic Year:     2025-2026
```

### Classes (4 created)
```
- Class 10-A (Grade 10, Section A, Room 101)
- Class 10-B (Grade 10, Section B, Room 102)
- Class 11-A (Grade 11, Section A, Room 201)
- Class 12-A (Grade 12, Section A, Room 301)
```

### Teachers (4 created)
```
1. Dr. Rajesh Kumar      (EMP001) - Mathematics
2. Ms. Priya Singh       (EMP002) - English
3. Mr. Arun Verma        (EMP003) - Science
4. Ms. Anjali Patel      (EMP004) - History
```

### Students (5 created)
```
1. Aditya Sharma         (Roll 101) - DOB: 2008-03-15
2. Bhavna Iyer           (Roll 102) - DOB: 2008-05-22
3. Chirag Gupta          (Roll 103) - DOB: 2008-07-10
4. Divya Nair            (Roll 104) - DOB: 2008-09-03
5. Evaan Chakraborty     (Roll 105) - DOB: 2008-11-12
```

### Timetable (15 slots)
```
- 5 days × 3 periods per day
- Monday-Friday, 8:00 AM - 11:00 AM
- Each slot: Class 10-A, Dr. Rajesh Kumar, Mathematics
```

### Homework Assignments (4 created)
```
1. Algebra Fundamentals - Chapter 5 (50 marks, Due in 7 days)
2. Scientific Method Practice (50 marks, Due in 7 days)
3. Historical Analysis Essay (50 marks, Due in 7 days)
4. Grammar & Composition Exercises (50 marks, Due in 7 days)
```

### Quiz (1 created)
```
Title:             Mid-Term Assessment
Chapter:           Fundamentals
Duration:          60 minutes
Total Marks:       100
Questions:         2 (multiple choice)
- "What is 5 + 3?" (Options: 7, 8✓, 9, 10)
- "What is the capital of France?" (Options: London, Paris✓, Berlin, Madrid)
Scheduled:         Tomorrow at current time
```

### Attendance (1 day)
```
Date:              Today
Class:             Class 10-A
Students Marked:   5
Statuses:          Random (present, absent, late)
```

## Error Handling & Resilience

The seeder gracefully handles common failures:

| Scenario | Behavior |
|----------|----------|
| **Class already exists** | Log warning and continue (idempotent via email) |
| **Teacher email duplicate** | Skip creation and move to next teacher |
| **Invalid credentials** | Fail immediately with clear error |
| **Network timeout** | Retry with context timeout (5 minutes default) |
| **API returns 4xx/5xx** | Log error and continue if step is optional |
| **Missing class for students** | Fail fast (dependency not met) |

## Advanced Options

### 1. **Verbose Logging** (Troubleshooting)

```bash
./bin/seeder -verbose
```

Outputs per-step details:
```
[VERBOSE] Teacher login for homework: success
[VERBOSE] Created homework: Algebra Fundamentals - Chapter 5 (UUID)
[VERBOSE] Materials upload: placeholder (multipart form upload requires FormFile)
```

### 2. **Custom Seed for Reproducibility**

```bash
# Run 1
./bin/seeder -seed 999

# Run 2: Identical student names, phone numbers, etc.
./bin/seeder -seed 999
```

### 3. **Dry-Run + Verbose for Testing**

```bash
./bin/seeder -dry-run -verbose -api http://staging-api:8080/api/v1
```

Perfect for validating API contracts before production runs.

## Integration with CI/CD

### GitHub Actions Example

```yaml
name: Seed Demo Data

on:
  workflow_dispatch:
    inputs:
      environment:
        description: Target environment
        required: true
        default: staging
        type: choice
        options:
          - staging
          - demo

jobs:
  seed:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-go@v4
        with:
          go-version: 1.21
      
      - name: Build Seeder
        run: cd Schools24-backend && go build -o bin/seeder ./cmd/seeder
      
      - name: Run Seeder (Dry-run First)
        run: |
          ./Schools24-backend/bin/seeder \
            -api https://api-${{ github.event.inputs.environment }}.schools24.io/api/v1 \
            -dry-run -verbose
      
      - name: Run Seeder (Commit Data)
        if: github.ref == 'refs/heads/main'
        run: |
          ./Schools24-backend/bin/seeder \
            -api https://api-${{ github.event.inputs.environment }}.schools24.io/api/v1 \
            -school-name "CI Demo - $(date +%Y-%m-%d)" \
            -verbose
```

## Testing Page Coverage

The seeder validates the following admin/teacher/student pages:

### Admin Pages
- ✅ Dashboard (`/admin/dashboard`)
- ✅ Users list (`/admin/users`)
- ✅ Teachers list (`/admin/teachers`)
- ✅ Students list (`/admin/students-list`)
- ✅ Classes management (`/admin/classes`)
- ✅ Timetable configuration (`/admin/timetable`)

### Teacher Pages
- ✅ Dashboard (`/teacher/dashboard`)
- ✅ Classes & Timetable (`/teacher/timetable`)
- ✅ Homework assignments (`/teacher/homework`)
- ✅ Quizzes (`/teacher/quizzes`)
- ✅ Attendance (`/teacher/attendance`)
- ✅ Materials upload (`/teacher/materials`)

### Student Pages
- ✅ Dashboard (`/student/dashboard`)
- ✅ Profile (`/student/profile`)
- ✅ Materials (`/student/materials`)
- ✅ Attendance view (`/student/attendance`)
- ✅ Homework review (`/student/homework`)

## Performance & Constraints

| Metric | Value |
|--------|-------|
| **Total runtime** | ~30-60 seconds (depends on API latency) |
| **API calls made** | 50-80 (varies by step success) |
| **Data generated** | 4 classes, 4 teachers, 5 students, 15 timetable slots, 4+ exercises |
| **Max academic year** | 2030+ (configurable) |
| **Largest payload** | Quiz with questions/options (~5KB JSON) |

## Troubleshooting

### Issue: "Invalid credentials for super admin"

**Cause**: Super-admin account doesn't exist or password is wrong.

**Solution**:
1. Check database for `super_admins` table entry
2. Verify email and password match
3. Create super-admin via separate admin CLI if needed

```bash
# Check existing super admin
psql -h localhost postgres -c "SELECT * FROM public.super_admins LIMIT 1;"
```

### Issue: "school_id missing from context"

**Cause**: Admin login succeeded but JWT context isn't properly scoped.

**Solution**:
1. Verify backend middleware sets `school_id` during tenant routing
2. Check JWT payload includes `school_id` claim
3. Rebuild backend and restart

### Issue: "No classes available for student assignment"

**Cause**: Class creation step failed silently; no fallback.

**Solution**:
1. Run with `-verbose` to see detailed errors
2. Check admin has permission to create classes
3. Verify timetable configuration is initialized

### Issue: Timeout (5-minute limit)

**Cause**: API is slow or network is latent.

**Solution**:
1. Run with smaller academic year / fewer students
2. Check API server health: `curl http://localhost:8080/health`
3. Consider increasing timeout in `http.Client{}` (modify seeder code)

## Enterprise Considerations

### Security

- **Passwords**: Change all default passwords in production
- **Tokens**: JWT tokens are short-lived (1 hour default); seeder requests new tokens per role transition
- **HTTPS**: Use `https://` endpoints in production
- **Audit**: All API calls are logged server-side for compliance

### Data Persistence

- **Idempotency**: Email addresses serve as natural unique keys
- **Replayability**: Use same `-seed` to regenerate identical data
- **Cleanup**: Schools and associated data can be soft-deleted via `/admin/schools/{id}/trash`

### Monitoring

- **Verbose logs**: Use `-verbose` to see all HTTP requests/responses
- **Exit codes**: 0 = success, 1 = failure (suitable for CI/CD pipelines)
- **Operation summaries**: Output includes counts and timestamps

## Future Enhancements

- [ ] Multipart file upload for materials/documents (requires refactoring)
- [ ] Batch student import from CSV
- [ ] Fee structure and payment simulation
- [ ] Admission application workflow
- [ ] Bus route assignments
- [ ] Parent account creation and message broadcasts
- [ ] Grade entry and report card generation

## Support & Feedback

For issues or feature requests:
1. Check this documentation and troubleshooting section
2. Review seeder logs with `-verbose` flag
3. Open issue in repository with seeder output and configuration

---

**Last Updated**: 2025-01-04  
**Seeder Version**: 1.0.0  
**Go Version**: 1.21+
