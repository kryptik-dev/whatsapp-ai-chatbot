-- Enable the pgvector extension (run this once per database)
create extension if not exists vector;

-- Create the memories table
create table if not exists memories (
  id bigserial primary key,
  text text,
  embedding vector(3072),
  pinned boolean default false,
  user_id text,
  created_at timestamp with time zone default now()
);

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