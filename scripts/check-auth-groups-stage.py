from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


REQUIRED = {
    "apps/web/src/server/auth/google.ts": [
        "GoogleIdentity",
        "google_sub",
        "email",
        "verifyGoogleIdToken",
        "Google-only",
    ],
    "apps/web/src/server/auth/session.ts": [
        "AuthenticatedContext",
        "requireAuthenticatedUser",
        "UNAUTHENTICATED",
    ],
    "apps/web/src/server/repositories/groupRepository.ts": [
        "createGroup",
        "createVirtualMember",
        "createInvite",
        "acceptInvite",
        "token_hash",
        "client_request_id",
    ],
    "apps/web/src/server/handlers/groups.ts": [
        "handleCreateGroup",
        "handleCreateInvite",
        "handleAcceptInvite",
        "requireGroupMember",
        "FORBIDDEN",
    ],
    "apps/web/src/server/handlers/groups.test.ts": [
        "creates a group with an owner member",
        "rejects invite creation when user is not a group member",
        "accepts invite and claims a virtual member",
    ],
    "docs/auth_groups_api_stage.md": [
        "# Equo MVP 登入與群組 API 階段",
        "Google-only",
        "groups",
        "group_members",
        "invites",
        "token_hash",
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
        print("FAIL: auth/groups stage incomplete")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("PASS: auth/groups stage verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
