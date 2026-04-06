CREATE TABLE IF NOT EXISTS global_quiz_subject_chapters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    super_admin_id UUID NOT NULL REFERENCES super_admins(id) ON DELETE CASCADE,
    class_id UUID NOT NULL REFERENCES global_classes(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES global_subjects(id) ON DELETE CASCADE,
    chapter_name TEXT NOT NULL CHECK (length(trim(chapter_name)) > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (super_admin_id, class_id, subject_id, chapter_name)
);

CREATE INDEX IF NOT EXISTS idx_global_quiz_subject_chapters_scope
ON global_quiz_subject_chapters (class_id, subject_id, chapter_name);

CREATE INDEX IF NOT EXISTS idx_global_quiz_subject_chapters_admin
ON global_quiz_subject_chapters (super_admin_id, class_id, subject_id);
