-- WORKBOARD DATABASE SETUP
-- Run this entire file once in Supabase:
-- Dashboard → SQL Editor → New query → paste → Run

create extension if not exists pgcrypto;

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  color text not null default '#8b6f65',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete restrict,
  employee_id uuid references public.employees(id) on delete set null,
  title text not null check (char_length(title) between 1 and 180),
  description text,
  status text not null default 'todo'
    check (status in ('backlog', 'todo', 'in_progress', 'review', 'done')),
  position integer not null default 0,
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists employees_owner_id_idx on public.employees(owner_id);
create index if not exists projects_owner_id_idx on public.projects(owner_id);
create index if not exists tasks_owner_id_idx on public.tasks(owner_id);
create index if not exists tasks_project_id_idx on public.tasks(project_id);
create index if not exists tasks_employee_id_idx on public.tasks(employee_id);

alter table public.employees enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;

-- Explicit grants: signed-out visitors get no table access.
revoke all on table public.employees from anon, authenticated;
revoke all on table public.projects from anon, authenticated;
revoke all on table public.tasks from anon, authenticated;

grant select, insert, update, delete on table public.employees to authenticated;
grant select, insert, update, delete on table public.projects to authenticated;
grant select, insert, update, delete on table public.tasks to authenticated;

-- Re-running this setup should not fail because of existing policy names.
drop policy if exists "employees_select_own" on public.employees;
drop policy if exists "employees_insert_own" on public.employees;
drop policy if exists "employees_update_own" on public.employees;
drop policy if exists "employees_delete_own" on public.employees;

create policy "employees_select_own"
on public.employees for select to authenticated
using ((select auth.uid()) = owner_id);

create policy "employees_insert_own"
on public.employees for insert to authenticated
with check ((select auth.uid()) = owner_id);

create policy "employees_update_own"
on public.employees for update to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "employees_delete_own"
on public.employees for delete to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists "projects_select_own" on public.projects;
drop policy if exists "projects_insert_own" on public.projects;
drop policy if exists "projects_update_own" on public.projects;
drop policy if exists "projects_delete_own" on public.projects;

create policy "projects_select_own"
on public.projects for select to authenticated
using ((select auth.uid()) = owner_id);

create policy "projects_insert_own"
on public.projects for insert to authenticated
with check ((select auth.uid()) = owner_id);

create policy "projects_update_own"
on public.projects for update to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "projects_delete_own"
on public.projects for delete to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists "tasks_select_own" on public.tasks;
drop policy if exists "tasks_insert_own" on public.tasks;
drop policy if exists "tasks_update_own" on public.tasks;
drop policy if exists "tasks_delete_own" on public.tasks;

create policy "tasks_select_own"
on public.tasks for select to authenticated
using ((select auth.uid()) = owner_id);

create policy "tasks_insert_own"
on public.tasks for insert to authenticated
with check (
  (select auth.uid()) = owner_id
  and exists (
    select 1 from public.projects p
    where p.id = project_id and p.owner_id = (select auth.uid())
  )
  and (
    employee_id is null or exists (
      select 1 from public.employees e
      where e.id = employee_id and e.owner_id = (select auth.uid())
    )
  )
);

create policy "tasks_update_own"
on public.tasks for update to authenticated
using ((select auth.uid()) = owner_id)
with check (
  (select auth.uid()) = owner_id
  and exists (
    select 1 from public.projects p
    where p.id = project_id and p.owner_id = (select auth.uid())
  )
  and (
    employee_id is null or exists (
      select 1 from public.employees e
      where e.id = employee_id and e.owner_id = (select auth.uid())
    )
  )
);

create policy "tasks_delete_own"
on public.tasks for delete to authenticated
using ((select auth.uid()) = owner_id);
