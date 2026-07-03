# Equo MVP Production Readiness Stage

Date: 2026-06-30

This stage prepares the MVP for a hosted web deployment while keeping the local demo usable.

## Implemented

- Cookie-first API authentication.
  - `POST /api/v1/auth/google` returns an `HttpOnly` `equo_session` cookie.
  - API routes accept the `equo_session` cookie.
  - Bearer token support remains available for local development and manual testing.
- Browser API calls now use `credentials: "same-origin"`.
- Authorization headers are only sent when an Equo session token is available.
- Vercel request adapter forwards both `Authorization` and `Cookie` headers to the runtime.
- `.env.example` documents the required client and server runtime variables.

## Required Vercel Environment Variables

- `VITE_GOOGLE_OAUTH_CLIENT_ID`
  - Client-side Google Identity Services button.
  - Must match the server audience.
- `GOOGLE_OAUTH_CLIENT_ID`
  - Server-side Google ID token verification.
  - Must match the Google OAuth web client ID.
- `SESSION_SECRET`
  - Server-only secret for signing Equo session tokens.
  - Use a long random value per environment.
- `SUPABASE_URL`
  - Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`
  - Server-only Supabase service role key.
  - Never expose this in browser code.

## Google OAuth Checklist

- Add the production domain to Authorized JavaScript origins.
- Add the local review origin if needed, for example `http://127.0.0.1:14062`.
- Use a web client ID, not an Android or iOS client ID.
- Keep `VITE_GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_ID` identical unless a deliberate multi-client setup is added later.

## Deployment Checks

1. Configure Vercel env vars from `.env.example`.
2. Deploy the web app and API together so `/api/v1/*` is same-origin.
3. Open formal mode, sign in with Google, and confirm the browser receives `equo_session`.
4. Create a group without manually pasting a token.
5. Create an invite, add an expense, and calculate settlement.

## Current Limitation

The local Vite preview still keeps an Equo session token in `localStorage` as a development fallback. Production should rely on the `HttpOnly` cookie path for normal authenticated API calls.
