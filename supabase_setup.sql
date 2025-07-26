-- Enable the pgvector extension (run this once per database)
create extension if not exists vector;

-- Create the memories table
create table if not exists memories (
  id bigserial primary key,
  text text,
  embedding vector(3072) -- Change 3072 to 768 or 1536 if you use a different embedding size
);

-- Create vector search function for easy similarity search
create or replace function match_memories(
  query_embedding vector(3072),
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
  order by memories.embedding <=> query_embedding
  limit match_count;
end;
$$; 