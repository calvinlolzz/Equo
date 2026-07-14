# Equo MVP Deployment

Date: 2026-07-01

This document describes the current MVP deployment path. Older static-only deployment notes have been replaced because the formal MVP now includes a Vercel API runtime and server-side Supabase access.

## Hosting Target

- Web host: Vercel
- Frontend build output: `apps/web/dist`
- API runtime: `api/v1/[...path].ts`
- Database: Supabase project `cmfgptuzbayzdrxuoapm`
- Auth: Google-only MVP with Equo server session cookie

## Vercel Build Settings

These are declared in `vercel.json`:

- Install command: `npm install`
- Build command: `npm run build`
- Output directory: `apps/web/dist`
- API path: `/api/v1/*` routes to `api/v1/[...path].ts`
- Static files and built assets are served from the filesystem before fallback.
- Frontend deep links such as `/group/:groupId` fallback to `/index.html` via the
  `rewrites` rule (which excludes `/api/` so API calls still reach the function).
- Security headers (`Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`) are applied to every response via the
  `headers` block. The CSP allowlists `self`, Supabase (`*.supabase.co`), and Google
  avatar hosts (`*.googleusercontent.com`); widen it there if a new external origin
  is introduced. Note: `headers` cannot be combined with the legacy `routes` key, which
  is why routing uses `rewrites`.

## Required Vercel Env Vars

Set these for both Preview and Production:

```text
VITE_GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_ID
SESSION_SECRET
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

`SUPABASE_SERVICE_ROLE_KEY` and `SESSION_SECRET` are server-only. Do not expose them as public client variables.

Current linked Vercel project status:

- Present: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SESSION_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `VITE_GOOGLE_OAUTH_CLIENT_ID`
- Production API smoke passes on `https://equo-mu.vercel.app`.

## Google OAuth Setup

Use a Google OAuth web client ID.

Authorized JavaScript origins should include:

- `https://equo-mu.vercel.app`
- The preview deployment URL used for launch testing.
- `http://127.0.0.1:14062` when local Google sign-in testing is needed.

`VITE_GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_ID` should be the same OAuth client ID for this MVP.

## Deployment Flow

1. Run local checks:

   ```powershell
   npm test
   npm run build
   Get-ChildItem scripts -Filter 'check-*.py' | ForEach-Object { python $_.FullName }
   ```

2. Deploy a Vercel preview.
3. Run the production smoke script against the preview:

   ```powershell
   $env:EQUO_BASE_URL="https://your-preview.vercel.app"
   python scripts\smoke-production-web.py
   python scripts\smoke-production-api.py
   ```

   If preview deployment protection is enabled, use the logged-in Vercel path instead:

   ```powershell
   vercel curl /api/v1/unknown --deployment "https://your-preview.vercel.app" -- --include
   ```

4. Sign in with Google in the preview and complete:
   - create group
   - create invite
   - add expense
   - calculate settlement

5. Promote the verified preview to production.

## Supabase Notes

The live project has already been upgraded for MVP compatibility and hardened:

- `mvp_live_compat`
- `mvp_live_rls_indexes`
- `harden_legacy_rpc_surface`

Security advisors currently only leave `auth_leaked_password_protection`, which is an Auth dashboard setting. Enable it before password auth is introduced. The MVP remains Google-only.
