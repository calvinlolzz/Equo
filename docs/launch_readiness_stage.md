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

- `VITE_SUPABASE_URL`
- `SESSION_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Do not configure `SUPABASE_SERVICE_ROLE_KEY` as a public or client-side variable.

`VITE_GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_ID` were used by the old Google Identity Services (GIS) button flow, which is retired (see Login Wall below). They can remain configured harmlessly but are no longer read by the client.

## Login Wall

As of 2026-07-04 the app requires a hard, Pizo-style login wall: with no valid session, the only screen is `LoginScreen` (Google via Supabase OAuth redirect; Apple is a disabled placeholder). There is no guest mode, no `稍後再說`, and no local-only groups. Once logged in, the user sees the familiar create/join/continue start flow. Both the login wall copy and the start flow copy ship in the same SPA bundle (the guard below checks for both).

Sign-in mechanism: the client redirects to `${VITE_SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=<origin>`. Supabase completes the Google consent flow and redirects back with `#access_token=...` in the URL fragment (implicit flow, no PKCE). The app exchanges that token via `POST /api/v1/auth/supabase` for an Equo session, exactly like the previous Google-button flow. The prior GIS button flow (`apps/web/src/app/googleIdentity.ts`) has been removed; its production origin misconfiguration was the reason for abandoning it.

## Production Smoke Test

Before deploying, run the local built-home guard after `npm run build`:

```powershell
python scripts\check-built-web-home.py
```

This reads `apps/web/dist/index.html` and bundled assets. It fails if the built bundle is missing the login wall copy (`使用 Google 登入`) or the create/join/continue flow copy (`建立群組`, `加入群組`, `繼續使用`) that renders after login.

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

- `/` returns the app shell. The bundle contains both the login wall copy (`使用 Google 登入`) and the post-login create/join/continue copy (`建立群組`, `加入群組`, `繼續使用`), since they ship in the same SPA bundle.
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
4. run `scripts/smoke-production-web.py` against the preview and confirm the bundle still contains both the login wall and the create/join/continue flow
5. run `scripts/smoke-production-api.py` against the preview
6. complete one browser flow: Google sign-in through the login wall (Supabase OAuth redirect), create group, invite, expense, settlement
7. promote the verified preview to production
