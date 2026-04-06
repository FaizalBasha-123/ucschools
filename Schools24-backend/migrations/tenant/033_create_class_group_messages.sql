-- Class group messages for teacher/student communication within a class.
CREATE TABLE IF NOT EXISTS class_group_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_class_group_messages_class_created
    ON class_group_messages(class_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_class_group_messages_sender
    ON class_group_messages(sender_id);

