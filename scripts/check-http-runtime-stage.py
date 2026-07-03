from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


REQUIRED = {
    "apps/web/src/server/http/httpTypes.ts": [
        "HttpRuntimeRequest",
        "HttpRuntimeResponse",
        "authorization",
        "getAuthToken",
        "equo_session",
        "json",
    ],
    "apps/web/src/server/http/jsonResponse.ts": [
        "jsonResponse",
        "errorResponse",
        "request_id",
    ],
    "apps/web/src/server/http/runtime.ts": [
        "createHttpRuntime",
        "POST /api/v1/auth/google",
        "POST /api/v1/groups",
        "POST /api/v1/groups/:groupId/invites",
        "POST /api/v1/invites/:token/accept",
        "POST /api/v1/groups/:groupId/expenses",
        "POST /api/v1/groups/:groupId/settlement/calculate",
        "POST /api/v1/groups/:groupId/settlement/:settlementId/confirm",
        "createGroupRoute",
        "createExpenseRoute",
        "calculateSettlementRoute",
    ],
    "apps/web/src/server/http/runtime.test.ts": [
        "routes group creation requests",
        "returns 404 for unknown API paths",
        "extracts bearer token for Google-only auth",
        "exchanges Google tokens for Equo sessions",
        "authorizes API routes from the Equo session cookie",
    ],
    "vercel-api/v1Handler.ts": [
        "createHttpRuntime",
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "GOOGLE_OAUTH_CLIENT_ID",
        "SESSION_SECRET",
        "cookie: headerValue(request.headers.cookie)",
    ],
    "api/v1/groups/[groupId]/archive.ts": [
        "handleV1Request",
    ],
    "docs/http_runtime_stage.md": [
        "# Equo MVP HTTP Runtime 階段",
        "POST /api/v1/groups",
        "Bearer",
        "equo_session",
        "Supabase client",
        "Vercel Function",
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
        print("FAIL: HTTP runtime stage incomplete")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("PASS: HTTP runtime stage verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
