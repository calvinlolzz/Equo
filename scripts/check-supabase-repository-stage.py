from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


REQUIRED = {
    "apps/web/src/server/repositories/supabaseGroupRepository.ts": [
        "SupabaseQueryClient",
        "createSupabaseGroupRepository",
        "upsertUserByGoogleIdentity",
        "createGroup",
        "createInvite",
        "acceptInvite",
        "recordClientRequest",
        "token_hash",
        "client_request_id",
    ],
    "apps/web/src/server/routes/groupRoutes.ts": [
        "createGroupRoute",
        "createInviteRoute",
        "acceptInviteRoute",
        "verifyGoogleIdToken",
        "requireAuthenticatedUser",
    ],
    "apps/web/src/server/repositories/supabaseGroupRepository.test.ts": [
        "writes group and owner member in order",
        "stores invite token_hash instead of token",
        "records client_request_id for idempotency",
    ],
    "supabase/migrations/20260630000000_mvp_core.sql": [
        "enable row level security",
        "grant select, insert",
        "client_requests",
        "to authenticated",
    ],
    "docs/supabase_repository_stage.md": [
        "# Equo MVP Supabase Repository 階段",
        "explicit grants",
        "RLS",
        "client_requests",
        "Google-only",
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
        lower_text = text.lower()
        for marker in markers:
            if marker.lower() not in lower_text:
                failures.append(f"{relative_path}: missing marker {marker!r}")

    if failures:
        print("FAIL: Supabase repository stage incomplete")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("PASS: Supabase repository stage verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
