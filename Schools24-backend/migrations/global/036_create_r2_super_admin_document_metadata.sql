-- Global metadata for super-admin R2-backed documents.

CREATE TABLE IF NOT EXISTS public.super_admin_question_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id TEXT NOT NULL,
    owner_email TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    subject_key TEXT NOT NULL DEFAULT '',
    class_level TEXT NOT NULL DEFAULT '',
    class_key TEXT NOT NULL DEFAULT '',
    question_type TEXT NOT NULL DEFAULT '',
    difficulty TEXT NOT NULL DEFAULT '',
    context TEXT NOT NULL DEFAULT '',
    file_name TEXT NOT NULL,
    file_size BIGINT NOT NULL DEFAULT 0,
    mime_type TEXT NOT NULL DEFAULT '',
    file_sha256 TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.super_admin_study_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id TEXT NOT NULL,
    uploader_id TEXT NOT NULL DEFAULT '',
    uploader_name TEXT NOT NULL DEFAULT '',
    uploader_role TEXT NOT NULL DEFAULT '',
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_super_admin_question_documents_dedupe
    ON public.super_admin_question_documents(owner_user_id, file_sha256, question_type);
CREATE INDEX IF NOT EXISTS idx_super_admin_question_documents_owner_uploaded_at
    ON public.super_admin_question_documents(owner_user_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_super_admin_question_documents_class_subject_uploaded
    ON public.super_admin_question_documents(class_key, subject_key, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_super_admin_question_documents_storage_key
    ON public.super_admin_question_documents(storage_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_super_admin_study_materials_dedupe
    ON public.super_admin_study_materials(owner_user_id, file_sha256, subject, class_level);
CREATE INDEX IF NOT EXISTS idx_super_admin_study_materials_owner_uploaded_at
    ON public.super_admin_study_materials(owner_user_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_super_admin_study_materials_owner_subject_class_uploaded
    ON public.super_admin_study_materials(owner_user_id, subject, class_level, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_super_admin_study_materials_class_subject_uploaded
    ON public.super_admin_study_materials(class_key, subject_key, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_super_admin_study_materials_storage_key
    ON public.super_admin_study_materials(storage_key);
