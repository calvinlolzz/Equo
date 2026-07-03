# Supabase Live Schema Audit

Project: Equo (`cmfgptuzbayzdrxuoapm`)

Date: 2026-06-30

## Result

The live Supabase project already contains the older prototype schema. In product terms, this is the 舊版 prototype schema:

- `profiles`
- `groups`
- `group_members`
- `group_invites`
- `expenses`
- `settlements`

This means the clean MVP migration cannot be applied directly. Several tables already exist with different required columns and constraints. Applying only `create table if not exists` would leave the database in a mixed state.

## Key Differences

- `groups` currently uses `base_currency` and `owner_id`; MVP code expects `currency` and `owner_member_id`.
- `group_members.role` currently allows prototype roles (`admin`, `parent`, `child`, `member`, `guest`); MVP code needs `owner` as well.
- `expenses` currently uses single-payer fields (`amount`, `payer_id`, `created_by`); MVP code writes `amount_minor`, `kind`, `client_request_id`, `created_by_member_id`, plus child rows in `expense_payments` and `expense_shares`.
- `settlements` currently stores one transfer per row; MVP code stores a settlement batch plus `settlement_transfers`.
- Missing MVP tables include `users`, `invites`, `expense_payments`, `expense_shares`, `client_requests`, `audit_logs`, and `settlement_transfers`.
- Missing MVP view: `group_member_balances`.

## Decision

Use a compatibility upgrade instead of replacing the database. In implementation terms, this is a 相容升級:

- Preserve existing tables and data.
- Add MVP columns with safe defaults or nullable compatibility where old rows already exist.
- Relax old required columns that would block new MVP inserts.
- Create missing MVP child tables and balance view.
- Keep Row Level Security enabled and grant authenticated access only where needed.

This is the safest path for continuing implementation because it avoids deleting prototype data while making the live project usable by the formal MVP backend.

## 2026-07-01 Hardening Update

The prototype-era schema also exposed several `SECURITY DEFINER` RPC functions to browser roles. The MVP runtime does not use those RPC functions directly, so the follow-up migration `harden_legacy_rpc_surface` now:

- Revokes `EXECUTE` from `public`, `anon`, and `authenticated` for the legacy RPC surface.
- Grants those functions only to `service_role`.
- Fixes `public.is_group_member(uuid)` with an explicit `search_path`.
- Adds restrictive deny-all policies to `app_error_logs` and `app_feedback`.

After this migration, Supabase security advisors only report `auth_leaked_password_protection`, which is an Auth dashboard setting rather than a database migration.
