CREATE TABLE IF NOT EXISTS global_classes (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_global_classes_name_ci
    ON global_classes (LOWER(name));

CREATE INDEX IF NOT EXISTS idx_global_classes_sort_order
    ON global_classes (sort_order);

CREATE TABLE IF NOT EXISTS global_subjects (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_global_subjects_name_ci
    ON global_subjects (LOWER(name));

CREATE UNIQUE INDEX IF NOT EXISTS idx_global_subjects_code_ci
    ON global_subjects (LOWER(code))
    WHERE code <> '';

CREATE TABLE IF NOT EXISTS global_class_subjects (
    class_id UUID NOT NULL REFERENCES global_classes(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES global_subjects(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (class_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_global_class_subjects_subject
    ON global_class_subjects (subject_id);
