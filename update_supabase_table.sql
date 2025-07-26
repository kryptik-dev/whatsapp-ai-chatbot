-- Update existing memories table to add pinned column and created_at
-- Run this in your Supabase SQL editor

-- Add pinned column (defaults to false)
ALTER TABLE memories ADD COLUMN IF NOT EXISTS pinned BOOLEAN DEFAULT false;

-- Add created_at column (defaults to now)
ALTER TABLE memories ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now();

-- Update existing records to have created_at if they don't have it
UPDATE memories SET created_at = now() WHERE created_at IS NULL;

-- Add user_id column to existing memories table
ALTER TABLE memories ADD COLUMN IF NOT EXISTS user_id text;

-- Update existing memories to have a default user_id (you can change this to a specific user)
UPDATE memories SET user_id = 'default_user' WHERE user_id IS NULL;

-- Create vector search function for easy similarity search (user-specific)
create or replace function match_memories_for_user(
  query_embedding vector(3072),
  user_id_param text,
  match_threshold float,
  match_count int
)
returns table (
  id bigint,
  text text,
  embedding vector(3072),
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    memories.id,
    memories.text,
    memories.embedding,
    1 - (memories.embedding <=> query_embedding) as similarity
  from memories
  where 1 - (memories.embedding <=> query_embedding) > match_threshold
    and memories.user_id = user_id_param
  order by memories.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- Create function to get pinned memories for specific user
create or replace function get_pinned_memories_for_user(user_id_param text)
returns table (
  id bigint,
  text text,
  embedding vector(3072)
)
language plpgsql
as $$
begin
  return query
  select
    memories.id,
    memories.text,
    memories.embedding
  from memories
  where memories.pinned = true
    and memories.user_id = user_id_param
  order by memories.created_at desc;
end;
$$; 