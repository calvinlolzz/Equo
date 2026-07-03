# Equo Stage 6 上線前收尾

Date: 2026-07-02

## Scope

This stage closes the launch gate after the Pizo-style interaction pass:

- Keep the production runtime checks aligned with the current Vercel handler layout.
- Keep the web-client checks aligned with the current Supabase OAuth login flow.
- Verify scripts, tests, build, production API smoke, and production page loading.

## Adjustments

- Runtime readiness checks now inspect `vercel-api/v1Handler.ts`, where the shared Vercel API runtime is implemented.
- Web-client readiness checks now expect the Supabase OAuth redirect flow and `exchangeSupabaseToken`.
- Legacy check markers for direct Google Identity Services rendering were removed from the gate because the production UI now starts Google login through Supabase OAuth.
- Legacy `計算結清` markers were updated to the current UI language: `清償債務`.

## Verification Evidence

- All `scripts/check-*.py`: passed.
- `npm test`: passed, 24 files and 79 tests.
- `npm run build`: passed.
- `scripts/smoke-production-api.py` against `https://equo-mu.vercel.app`: passed.
- Production page load check: `https://equo-mu.vercel.app` returned `200`.
- Browser production load check: page loaded and showed the Google login entry.

## Manual Gate Remaining

The full authenticated production flow still requires a real user login session:

1. Sign in with Google.
2. Create a group.
3. Invite a member or create a virtual member.
4. Add an expense.
5. Calculate and confirm settlement.

The API smoke script also supports a deeper login exchange check if a short-lived `EQUO_GOOGLE_ID_TOKEN` is provided.
