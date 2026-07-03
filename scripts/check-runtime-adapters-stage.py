from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


REQUIRED = {
    "apps/web/src/server/runtime/googleTokenVerifier.ts": [
        "createGoogleTokenVerifier",
        "https://oauth2.googleapis.com/tokeninfo",
        "email_verified",
        "auth_user_id",
        "Google-only",
    ],
    "apps/web/src/server/runtime/runtimeEnv.ts": [
        "RuntimeEnv",
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "GOOGLE_OAUTH_CLIENT_ID",
        "SESSION_SECRET",
        "readRuntimeEnv",
        "missingRuntimeEnv",
    ],
    "apps/web/src/server/runtime/supabaseQueryClient.ts": [
        "createSupabaseQueryClientAdapter",
        "SupabaseQueryExecutor",
        "createSupabaseRestQueryClient",
        "serviceRoleKey",
        "createUnavailableSupabaseQueryClient",
        "Supabase client adapter is not configured",
    ],
    "apps/web/src/server/runtime/runtimeAdapters.test.ts": [
        "rejects Google tokens with the wrong audience",
        "maps Google tokeninfo into GoogleIdentity",
        "reports missing Supabase runtime env",
        "creates groups through Supabase REST with service role headers",
    ],
    "vercel-api/v1Handler.ts": [
        "readRuntimeEnv",
        "missingRuntimeEnv",
        "createGoogleTokenVerifier",
        "createSupabaseRestQueryClient",
        "SESSION_SECRET",
        "503",
    ],
    "docs/runtime_adapters_stage.md": [
        "# Equo MVP Runtime Adapters",
        "Google tokeninfo",
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "GOOGLE_OAUTH_CLIENT_ID",
        "SESSION_SECRET",
        "POST /api/v1/auth/google",
        "Equo session",
        "Supabase REST query client",
        "Does not expose a generic SQL executor",
        "503",
    ],
}


def main() -> int:
    failures: list[str] = []

    for relative_path, markers in REQUIRED.items():
        path = ROOT / relative_path
        if not path.exists():
            failures.append(f"missing {relative_path}")
            continue

        text = path.read_text(encoding="utf-8")
        for marker in markers:
            if marker not in text:
                failures.append(f"{relative_path}: missing marker {marker!r}")

    if failures:
        print("FAIL: runtime adapters stage incomplete")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("PASS: runtime adapters stage verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
