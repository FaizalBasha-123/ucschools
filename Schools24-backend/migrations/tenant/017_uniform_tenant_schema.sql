-- Uniform tenant schema migration
-- Adds missing tables/columns so all school_<id> schemas match the latest template

-- 1) Operational tables
CREATE TABLE IF NOT EXISTS bus_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL,
    route_number VARCHAR(50) NOT NULL,
    driver_name VARCHAR(255),
    driver_phone VARCHAR(20),
    vehicle_number VARCHAR(50),
    capacity INT,
    status VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bus_stops (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id UUID NOT NULL REFERENCES bus_routes(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    arrival_time TIME,
    stop_order INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    event_date DATE NOT NULL,
    start_time TIME,
    end_time TIME,
    type VARCHAR(50) NOT NULL,
    location VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    quantity INT DEFAULT 0,
    unit VARCHAR(50),
    min_stock INT DEFAULT 0,
    location VARCHAR(255),
    status VARCHAR(20),
    last_updated TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2) Assessments alignment
ALTER TABLE IF EXISTS assessments ADD COLUMN IF NOT EXISTS school_id UUID;
ALTER TABLE IF EXISTS assessments ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE IF EXISTS assessments ADD COLUMN IF NOT EXISTS assessment_type VARCHAR(50);
ALTER TABLE IF EXISTS assessments ADD COLUMN IF NOT EXISTS subject_id UUID;
ALTER TABLE IF EXISTS assessments ADD COLUMN IF NOT EXISTS class_id UUID;
ALTER TABLE IF EXISTS assessments ADD COLUMN IF NOT EXISTS max_marks DECIMAL(5,2);
ALTER TABLE IF EXISTS assessments ADD COLUMN IF NOT EXISTS scheduled_date DATE;
ALTER TABLE IF EXISTS assessments ADD COLUMN IF NOT EXISTS academic_year VARCHAR(20);
ALTER TABLE IF EXISTS assessments ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE IF EXISTS assessments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;

-- 3) Audit logs alignment
ALTER TABLE IF EXISTS audit_logs ADD COLUMN IF NOT EXISTS old_values JSONB;
ALTER TABLE IF EXISTS audit_logs ADD COLUMN IF NOT EXISTS new_values JSONB;
ALTER TABLE IF EXISTS audit_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;

-- 4) Fee structures/items alignment
ALTER TABLE IF EXISTS fee_structures ADD COLUMN IF NOT EXISTS name VARCHAR(255);
ALTER TABLE IF EXISTS fee_structures ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE IF EXISTS fee_structures ADD COLUMN IF NOT EXISTS applicable_grades INT[];
ALTER TABLE IF EXISTS fee_structures ADD COLUMN IF NOT EXISTS academic_year VARCHAR(20);
ALTER TABLE IF EXISTS fee_structures ADD COLUMN IF NOT EXISTS is_active BOOLEAN;
ALTER TABLE IF EXISTS fee_structures ADD COLUMN IF NOT EXISTS created_at TIMESTAMP;
ALTER TABLE IF EXISTS fee_structures ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;

DO $$
DECLARE has_fee_type BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='fee_structures' AND column_name='fee_type' AND table_schema = current_schema()
    ) INTO has_fee_type;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='fee_structures' AND column_name='name' AND table_schema = current_schema()
    ) THEN
        IF has_fee_type THEN
            EXECUTE 'UPDATE fee_structures SET name = COALESCE(name, fee_type, ''Tuition Fee'') WHERE name IS NULL';
        ELSE
            EXECUTE 'UPDATE fee_structures SET name = COALESCE(name, ''Tuition Fee'') WHERE name IS NULL';
        END IF;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS fee_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fee_structure_id UUID NOT NULL REFERENCES fee_structures(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    frequency VARCHAR(20) DEFAULT 'monthly',
    is_optional BOOLEAN DEFAULT FALSE,
    due_day INT DEFAULT 10,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5) Student fees alignment
ALTER TABLE IF EXISTS student_fees ADD COLUMN IF NOT EXISTS fee_item_id UUID;
ALTER TABLE IF EXISTS student_fees ADD COLUMN IF NOT EXISTS amount DECIMAL(10,2);
ALTER TABLE IF EXISTS student_fees ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE IF EXISTS student_fees ADD COLUMN IF NOT EXISTS status VARCHAR(20);
ALTER TABLE IF EXISTS student_fees ADD COLUMN IF NOT EXISTS paid_amount DECIMAL(10,2);
ALTER TABLE IF EXISTS student_fees ADD COLUMN IF NOT EXISTS waiver_amount DECIMAL(10,2);
ALTER TABLE IF EXISTS student_fees ADD COLUMN IF NOT EXISTS waiver_reason TEXT;
ALTER TABLE IF EXISTS student_fees ADD COLUMN IF NOT EXISTS academic_year VARCHAR(20);
ALTER TABLE IF EXISTS student_fees ADD COLUMN IF NOT EXISTS created_at TIMESTAMP;
ALTER TABLE IF EXISTS student_fees ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;

DO $$
DECLARE has_fee_type BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='fee_structures' AND column_name='fee_type' AND table_schema = current_schema()
    ) INTO has_fee_type;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='student_fees' AND column_name='fee_structure_id' AND table_schema = current_schema()
    ) THEN
        -- ensure fee_items exist per fee_structure
        IF has_fee_type THEN
            EXECUTE $q$
                INSERT INTO fee_items (id, fee_structure_id, name, amount, frequency, is_optional, due_day, created_at)
                SELECT gen_random_uuid(), fs.id, COALESCE(fs.name, fs.fee_type, 'Tuition Fee'), COALESCE(fs.amount, 0), COALESCE(fs.frequency, 'monthly'), FALSE, 10, CURRENT_TIMESTAMP
                FROM fee_structures fs
                WHERE NOT EXISTS (
                    SELECT 1 FROM fee_items fi WHERE fi.fee_structure_id = fs.id
                )
            $q$;
        ELSE
            EXECUTE $q$
                INSERT INTO fee_items (id, fee_structure_id, name, amount, frequency, is_optional, due_day, created_at)
                SELECT gen_random_uuid(), fs.id, COALESCE(fs.name, 'Tuition Fee'), COALESCE(fs.amount, 0), COALESCE(fs.frequency, 'monthly'), FALSE, 10, CURRENT_TIMESTAMP
                FROM fee_structures fs
                WHERE NOT EXISTS (
                    SELECT 1 FROM fee_items fi WHERE fi.fee_structure_id = fs.id
                )
            $q$;
        END IF;

        -- backfill student_fees.fee_item_id
        UPDATE student_fees sf
        SET fee_item_id = fi.id
        FROM fee_items fi
        WHERE sf.fee_item_id IS NULL AND fi.fee_structure_id = sf.fee_structure_id;
    END IF;
END $$;

-- 6) Payments alignment
ALTER TABLE IF EXISTS payments ADD COLUMN IF NOT EXISTS transaction_id VARCHAR(255);
ALTER TABLE IF EXISTS payments ADD COLUMN IF NOT EXISTS receipt_number VARCHAR(100);
ALTER TABLE IF EXISTS payments ADD COLUMN IF NOT EXISTS status VARCHAR(20);
ALTER TABLE IF EXISTS payments ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE IF EXISTS payments ADD COLUMN IF NOT EXISTS collected_by UUID;
ALTER TABLE IF EXISTS payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMP;

-- 7) Student grades alignment
ALTER TABLE IF EXISTS student_grades ADD COLUMN IF NOT EXISTS assessment_id UUID;
ALTER TABLE IF EXISTS student_grades ADD COLUMN IF NOT EXISTS marks_obtained DECIMAL(5,2);
ALTER TABLE IF EXISTS student_grades ADD COLUMN IF NOT EXISTS grade_letter VARCHAR(5);
ALTER TABLE IF EXISTS student_grades ADD COLUMN IF NOT EXISTS percentage DECIMAL(5,2);
ALTER TABLE IF EXISTS student_grades ADD COLUMN IF NOT EXISTS remarks TEXT;
ALTER TABLE IF EXISTS student_grades ADD COLUMN IF NOT EXISTS graded_by UUID;
ALTER TABLE IF EXISTS student_grades ADD COLUMN IF NOT EXISTS graded_at TIMESTAMP;
ALTER TABLE IF EXISTS student_grades ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;
