-- Add rating column to teachers table
ALTER TABLE teachers
ADD COLUMN IF NOT EXISTS rating DECIMAL(3, 1) DEFAULT 0.0;

-- Ensure it is within valid range (0.0 to 5.0)
ALTER TABLE teachers
ADD CONSTRAINT check_rating_range CHECK (rating >= 0.0 AND rating <= 5.0);
