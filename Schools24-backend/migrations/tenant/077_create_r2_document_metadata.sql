-- Tenant-scoped metadata for R2-backed documents.
-- These tables replace Mongo metadata collections while keeping binary content in object storage.

CREATE TABLE IF NOT EXISTS question_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id TEXT NOT NULL,
    teacher_name TEXT NOT NULL DEFAULT '',
    school_id TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    topic TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    class_level TEXT NOT NULL DEFAULT '',
    question_type TEXT NOT NULL DEFAULT '',
    difficulty TEXT NOT NULL DEFAULT '',
    num_questions INTEGER NOT NULL DEFAULT 0,
    context TEXT NOT NULL DEFAULT '',
    file_name TEXT NOT NULL,
    file_size BIGINT NOT NULL DEFAULT 0,
    mime_type TEXT NOT NULL DEFAULT '',
    file_sha256 TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS study_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uploader_id TEXT NOT NULL DEFAULT '',
    uploader_name TEXT NOT NULL DEFAULT '',
    uploader_role TEXT NOT NULL DEFAULT '',
    teacher_id TEXT NOT NULL DEFAULT '',
    teacher_name TEXT NOT NULL DEFAULT '',
    school_id TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    subject_key TEXT NOT NULL DEFAULT '',
    class_level TEXT NOT NULL DEFAULT '',
    class_key TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    file_name TEXT NOT NULL,
    file_size BIGINT NOT NULL DEFAULT 0,
    mime_type TEXT NOT NULL DEFAULT '',
    file_sha256 TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_individual_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id TEXT NOT NULL,
    class_id TEXT NOT NULL DEFAULT '',
    class_name TEXT NOT NULL DEFAULT '',
    student_id TEXT NOT NULL,
    student_name TEXT NOT NULL DEFAULT '',
    teacher_id TEXT NOT NULL,
    teacher_name TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    report_type TEXT NOT NULL DEFAULT 'report',
    academic_year TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    file_name TEXT NOT NULL,
    file_size BIGINT NOT NULL DEFAULT 0,
    mime_type TEXT NOT NULL DEFAULT '',
    file_sha256 TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teacher_homework_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id TEXT NOT NULL,
    teacher_id TEXT NOT NULL,
    homework_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size BIGINT NOT NULL DEFAULT 0,
    mime_type TEXT NOT NULL DEFAULT '',
    file_sha256 TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admission_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id TEXT NOT NULL,
    application_id TEXT NOT NULL,
    document_type TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size BIGINT NOT NULL DEFAULT 0,
    mime_type TEXT NOT NULL DEFAULT '',
    file_sha256 TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teacher_appointment_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id TEXT NOT NULL,
    application_id TEXT NOT NULL,
    document_type TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size BIGINT NOT NULL DEFAULT 0,
    mime_type TEXT NOT NULL DEFAULT '',
    file_sha256 TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_question_documents_dedupe
    ON question_documents(teacher_id, file_sha256, question_type);
CREATE INDEX IF NOT EXISTS idx_question_documents_teacher_uploaded_at
    ON question_documents(teacher_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_question_documents_school_uploaded_at
    ON question_documents(school_id, uploaded_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_study_materials_dedupe
    ON study_materials(school_id, teacher_id, file_sha256, subject, class_level);
CREATE INDEX IF NOT EXISTS idx_study_materials_teacher_uploaded_at
    ON study_materials(school_id, teacher_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_study_materials_teacher_subject_class_uploaded
    ON study_materials(school_id, teacher_id, subject, class_level, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_study_materials_school_class_subject_uploaded
    ON study_materials(school_id, class_level, subject, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_study_materials_school_class_key_subject_key_uploaded
    ON study_materials(school_id, class_key, subject_key, uploaded_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_student_individual_reports_dedupe
    ON student_individual_reports(school_id, teacher_id, student_id, class_id, file_sha256, academic_year, report_type);
CREATE INDEX IF NOT EXISTS idx_student_individual_reports_teacher_uploaded_at
    ON student_individual_reports(teacher_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_individual_reports_school_student_uploaded_at
    ON student_individual_reports(school_id, student_id, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_teacher_homework_attachments_lookup
    ON teacher_homework_attachments(school_id, teacher_id, homework_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_teacher_homework_attachments_storage_key
    ON teacher_homework_attachments(storage_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admission_documents_application_type
    ON admission_documents(school_id, application_id, document_type);
CREATE INDEX IF NOT EXISTS idx_admission_documents_application_uploaded_at
    ON admission_documents(school_id, application_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_admission_documents_storage_key
    ON admission_documents(storage_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_appointment_documents_application_type
    ON teacher_appointment_documents(school_id, application_id, document_type);
CREATE INDEX IF NOT EXISTS idx_teacher_appointment_documents_application_uploaded_at
    ON teacher_appointment_documents(school_id, application_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_teacher_appointment_documents_storage_key
    ON teacher_appointment_documents(storage_key);
