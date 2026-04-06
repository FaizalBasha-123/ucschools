-- Inventory defaults and indexes (tenant schema)

ALTER TABLE IF EXISTS inventory_items
    ALTER COLUMN last_updated SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE IF EXISTS inventory_items
    ALTER COLUMN status SET DEFAULT 'in-stock';

CREATE INDEX IF NOT EXISTS idx_inventory_items_school_id
    ON inventory_items (school_id);

CREATE INDEX IF NOT EXISTS idx_inventory_items_school_category
    ON inventory_items (school_id, category);