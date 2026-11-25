-- Nate PM · Neon Postgres schema
-- Run with: npm run db:migrate

create table if not exists projects (
  id bigserial primary key,
  github_id bigint unique,
  full_name text unique not null,
  owner_login text,
  name text not null,
  description text,
  html_url text,
  homepage text,
  language text,
  stars integer not null default 0,
  forks integer not null default 0,
  open_issues integer not null default 0,
  is_private boolean not null default false,
  is_fork boolean not null default false,
  is_archived boolean not null default false,
  is_deleted boolean not null default false,
  relation text not null default 'ownership' check (relation in ('ownership', 'contribute')),
  relation_source text not null default 'auto' check (relation_source in ('auto', 'manual')),
  status text not null default 'active' check (status in ('planning', 'active', 'paused', 'done')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  visible boolean not null default true,
  sort_order integer not null default 0,
  last_commit_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_public_idx
  on projects (visible, is_private, is_deleted, relation, status);

create index if not exists projects_last_commit_idx
  on projects (last_commit_at desc);

create table if not exists tasks (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  title text not null,
  status text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  due_date date,
  notes text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists tasks_project_idx on tasks (project_id, status, created_at);

create table if not exists notes (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  body_md text not null,
  created_at timestamptz not null default now()
);

create index if not exists notes_project_idx on notes (project_id, created_at desc);

create table if not exists commits (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  sha text not null,
  message text,
  author_name text,
  author_login text,
  committed_at timestamptz,
  html_url text,
  unique (project_id, sha)
);

create index if not exists commits_project_idx on commits (project_id, committed_at desc);

create table if not exists sync_runs (
  id bigserial primary key,
  source text not null default 'manual',
  status text not null default 'running' check (status in ('running', 'ok', 'error')),
  repos integer not null default 0,
  commits integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists login_attempts (
  id bigserial primary key,
  ip text not null,
  at timestamptz not null default now()
);

create index if not exists login_attempts_ip_idx on login_attempts (ip, at desc);
