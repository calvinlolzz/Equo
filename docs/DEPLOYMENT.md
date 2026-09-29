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

Set these for both Preview and Production.

Server-side — the API returns 503 `RUNTIME_ENV_MISSING` unless **all five** are present
(see `apps/web/src/server/runtime/runtimeEnv.ts`):

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
GOOGLE_OAUTH_CLIENT_ID
SESSION_SECRET
```

Frontend build — just the one (without it the login button is dead):

```text
VITE_SUPABASE_URL
```

LINE bot (optional; all absent = the webhook answers 503 `LINE_NOT_CONFIGURED` and nothing else is affected). It is its own function, `api/line/webhook.ts`, outside `/api/v1` so `vercel.json` needs no change. Production only:

```text
LINE_CHANNEL_SECRET
LINE_CHANNEL_ACCESS_TOKEN
APP_ORIGIN              (optional, defaults to https://equo-mu.vercel.app)
VITE_LINE_OA_URL        (build-time; the add-friend link: profile row, ledger-home hint, landing link.
                         Unset or not https://lin.ee/ or https://line.me/ hides all three silently)
```

Setup, kill switch and checklist: `docs/OPERATIONS.md` section 18.

`SUPABASE_SERVICE_ROLE_KEY` and `SESSION_SECRET` are server-only. Do not expose them as public client variables. `SUPABASE_ANON_KEY` is **also server-only** here — it is the apikey used to verify Supabase access tokens; the frontend holds no Supabase key at all. See `docs/SUPABASE.md` for the details.

> This list previously omitted `SUPABASE_ANON_KEY` and `VITE_SUPABASE_URL` (following it
> literally produced a permanently-503 deployment) and required `VITE_GOOGLE_OAUTH_CLIENT_ID`,
> which no frontend code reads — the Google client ID lives in Supabase's provider config.
> Corrected 2026-07-16 against `runtimeEnv.ts` and a repo-wide `import.meta.env` grep.

Current linked Vercel project status:

- Present: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SESSION_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `VITE_GOOGLE_OAUTH_CLIENT_ID`
- Production API smoke passes on `https://equo-mu.vercel.app`.

## Google OAuth Setup

Use a Google OAuth web client ID. The setting that matters is the **Authorized redirect URI**, which must be Supabase's callback:

```text
https://cmfgptuzbayzdrxuoapm.supabase.co/auth/v1/callback
```

**Authorized JavaScript origins are not needed.** They were a requirement of the abandoned GIS flow (browser talks to Google directly). The shipped flow is a full-page redirect to Supabase, which talks to Google server-side — the browser never loads Google's JS SDK. Harmless if already set; just don't blame a broken login on them. See `docs/OAUTH.md`.

`GOOGLE_OAUTH_CLIENT_ID` (server-side) is the one that matters. `VITE_GOOGLE_OAUTH_CLIENT_ID` is still set on the project but is vestigial — no frontend code reads it, and the browser never sends a client ID: `buildAuthorizeUrl` only needs `VITE_SUPABASE_URL`, and Google's client ID is configured inside Supabase's own auth provider settings.

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
