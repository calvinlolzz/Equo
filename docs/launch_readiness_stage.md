# Equo MVP Launch Readiness Stage

Date: 2026-07-01

This stage turns the final deployment checks into versioned project artifacts.

## Vercel Project Settings

The repository now declares the important Vercel build settings in `vercel.json`:

- `installCommand`: `npm install`
- `buildCommand`: `npm run build`
- `outputDirectory`: `apps/web/dist`
- SPA fallback rewrite: non-API routes go to `/index.html`
- API routes remain under `/api/v1/*`

## Required Environment Variables

Configure these in Vercel for Production and Preview:

- `VITE_GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_ID`
- `SESSION_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Do not configure `SUPABASE_SERVICE_ROLE_KEY` as a public or client-side variable.

## Google OAuth Origins

Before production launch, add these to the Google OAuth web client:

- Production origin, for example `https://your-domain.com`
- Vercel preview origin pattern or the exact preview URL used for testing
- Local review origin if needed: `http://127.0.0.1:14062`

The OAuth client ID must match both `VITE_GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_ID`.

## Production Smoke Test

Before deploying, run the local built-home guard after `npm run build`:

```powershell
python scripts\check-built-web-home.py
```

This reads `apps/web/dist/index.html` and bundled assets. It fails if the built homepage no longer contains `建立群組`, `加入群組`, and `繼續使用`, or if those controls are replaced by the standalone login gate copy.

After deploying, run:

```powershell
$env:EQUO_BASE_URL="https://your-deployment.vercel.app"
python scripts\smoke-production-web.py
python scripts\smoke-production-api.py
```

For the full Google session exchange check, provide a short-lived Google ID token:

```powershell
$env:EQUO_GOOGLE_ID_TOKEN="paste-token-here"
python scripts\smoke-production-api.py
```

Expected result:

- `/` returns the app shell and the bundled home experience still contains `建立群組`, `加入群組`, and `繼續使用`.
- `/` must not be replaced by the login gate copy `使用 Equo`, `使用 Google 登入`, or `使用 Apple 登入`.
- `/group/smoke-test` returns the app shell, proving direct group links use the SPA fallback.
- `/api/v1/unknown` returns `404`, proving server runtime env is configured.
- `/api/v1/auth/google` returns `200` and `equo_session` when a valid Google ID token is supplied.

If the Vercel preview deployment is protected by SSO, direct `curl` and the smoke script may receive the Vercel login redirect instead of the app response. Use the authenticated Vercel check during preview validation:

```powershell
vercel curl /api/v1/unknown --deployment "https://your-preview.vercel.app" -- --include
```

Current Vercel env status after the deployment wiring pass:

- Configured: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SESSION_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `VITE_GOOGLE_OAUTH_CLIENT_ID`
- Production API smoke passes on `https://equo-mu.vercel.app`.

## Supabase Status

Security advisors were rechecked after hardening. The only remaining security item is:

- `auth_leaked_password_protection`

That setting belongs in the Supabase Auth dashboard. It should be enabled before password auth is ever introduced. The MVP remains Google-only.

Performance advisors still include older prototype schema items. Treat those as a separate performance cleanup phase, not a launch blocker for the server-side MVP API.

## Launch Gate

Before promoting to production:

1. `npm run verify:release`
2. all remaining `scripts/check-*.py` that are not covered by `verify:release`
3. deploy preview
4. run `scripts/smoke-production-web.py` against the preview and confirm the homepage is still the create/join/continue flow
5. run `scripts/smoke-production-api.py` against the preview
6. complete one browser flow: Google sign-in from profile, create group, invite, expense, settlement
7. promote the verified preview to production
