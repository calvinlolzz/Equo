from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


REQUIRED = {
    ".env.example": [
        "VITE_GOOGLE_OAUTH_CLIENT_ID",
        "GOOGLE_OAUTH_CLIENT_ID",
        "SESSION_SECRET",
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
    ],
    ".gitignore": [
        ".env.*",
        "!.env.example",
    ],
    "apps/web/src/app/apiClient.ts": [
        'credentials: "same-origin"',
        "headers.Authorization",
        "authToken.trim()",
    ],
    "apps/web/src/app/apiClient.test.ts": [
        "uses same-origin credentials and omits Authorization when no token is present",
    ],
    "apps/web/src/server/http/httpTypes.ts": [
        "getCookieValue",
        "getAuthToken",
        "equo_session",
    ],
    "apps/web/src/server/http/runtime.test.ts": [
        "authorizes API routes from the Equo session cookie",
    ],
    "vercel-api/v1Handler.ts": [
        "cookie: headerValue(request.headers.cookie)",
        "Cookie: headerValue(request.headers.Cookie)",
    ],
    "docs/production_readiness_stage.md": [
        "Cookie-first API authentication",
        "Required Vercel Environment Variables",
        "Google OAuth Checklist",
        "SUPABASE_SERVICE_ROLE_KEY",
        "HttpOnly",
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
        print("FAIL: production readiness stage incomplete")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("PASS: production readiness stage verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
