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

-- Create the tasks table
create table if not exists tasks (
  id bigserial primary key,
  title text not null,
  description text,
  due_date timestamp with time zone,
  completed boolean default false,
  priority text check (priority in ('low', 'medium', 'high')) default 'medium',
  user_id text not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Create index for efficient task queries
create index if not exists idx_tasks_user_id on tasks(user_id);
create index if not exists idx_tasks_due_date on tasks(due_date);
create index if not exists idx_tasks_completed on tasks(completed);

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

-- Create function to get tasks for specific user
create or replace function get_tasks_for_user(user_id_param text, include_completed boolean default false)
returns table (
  id bigint,
  title text,
  description text,
  due_date timestamp with time zone,
  completed boolean,
  priority text,
  created_at timestamp with time zone
)
language plpgsql
as $$
begin
  return query
  select
    tasks.id,
    tasks.title,
    tasks.description,
    tasks.due_date,
    tasks.completed,
    tasks.priority,
    tasks.created_at
  from tasks
  where tasks.user_id = user_id_param
    and (include_completed or not tasks.completed)
  order by 
    case when tasks.due_date is not null then 0 else 1 end,
    tasks.due_date asc,
    case tasks.priority 
      when 'high' then 0 
      when 'medium' then 1 
      when 'low' then 2 
    end,
    tasks.created_at desc;
end;
$$;

-- Create function to get overdue tasks for specific user
create or replace function get_overdue_tasks_for_user(user_id_param text)
returns table (
  id bigint,
  title text,
  description text,
  due_date timestamp with time zone,
  priority text,
  days_overdue integer
)
language plpgsql
as $$
begin
  return query
  select
    tasks.id,
    tasks.title,
    tasks.description,
    tasks.due_date,
    tasks.priority,
    extract(day from (now() - tasks.due_date))::integer as days_overdue
  from tasks
  where tasks.user_id = user_id_param
    and tasks.completed = false
    and tasks.due_date < now()
  order by tasks.due_date asc;
end;
$$; 