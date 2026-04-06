# Tenant Schema (school_<uuid>)

## Core Tables

### students
Student profiles
- `id`, `user_id` (FK), `admission_number`, `roll_number`
- `class_id`, `section`, `date_of_birth`, `gender`, `blood_group`
- `parent_name`, `parent_email`, `parent_phone`, `emergency_contact`
- `admission_date`, `academic_year`
- `bus_transport_id` (FK - route assignment)
- `federated_ids` (JSONB - DigiLocker/DIKSHA)
- `learner_id` (FK - global learner registry)

### teachers
Teacher profiles
- `id`, `user_id` (FK), `employee_id`
- `subject_ids` (JSONB), `qualification`, `experience_years`
- `salary`, `hire_date`, `rating`

### classes
Class definitions
- `id`, `name` (e.g., "Class 10-A"), `grade`, `section`
- `academic_year`, `sort_order`, `total_students`

### subjects
Subject catalog
- `id`, `name`, `code`
- `grade_applicable` (JSONB - [9,10,11,12])
- `is_active`

### timetables
Class schedules
- `id`, `class_id`, `teacher_id`, `subject_id`
- `day_of_week`, `time_slot`, `room_number`
- `academic_year`, `academic_session`

### attendance_sessions
Daily attendance tracking
- `id`, `class_id`, `session_date`
- `status` (completed|pending), `recorded_by`

### attendance
Individual attendance records
- `id`, `student_id`, `attendance_session_id`
- `status` (present|absent|late|leave)
- `remarks`

### homework
Homework assignments
- `id`, `subject_id`, `class_id`, `teacher_id`
- `title`, `description`, `due_date`
- `attachments` (JSONB), `status`

### quizzes
Quiz definitions
- `id`, `title`, `subject_id`, `class_ids` (JSONB)
- `max_marks`, `pass_marks`, `time_limit_minutes`
- `allow_anytime`, `start_date`, `end_date`

### assessments
Exam management
- `id`, `title`, `subject_id`, `class_ids` (JSONB)
- `assessment_type` (term|unit|final|assignment)
- `max_marks`, `pass_marks`, `scheduled_date`

### fees
Fee structures
- `id`, `name`, `applicable_grades` (JSONB), `academic_year`

### fee_payments
Payment transactions
- `id`, `student_fee_id`, `amount`, `payment_method`
- `transaction_id`, `status` (pending|success|failed)

### bus_routes
Transport routes
- `id`, `route_name`, `stops` (JSONB), `driver_id`
- `is_active`

### class_group_messages
Teacher messaging
- `id`, `class_id`, `user_id`
- `title`, `description`, `created_at`

## Other Tenant Tables
- `non_teaching_staff`, `inventory_items`
- `student_transfer_requests`, `data_subject_requests`
- `consent_audit_events`, `leaderboard_entries`
- `events`, `student_feedback`, `student_grades`
