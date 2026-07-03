# Equo MVP Google Auth Stage

Date: 2026-06-30

This stage adds the first production login path while preserving the local demo flow.

## Implemented

- Demo mode remains enabled by default for local review.
- Formal mode can be enabled by turning off Demo mode.
- Formal mode supports Google Identity Services.
  - Loads `https://accounts.google.com/gsi/client`.
  - Uses `google.accounts.id.initialize`.
  - Renders the Google sign-in button when `VITE_GOOGLE_OAUTH_CLIENT_ID` is configured.
- Manual ID token input remains available as a development fallback.
- Google ID token is exchanged through `POST /api/v1/auth/google`.
- The browser saves the signed Equo session token in `localStorage`.
- The API also returns an `HttpOnly` `equo_session` cookie for the same session.
- Sign out clears the saved token and disables Google auto-select.
- Existing API routes accept the Equo session token, with raw Google ID token fallback kept for development.

## Required Env For Real Login

- Client side: `VITE_GOOGLE_OAUTH_CLIENT_ID`
- Server side: `GOOGLE_OAUTH_CLIENT_ID`
- Server side: `SESSION_SECRET`

Both values should represent the same Google OAuth client audience so the server verifier accepts the ID token.

`SESSION_SECRET` signs Equo app sessions. It must be a long random server-only value.

## Current Limitation

The app still stores the returned Equo session token in `localStorage` so the static Vite demo can call the API without a same-origin server during local review. The production deployment should prefer the `HttpOnly` cookie path once the web host and API host are finalized.
