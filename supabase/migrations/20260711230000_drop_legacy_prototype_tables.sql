-- DB cleanup: drop the 2026-06-10-era static-prototype tables that the
-- current MVP code never references (verified by grep across apps/web,
-- vercel-api, and api). Row counts at drop time: all zero except
-- group_invites (2 stale legacy invites; the live invite flow uses the
-- mvp_core `invites` table).
--
-- Deliberately KEPT:
-- * app_feedback / app_error_logs - reserved for the planned feedback and
--   error-reporting features.
-- * app_admins / admin_audit_logs - in active use by the admin console.
-- * profiles - still written on every login (avatar/display-name mirror).
-- * audit_logs - part of the mvp_core schema (empty but current-era).

drop table if exists public.expense_splits;
drop table if exists public.payment_records;
drop table if exists public.recurring_bills;
drop table if exists public.notifications;
drop table if exists public.settlement_statuses;
drop table if exists public.group_invites;

-- Clears the Supabase security advisor ERROR "security_definer_view": the
-- view should evaluate with the QUERYING role's permissions. Only the API
-- runtime (service_role, which bypasses RLS) reads it, so behaviour for the
-- app is unchanged while anon/authenticated can no longer piggyback on the
-- creator's privileges.
alter view public.group_member_balances set (security_invoker = true);
