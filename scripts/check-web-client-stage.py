from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


REQUIRED = {
    "apps/web/src/app/apiClient.ts": [
        "createApiClient",
        'credentials: "same-origin"',
        "createGroup",
        "createInvite",
        "createExpense",
        "calculateSettlement",
        "exchangeGoogleToken",
        "Authorization",
        "client_request_id",
    ],
    "apps/web/src/app/App.tsx": [
        "useState",
        "useEffect",
        "建立群組",
        "邀請成員",
        "新增支出",
        "清償債務",
        "authToken",
        "createApiClient",
        "Demo 模式",
        "VITE_GOOGLE_OAUTH_CLIENT_ID",
        "exchangeSupabaseToken",
        "/auth/v1/authorize",
        "登出",
    ],
    "apps/web/src/app/authSession.ts": [
        "loadAuthToken",
        "saveAuthToken",
        "clearAuthToken",
        "localStorage",
    ],
    "apps/web/src/vite-env.d.ts": [
        "VITE_GOOGLE_OAUTH_CLIENT_ID",
        "VITE_SUPABASE_URL",
    ],
    "docs/google_auth_stage.md": [
        "Google Identity Services",
        "VITE_GOOGLE_OAUTH_CLIENT_ID",
        "POST /api/v1/auth/google",
        "Equo session",
        "localStorage",
        "Sign out",
    ],
    "apps/web/src/app/App.css": [
        ".app-shell",
        "backdrop-filter",
        ".primary-action",
        ".glass-panel",
        "@media",
    ],
    "apps/web/src/main.tsx": [
        'import "./app/App.css"',
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
        print("FAIL: web client stage incomplete")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("PASS: web client stage verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
