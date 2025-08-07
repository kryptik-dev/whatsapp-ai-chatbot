-- Create tasks table for Miles assistant
CREATE TABLE IF NOT EXISTS tasks (
    id BIGSERIAL PRIMARY KEY,
    phone_number TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    due_date DATE,
    priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    category TEXT DEFAULT 'other' CHECK (category IN ('work', 'personal', 'school', 'health', 'other')),
    completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_tasks_phone_number ON tasks(phone_number);
CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completed);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);

-- Create RLS (Row Level Security) policies
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Policy to allow all operations (you can restrict this later if needed)
CREATE POLICY "Allow all operations on tasks" ON tasks
    FOR ALL USING (true);

-- Function to create table if it doesn't exist (for the RPC call)
CREATE OR REPLACE FUNCTION create_tasks_table_if_not_exists()
RETURNS void AS $$
BEGIN
    -- This function is just a placeholder since we create the table with IF NOT EXISTS
    -- The table creation is handled by the SQL above
    RETURN;
END;
$$ LANGUAGE plpgsql;
