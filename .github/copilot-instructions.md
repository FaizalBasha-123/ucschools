# Schools24 Copilot Instructions (Current Codebase)

Use this as the source of truth for all generated code and refactors.

## 1) Architecture Baseline

- Backend: Go + Gin + pgx (PostgreSQL) + optional Redis + MongoDB.
- Frontend: Next.js 16 + React Query + Tailwind + shadcn/ui.
- Data model is multi-tenant:
  - Global (`public`): shared platform data.
  - Tenant schema (`school_<school_id>`): school-isolated operational data.

## 2) Data Boundaries

### Global (`public`) data
- `schools`
- `super_admins`
- Centralized catalog:
  - `global_classes`
  - `global_subjects`
  - `global_class_subjects`

### Tenant (`school_<id>`) data
- `users`, `students`, `teachers`, `classes`, `subjects`, `attendance`, `timetables`, fees/payment tables, etc.
- Communication and learning tables now include:
  - `class_group_messages`
  - `homework` metadata extensions (`attachment_count`, `has_attachments`)
  - `quizzes`, `quiz_questions`, `quiz_options`

### MongoDB storage
- Binary document content for:
  - Teacher question documents
  - Teacher study materials
  - Super-admin question documents/materials
  - Homework attachment files
- PostgreSQL stores relational metadata and authorization scope; Mongo stores payload bytes.

## 3) Tenant Resolution Rules

- JWT must be processed before tenant middleware.
- `TenantMiddleware` sets schema using `school_id` (for non-super-admin users).
- Super admin can pass `school_id` for tenant-scoped admin APIs.
- DB search path pattern: tenant schema first, then `public`.

## 4) Route/Feature Reality (Do not invent alternate APIs)

### Teacher routes (implemented)
- Timetable/classes/attendance:
  - `/teacher/classes`
  - `/teacher/timetable`
  - `/teacher/timetable/config`
  - `/teacher/timetable/classes/:classId`
  - `/teacher/attendance` (GET/POST)
- Documents and materials:
  - `/teacher/question-documents` (+ filters/view/download/upload)
  - `/teacher/question-uploader/options`
  - `/teacher/materials` (list/view/download/upload/delete)
- Messaging:
  - `/teacher/messages/class-groups`
  - `/teacher/messages/class-groups/:classId/messages` (GET/POST)
- Homework:
  - `/teacher/homework/options`
  - `/teacher/homework` (GET/POST)
  - attachment view/download
- Quiz scheduler:
  - `/teacher/quizzes/options`
  - `/teacher/quizzes` (GET/POST)

### Super admin routes (implemented)
- School lifecycle + trash/restore.
- Global catalog CRUD:
  - `/super-admin/catalog/classes`
  - `/super-admin/catalog/subjects`
  - `/super-admin/catalog/assignments`
- Super-admin owned uploads:
  - `/super-admin/question-documents` (list/view/download/upload)
  - `/super-admin/materials` (list/view/download/upload/delete)

### Admin routes (implemented)
- `/admin/dashboard`, `/admin/users`, `/admin/teachers`, `/admin/staff`, `/admin/students-list`
- `/admin/catalog/classes` (read global classes for admin usage)
- `/admin/question-documents` (list/view/download)
- `/admin/bus-routes` (GET/POST/PUT/DELETE)
- Timetable APIs for classes/teachers and slot upserts/deletes.

## 5) Product Rules to Enforce in Generated Code

- Subjects and classes are centralized from super admin catalog.
- Admin must not reintroduce school-local subject CRUD behavior as primary source.
- Teacher-scoped pages must show only class/subject combinations assigned via timetable/assignment logic.
- Teacher question/material lists must include allowed super-admin documents where class/subject scope matches.
- School isolation is mandatory for all tenant writes and reads.

## 6) Frontend Integration Rules

- Prefer existing backend endpoints above creating new API shapes.
- Use React Query with stable query keys and paginated fetching where available.
- Keep role gating strict in UI and API usage.
- Avoid mock data for Admin/Teacher/Super-admin workflow pages that already have backend endpoints.
- Student pages are still under active integration; treat current mock-heavy student UI as transitional.

## 7) Performance and Reliability Rules

- Keep list endpoints paginated (`page`, `page_size`), avoid unbounded queries.
- Preserve and use DB indexes added by migrations for attendance/homework/quiz and catalog lookups.
- Handle nullable DB fields safely (no scans into non-null pointers for nullable columns).
- Redis must remain optional in local/dev startup (no hard failure when unavailable).
- For binary responses, stream with correct content headers and avoid malformed response lengths.

## 8) Migration and Schema Discipline

- New schema changes must be added as migrations (global vs tenant correctly separated).
- Never place tenant-only tables in `public`.
- Avoid destructive changes without backward-compatible rollout.
- Keep naming/indexing consistent with existing migration conventions.
