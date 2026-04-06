# Admin API Routes

Base: `/api/v1/admin`

## Dashboard
- `GET /admin/dashboard` - Stats overview

## User Management
- `GET /admin/users` - List users
- `POST /admin/users` - Create user
- `PUT /admin/users/:id` - Update user
- `DELETE /admin/users/:id` - Delete user

## Students
- `GET /admin/students-list` - List students
- `GET /admin/students-details` - Detailed list
- `POST /admin/students` - Add student
- `PUT /admin/students/:id` - Update student
- `DELETE /admin/students/:id` - Delete student

## Teachers
- `GET /admin/teachers` - List teachers
- `POST /admin/teachers` - Add teacher
- `PUT /admin/teachers/:id` - Update teacher
- `DELETE /admin/teachers/:id` - Delete teacher

## Staff
- `GET /admin/staff` - List staff
- `POST /admin/staff` - Add staff

## Classes & Subjects
- `GET /admin/catalog/classes` - Global class catalog
- `GET /admin/classes` - School classes
- `POST /admin/classes` - Create class

## Timetables
- `GET /admin/timetable/classes` - Timetable by class
- `GET /admin/timetable/teachers` - Timetable by teacher
- `POST /admin/timetable/slots` - Upsert timetable slot
- `DELETE /admin/timetable/slots/:id` - Delete slot

## Bus Routes
- `GET /admin/bus-routes` - List routes
- `POST /admin/bus-routes` - Create route
- `PUT /admin/bus-routes/:id` - Update route
- `DELETE /admin/bus-routes/:id` - Delete route

## Question Documents
- `GET /admin/question-documents` - List documents
- `GET /admin/question-documents/:id/view` - View document
- `GET /admin/question-documents/:id/download` - Download
