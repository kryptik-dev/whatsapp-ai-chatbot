-- Enable the pgvector extension (run this once per database)
create extension if not exists vector;

-- Create the memories table
create table if not exists memories (
  id bigserial primary key,
  text text,
  embedding vector(768),
  pinned boolean default false,
  created_at timestamp with time zone default now()
);

-- Create vector search function for easy similarity search
create or replace function match_memories(
  query_embedding vector(768),
  match_threshold float,
  match_count int
)
returns table (
  id bigint,
  text text,
  embedding vector(768),
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
  order by memories.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- Create function to get pinned memories
create or replace function get_pinned_memories()
returns table (
  id bigint,
  text text,
  embedding vector(768)
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
  order by memories.created_at desc;
end;
$$; 