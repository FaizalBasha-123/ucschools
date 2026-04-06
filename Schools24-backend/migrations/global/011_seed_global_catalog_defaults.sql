-- Seed default centralized classes (LKG, UKG, Class 1-12)
INSERT INTO global_classes (id, name, sort_order, created_at, updated_at)
SELECT '11111111-1111-1111-1111-111111111001'::uuid, 'LKG', 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_classes WHERE LOWER(name) = LOWER('LKG'));

INSERT INTO global_classes (id, name, sort_order, created_at, updated_at)
SELECT '11111111-1111-1111-1111-111111111002'::uuid, 'UKG', 2, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_classes WHERE LOWER(name) = LOWER('UKG'));

INSERT INTO global_classes (id, name, sort_order, created_at, updated_at)
SELECT '11111111-1111-1111-1111-111111111003'::uuid, 'Class 1', 3, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_classes WHERE LOWER(name) = LOWER('Class 1'));

INSERT INTO global_classes (id, name, sort_order, created_at, updated_at)
SELECT '11111111-1111-1111-1111-111111111004'::uuid, 'Class 2', 4, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_classes WHERE LOWER(name) = LOWER('Class 2'));

INSERT INTO global_classes (id, name, sort_order, created_at, updated_at)
SELECT '11111111-1111-1111-1111-111111111005'::uuid, 'Class 3', 5, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_classes WHERE LOWER(name) = LOWER('Class 3'));

INSERT INTO global_classes (id, name, sort_order, created_at, updated_at)
SELECT '11111111-1111-1111-1111-111111111006'::uuid, 'Class 4', 6, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_classes WHERE LOWER(name) = LOWER('Class 4'));

INSERT INTO global_classes (id, name, sort_order, created_at, updated_at)
SELECT '11111111-1111-1111-1111-111111111007'::uuid, 'Class 5', 7, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_classes WHERE LOWER(name) = LOWER('Class 5'));

INSERT INTO global_classes (id, name, sort_order, created_at, updated_at)
SELECT '11111111-1111-1111-1111-111111111008'::uuid, 'Class 6', 8, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_classes WHERE LOWER(name) = LOWER('Class 6'));

INSERT INTO global_classes (id, name, sort_order, created_at, updated_at)
SELECT '11111111-1111-1111-1111-111111111009'::uuid, 'Class 7', 9, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_classes WHERE LOWER(name) = LOWER('Class 7'));

INSERT INTO global_classes (id, name, sort_order, created_at, updated_at)
SELECT '11111111-1111-1111-1111-111111111010'::uuid, 'Class 8', 10, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_classes WHERE LOWER(name) = LOWER('Class 8'));

INSERT INTO global_classes (id, name, sort_order, created_at, updated_at)
SELECT '11111111-1111-1111-1111-111111111011'::uuid, 'Class 9', 11, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_classes WHERE LOWER(name) = LOWER('Class 9'));

INSERT INTO global_classes (id, name, sort_order, created_at, updated_at)
SELECT '11111111-1111-1111-1111-111111111012'::uuid, 'Class 10', 12, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_classes WHERE LOWER(name) = LOWER('Class 10'));

INSERT INTO global_classes (id, name, sort_order, created_at, updated_at)
SELECT '11111111-1111-1111-1111-111111111013'::uuid, 'Class 11', 13, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_classes WHERE LOWER(name) = LOWER('Class 11'));

INSERT INTO global_classes (id, name, sort_order, created_at, updated_at)
SELECT '11111111-1111-1111-1111-111111111014'::uuid, 'Class 12', 14, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_classes WHERE LOWER(name) = LOWER('Class 12'));

-- Keep sort order stable if rows already existed
UPDATE global_classes SET sort_order = 1, updated_at = NOW() WHERE LOWER(name) = LOWER('LKG');
UPDATE global_classes SET sort_order = 2, updated_at = NOW() WHERE LOWER(name) = LOWER('UKG');
UPDATE global_classes SET sort_order = 3, updated_at = NOW() WHERE LOWER(name) = LOWER('Class 1');
UPDATE global_classes SET sort_order = 4, updated_at = NOW() WHERE LOWER(name) = LOWER('Class 2');
UPDATE global_classes SET sort_order = 5, updated_at = NOW() WHERE LOWER(name) = LOWER('Class 3');
UPDATE global_classes SET sort_order = 6, updated_at = NOW() WHERE LOWER(name) = LOWER('Class 4');
UPDATE global_classes SET sort_order = 7, updated_at = NOW() WHERE LOWER(name) = LOWER('Class 5');
UPDATE global_classes SET sort_order = 8, updated_at = NOW() WHERE LOWER(name) = LOWER('Class 6');
UPDATE global_classes SET sort_order = 9, updated_at = NOW() WHERE LOWER(name) = LOWER('Class 7');
UPDATE global_classes SET sort_order = 10, updated_at = NOW() WHERE LOWER(name) = LOWER('Class 8');
UPDATE global_classes SET sort_order = 11, updated_at = NOW() WHERE LOWER(name) = LOWER('Class 9');
UPDATE global_classes SET sort_order = 12, updated_at = NOW() WHERE LOWER(name) = LOWER('Class 10');
UPDATE global_classes SET sort_order = 13, updated_at = NOW() WHERE LOWER(name) = LOWER('Class 11');
UPDATE global_classes SET sort_order = 14, updated_at = NOW() WHERE LOWER(name) = LOWER('Class 12');

-- Seed default centralized subjects
INSERT INTO global_subjects (id, name, code, created_at, updated_at)
SELECT '22222222-2222-2222-2222-222222222001'::uuid, 'English', 'ENG', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_subjects WHERE LOWER(name) = LOWER('English'));

INSERT INTO global_subjects (id, name, code, created_at, updated_at)
SELECT '22222222-2222-2222-2222-222222222002'::uuid, 'Mathematics', 'MATH', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_subjects WHERE LOWER(name) = LOWER('Mathematics'));

INSERT INTO global_subjects (id, name, code, created_at, updated_at)
SELECT '22222222-2222-2222-2222-222222222003'::uuid, 'Science', 'SCI', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_subjects WHERE LOWER(name) = LOWER('Science'));

INSERT INTO global_subjects (id, name, code, created_at, updated_at)
SELECT '22222222-2222-2222-2222-222222222004'::uuid, 'Social Studies', 'SST', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_subjects WHERE LOWER(name) = LOWER('Social Studies'));

INSERT INTO global_subjects (id, name, code, created_at, updated_at)
SELECT '22222222-2222-2222-2222-222222222005'::uuid, 'Hindi', 'HIN', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_subjects WHERE LOWER(name) = LOWER('Hindi'));

INSERT INTO global_subjects (id, name, code, created_at, updated_at)
SELECT '22222222-2222-2222-2222-222222222006'::uuid, 'Sanskrit', 'SAN', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_subjects WHERE LOWER(name) = LOWER('Sanskrit'));

INSERT INTO global_subjects (id, name, code, created_at, updated_at)
SELECT '22222222-2222-2222-2222-222222222007'::uuid, 'Computer Science', 'CS', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_subjects WHERE LOWER(name) = LOWER('Computer Science'));

INSERT INTO global_subjects (id, name, code, created_at, updated_at)
SELECT '22222222-2222-2222-2222-222222222008'::uuid, 'Physics', 'PHY', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_subjects WHERE LOWER(name) = LOWER('Physics'));

INSERT INTO global_subjects (id, name, code, created_at, updated_at)
SELECT '22222222-2222-2222-2222-222222222009'::uuid, 'Chemistry', 'CHEM', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_subjects WHERE LOWER(name) = LOWER('Chemistry'));

INSERT INTO global_subjects (id, name, code, created_at, updated_at)
SELECT '22222222-2222-2222-2222-222222222010'::uuid, 'Biology', 'BIO', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_subjects WHERE LOWER(name) = LOWER('Biology'));

INSERT INTO global_subjects (id, name, code, created_at, updated_at)
SELECT '22222222-2222-2222-2222-222222222011'::uuid, 'History', 'HIS', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_subjects WHERE LOWER(name) = LOWER('History'));

INSERT INTO global_subjects (id, name, code, created_at, updated_at)
SELECT '22222222-2222-2222-2222-222222222012'::uuid, 'Geography', 'GEO', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_subjects WHERE LOWER(name) = LOWER('Geography'));

INSERT INTO global_subjects (id, name, code, created_at, updated_at)
SELECT '22222222-2222-2222-2222-222222222013'::uuid, 'Civics', 'CIV', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_subjects WHERE LOWER(name) = LOWER('Civics'));

INSERT INTO global_subjects (id, name, code, created_at, updated_at)
SELECT '22222222-2222-2222-2222-222222222014'::uuid, 'Economics', 'ECO', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_subjects WHERE LOWER(name) = LOWER('Economics'));

INSERT INTO global_subjects (id, name, code, created_at, updated_at)
SELECT '22222222-2222-2222-2222-222222222015'::uuid, 'Accountancy', 'ACC', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_subjects WHERE LOWER(name) = LOWER('Accountancy'));

INSERT INTO global_subjects (id, name, code, created_at, updated_at)
SELECT '22222222-2222-2222-2222-222222222016'::uuid, 'Business Studies', 'BST', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_subjects WHERE LOWER(name) = LOWER('Business Studies'));

INSERT INTO global_subjects (id, name, code, created_at, updated_at)
SELECT '22222222-2222-2222-2222-222222222017'::uuid, 'Environmental Science', 'EVS', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_subjects WHERE LOWER(name) = LOWER('Environmental Science'));

INSERT INTO global_subjects (id, name, code, created_at, updated_at)
SELECT '22222222-2222-2222-2222-222222222018'::uuid, 'General Knowledge', 'GK', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_subjects WHERE LOWER(name) = LOWER('General Knowledge'));

INSERT INTO global_subjects (id, name, code, created_at, updated_at)
SELECT '22222222-2222-2222-2222-222222222019'::uuid, 'Physical Education', 'PE', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_subjects WHERE LOWER(name) = LOWER('Physical Education'));

INSERT INTO global_subjects (id, name, code, created_at, updated_at)
SELECT '22222222-2222-2222-2222-222222222020'::uuid, 'Art', 'ART', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_subjects WHERE LOWER(name) = LOWER('Art'));

INSERT INTO global_subjects (id, name, code, created_at, updated_at)
SELECT '22222222-2222-2222-2222-222222222021'::uuid, 'Music', 'MUS', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM global_subjects WHERE LOWER(name) = LOWER('Music'));

-- Default class-subject assignments
WITH class_map AS (
    SELECT id, name FROM global_classes
),
subject_map AS (
    SELECT id, name FROM global_subjects
),
seed_pairs AS (
    -- LKG, UKG
    SELECT c.id AS class_id, s.id AS subject_id
    FROM class_map c
    JOIN subject_map s ON s.name IN ('English', 'Mathematics', 'Environmental Science', 'General Knowledge', 'Art', 'Music', 'Physical Education')
    WHERE c.name IN ('LKG', 'UKG')

    UNION ALL
    -- Class 1-5
    SELECT c.id, s.id
    FROM class_map c
    JOIN subject_map s ON s.name IN ('English', 'Mathematics', 'Science', 'Social Studies', 'Hindi', 'General Knowledge', 'Computer Science', 'Art', 'Music', 'Physical Education')
    WHERE c.name IN ('Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5')

    UNION ALL
    -- Class 6-8
    SELECT c.id, s.id
    FROM class_map c
    JOIN subject_map s ON s.name IN ('English', 'Mathematics', 'Science', 'History', 'Geography', 'Civics', 'Hindi', 'Sanskrit', 'Computer Science', 'Physical Education')
    WHERE c.name IN ('Class 6', 'Class 7', 'Class 8')

    UNION ALL
    -- Class 9-10
    SELECT c.id, s.id
    FROM class_map c
    JOIN subject_map s ON s.name IN ('English', 'Mathematics', 'Science', 'Social Studies', 'Hindi', 'Computer Science', 'Physical Education')
    WHERE c.name IN ('Class 9', 'Class 10')

    UNION ALL
    -- Class 11-12
    SELECT c.id, s.id
    FROM class_map c
    JOIN subject_map s ON s.name IN ('English', 'Physics', 'Chemistry', 'Biology', 'Mathematics', 'Economics', 'Accountancy', 'Business Studies', 'Computer Science', 'Physical Education')
    WHERE c.name IN ('Class 11', 'Class 12')
)
INSERT INTO global_class_subjects (class_id, subject_id, created_at)
SELECT class_id, subject_id, NOW()
FROM seed_pairs
ON CONFLICT (class_id, subject_id) DO NOTHING;
