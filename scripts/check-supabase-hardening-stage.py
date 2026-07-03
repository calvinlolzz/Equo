from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "20260630003000_harden_legacy_rpc_surface.sql"
DOC = ROOT / "docs" / "supabase_hardening_stage.md"


REQUIRED = {
    MIGRATION: [
        "revoke execute on function %s from public",
        "revoke execute on function %s from anon",
        "revoke execute on function %s from authenticated",
        "grant execute on function %s to service_role",
        "alter function public.is_group_member(uuid) set search_path = public, pg_temp",
        "create policy app_error_logs_deny_all",
        "as restrictive",
        "using (false)",
        "create policy app_feedback_deny_all",
    ],
    DOC: [
        "cmfgptuzbayzdrxuoapm",
        "harden_legacy_rpc_surface",
        "SECURITY DEFINER",
        "service_role",
        "app_error_logs",
        "app_feedback",
        "auth_leaked_password_protection",
        "performance cleanup phase",
    ],
}


def main() -> int:
    failures: list[str] = []

    for path, fragments in REQUIRED.items():
        if not path.exists():
            failures.append(f"missing {path.relative_to(ROOT)}")
            continue

        text = path.read_text(encoding="utf-8")
        for fragment in fragments:
            if fragment not in text:
                failures.append(f"{path.relative_to(ROOT)} missing: {fragment}")

    if failures:
        print("FAIL: Supabase hardening stage incomplete")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("PASS: Supabase hardening stage verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
