-- The four live admin/support tables, given a migration of their own.
--
-- app_admins, admin_audit_logs, app_feedback and app_error_logs are in active
-- use (the admin console reads all four; the app writes feedback and error
-- reports). But they were never created by a migration - their only definition
-- lived in supabase/schema.sql, a file that otherwise describes an abandoned
-- prototype schema (expense_splits, recurring_bills, notifications,
-- user_snapshots, group_invites - all of which 20260711230000 dropped) and that
-- nothing in the codebase reads.
--
-- That made schema.sql impossible to delete without silently losing the only
-- record of four live tables, and impossible to trust as a description of the
-- database, since most of it describes tables that no longer exist. This
-- migration takes over the four that are real, so schema.sql can go.
--
-- Transcribed from the production database, not from schema.sql - the file and
-- the database had already been edited apart (app_feedback.status and its check
-- constraint, for one, arrived via the admin-console work and were never written
-- back). Every definition below was read out of pg_catalog on
-- cmfgptuzbayzdrxuoapm, so this is what actually exists.
--
-- Idempotent: these tables ALREADY EXIST in production. Applying this is a
-- no-op there, and it is what recreates them in a fresh database.
--
-- Note the FKs point at auth.users, not public.users - these tables predate the
-- MVP schema's own users table and were built against Supabase Auth directly.
-- Kept as-is: changing them is a data-migration question, not a bookkeeping one.

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('owner', 'admin', 'support')),
  created_at timestamptz not null default now()
);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references auth.users(id) on delete set null,
  admin_email text,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  type text not null default 'problem' check (type in ('problem', 'suggestion', 'confusing', 'other')),
  message text not null,
  contact text,
  page text,
  status text not null default 'new' check (status in ('new', 'reviewing', 'done')),
  created_at timestamptz not null default now()
);

create table if not exists public.app_error_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  source text not null default 'web' check (source in ('web', 'admin')),
  message text not null,
  context text,
  page text,
  created_at timestamptz not null default now()
);

-- RLS: the browser holds no Postgres role for any of this. Reads go through the
-- admin_console_* functions (service_role only); writes go through the API,
-- also as service_role. So feedback and error logs deny every direct client
-- role outright, and the two admin tables expose only the narrow self/admin
-- reads the console's own auth check relies on.

alter table public.app_admins enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.app_feedback enable row level security;
alter table public.app_error_logs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'app_admins' and policyname = 'app_admins_select_self'
  ) then
    create policy "app_admins_select_self" on public.app_admins
      for select using (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'admin_audit_logs' and policyname = 'admin_logs_select_admins'
  ) then
    create policy "admin_logs_select_admins" on public.admin_audit_logs
      for select using (exists (select 1 from public.app_admins where app_admins.user_id = auth.uid()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'app_feedback' and policyname = 'app_feedback_deny_all'
  ) then
    create policy "app_feedback_deny_all" on public.app_feedback
      for all to anon, authenticated using (false) with check (false);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'app_error_logs' and policyname = 'app_error_logs_deny_all'
  ) then
    create policy "app_error_logs_deny_all" on public.app_error_logs
      for all to anon, authenticated using (false) with check (false);
  end if;
end $$;
