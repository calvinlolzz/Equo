# Equo MVP Supabase Hardening Stage

Date: 2026-07-01

Project: Equo (`cmfgptuzbayzdrxuoapm`)

## What Changed

This stage reduces the public attack surface left by the older prototype schema while preserving existing data.

## Migration

Local migration:

- `supabase/migrations/20260630003000_harden_legacy_rpc_surface.sql`

Remote migration applied through Supabase MCP:

- `harden_legacy_rpc_surface`

## Hardened Surfaces

- Revoked `EXECUTE` from `public`, `anon`, and `authenticated` for prototype-era `SECURITY DEFINER` RPC functions.
- Granted those RPC functions only to `service_role`.
- Set a fixed `search_path` for `public.is_group_member(uuid)`.
- Added restrictive deny-all policies for:
  - `public.app_error_logs`
  - `public.app_feedback`

## Verification Evidence

After the migration, Supabase security advisors no longer report:

- `rls_enabled_no_policy` for `app_error_logs`
- `rls_enabled_no_policy` for `app_feedback`
- `function_search_path_mutable` for `is_group_member`
- anon/authenticated executable `SECURITY DEFINER` function warnings for the hardened prototype RPC surface

The remaining security advisor item is:

- `auth_leaked_password_protection`

That remaining item is an Auth dashboard configuration, not a database migration. Equo MVP currently uses Google-only auth, but the setting should still be enabled before password auth is introduced.

## Why This Is Safe

The formal MVP API runtime uses server-side Supabase access through `api/v1/[...path].ts` and `SUPABASE_SERVICE_ROLE_KEY`. The legacy RPC functions are not part of the new MVP API contract, so browser roles should not be able to execute them directly through `/rest/v1/rpc/*`.

## Remaining Database Work

- Performance advisors still include older prototype tables, unindexed foreign keys, and RLS init-plan warnings.
- Those are not direct public access issues, so they should be handled in a separate performance cleanup phase.
- Do not remove unused indexes yet; the MVP has not accumulated enough production query history for that signal to be reliable.
