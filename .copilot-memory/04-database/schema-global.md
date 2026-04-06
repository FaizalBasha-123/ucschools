# Global Schema (public)

## Core Tables

### users
Platform-wide user accounts
- `id` (UUID PK)
- `email` (unique), `password_hash`
- `role` (super_admin|admin|teacher|student|staff|parent)
- `full_name`, `phone`, `profile_picture_url`
- `is_active`, `email_verified`, `last_login_at`

### schools
School organizations
- `id` (UUID PK), `code` (unique)
- `name`, `address`, `phone`, `email`, `website`
- `created_at`, `updated_at`
- `soft_delete` (for trash/recovery)

### super_admins
Super admin privileges
- `id`, `user_id` (FK users)
- `school_id`, `is_suspended`

### support_tickets
Help desk tickets
- `id`, `ticket_number` (auto-increment)
- `user_id`, `user_type` (admin|teacher|student|public)
- `subject`, `description`, `category`, `priority`
- `status` (open|in_progress|resolved|closed)
- `labels` (landing|student|teacher|school_admin)

### blog_posts
Public blog content
- `id`, `slug` (unique)
- `title`, `content`, `author_id`
- `published_at`, `read_time_minutes`

### admission_applications
Public admission forms
- `id`, `applicant_email`, `school_id`
- `status` (pending|approved|rejected)
- `form_data` (JSONB)

### interop_jobs
Integration tasks (DIKSHA/DigiLocker/ABC)
- `id`, `school_id`, `student_id`
- `job_type`, `status`, `idempotency_key`

### parental_consents
Global consent records
- `id`, `student_id`, `parent_id`
- `consent_type` (photo|video|data_processing)
- `status` (pending|accepted|withdrawn)

### Other Global Tables
- `push_device_tokens` - FCM tokens
- `demo_requests` - Demo request tracking
- `teacher_appointment_applications` - Teacher hiring
- `learner_registry` - National learner registry
- `learner_transfer_requests` - School transfers
