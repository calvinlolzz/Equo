# Equo MVP Runtime Adapters

Date: 2026-06-30

This stage connects the formal HTTP API runtime to production-facing adapters.

## Implemented

- Google-only token verification through Google tokeninfo.
  - Verifies `aud` against `GOOGLE_OAUTH_CLIENT_ID`.
  - Requires `email_verified`.
  - Maps Google profile data into `GoogleIdentity`.
- Runtime env guard.
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `GOOGLE_OAUTH_CLIENT_ID`
  - `SESSION_SECRET`
- Equo session exchange.
  - `POST /api/v1/auth/google` verifies a Google ID token.
  - The server signs an Equo session token.
  - Existing API routes accept the Equo session token.
- Supabase REST query client.
  - Uses service-role headers only inside server runtime.
  - Supports fixed MVP repository operations.
  - Does not expose a generic SQL executor.
- Vercel API entrypoint.
  - Returns `503` when required env vars are missing.
  - Creates the HTTP runtime with Google verifier, Equo session signing, and Supabase REST adapter.

## Security Notes

- `SUPABASE_SERVICE_ROLE_KEY` must stay server-only. Never expose it to browser code or `NEXT_PUBLIC_*` env vars.
- `SESSION_SECRET` must stay server-only and should be generated as a long random value per environment.
- The adapter intentionally maps known repository SQL fragments to REST calls. This keeps the MVP moving without adding an unsafe arbitrary SQL RPC endpoint.
- The live Supabase schema still contains prototype-era functions and policies. Those should be cleaned in a separate database hardening phase.

## Current Limitation

The adapter is a compatibility bridge, not the final data access design. If repository SQL changes, the adapter mapping must be updated with it.

## Next Stage

1. Replace the SQL-fragment adapter with explicit repository methods or dedicated database RPC functions for larger production use.
2. Move production web auth toward cookie-first requests once the web and API origins are fixed.
3. Clean up prototype-era database functions and policies in a separate hardening phase.
