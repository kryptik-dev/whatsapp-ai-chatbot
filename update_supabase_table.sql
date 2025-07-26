-- Update existing memories table to add pinned column and created_at
-- Run this in your Supabase SQL editor

-- Add pinned column (defaults to false)
ALTER TABLE memories ADD COLUMN IF NOT EXISTS pinned BOOLEAN DEFAULT false;

-- Add created_at column (defaults to now)
ALTER TABLE memories ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now();

-- Update existing records to have created_at if they don't have it
UPDATE memories SET created_at = now() WHERE created_at IS NULL;

-- Create the get_pinned_memories function if it doesn't exist
CREATE OR REPLACE FUNCTION get_pinned_memories()
RETURNS TABLE (
  id bigint,
  text text,
  embedding vector(768)
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    memories.id,
    memories.text,
    memories.embedding
  FROM memories
  WHERE memories.pinned = true
  ORDER BY memories.created_at DESC;
END;
$$; 