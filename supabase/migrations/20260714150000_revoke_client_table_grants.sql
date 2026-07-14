-- Take the `anon` and `authenticated` roles off the tables entirely.
--
-- The app has one database client: this server, as service_role. The browser
-- carries no Postgres role - there is no @supabase/supabase-js in the frontend,
-- and Supabase is used only to run the OAuth redirect, whose access_token is
-- handed straight to our own /api/v1/auth/supabase and never used against
-- PostgREST. autoSync.ts already says as much ("RLS is locked down to
-- service-role-only", which is why the app polls instead of subscribing).
--
-- It was not true. Supabase grants the public schema to anon and authenticated
-- by default, and nothing had ever taken that back:
--
--   authenticated : SELECT, INSERT, UPDATE, TRUNCATE, REFERENCES, TRIGGER
--                   on all 17 tables - users, invites, app_admins,
--                   admin_audit_logs, expenses, groups, ... every one of them
--   anon          : TRUNCATE, REFERENCES, TRIGGER on the same 17
--
-- RLS was enabled everywhere, so the policies were the only thing holding the
-- line - and at least one of them does not hold it:
--
--   users_update_self : UPDATE on public.users where auth.uid() = users.id
--
-- users.deleted_at is the admin console's "disable user" flag. That policy lets
-- the disabled user PATCH their own row and clear it - un-banning themselves,
-- straight past the control. (Also TRUNCATE ignores RLS completely; PostgREST
-- exposes no TRUNCATE verb, so it was not reachable, but the grant had no
-- business existing.)
--
-- Not exploitable from the app as shipped: the anon key is not in the bundle
-- (the frontend only takes VITE_SUPABASE_URL), and PostgREST needs it. But that
-- is one careless commit away - publishing the anon key is the NORMAL Supabase
-- pattern - and the grants are what make it a hole rather than a non-event.
--
-- So the grants go. RLS and its policies stay, unused, as a second line: if a
-- client role is ever handed a table again, it still has to get past them.

revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
revoke all privileges on all functions in schema public from anon, authenticated;

-- The defaults are what put them there in the first place: without this, the
-- next `create table` in public silently hands anon and authenticated the whole
-- thing again.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- USAGE on the schema itself is left in place. It grants no access to anything
-- (every object inside is now unreachable for these roles) and PostgREST needs
-- to resolve the schema to answer, so removing it changes 401/403 into a
-- confusing 500 for anyone who tries.

-- service_role keeps everything - it is what the API connects as. Restated here
-- so a future reader can see the intended shape in one place rather than having
-- to reconstruct it from 20260701000000.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

alter default privileges in schema public
  grant usage, select on sequences to service_role;
