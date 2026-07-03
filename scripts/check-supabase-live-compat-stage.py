from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

MIGRATION = ROOT / "supabase" / "migrations" / "20260630001000_mvp_live_compat.sql"
REMEDIATION = ROOT / "supabase" / "migrations" / "20260630002000_mvp_live_rls_indexes.sql"
AUDIT = ROOT / "docs" / "supabase_live_schema_audit.md"


def require(path: Path, fragments: list[str]) -> list[str]:
    failures: list[str] = []
    if not path.exists():
        return [f"missing {path.relative_to(ROOT)}"]

    text = path.read_text(encoding="utf-8")
    for fragment in fragments:
        if fragment not in text:
            failures.append(f"{path.relative_to(ROOT)} missing: {fragment}")
    return failures


def main() -> int:
    failures: list[str] = []
    failures.extend(
        require(
            AUDIT,
            [
                "cmfgptuzbayzdrxuoapm",
                "舊版 prototype schema",
                "相容升級",
            ],
        )
    )
    failures.extend(
        require(
            MIGRATION,
            [
                "alter table public.groups add column if not exists currency",
                "alter table public.expenses add column if not exists amount_minor",
                "alter table public.expenses alter column amount drop not null",
                "create table if not exists public.expense_payments",
                "create table if not exists public.expense_shares",
                "create table if not exists public.client_requests",
                "create or replace view public.group_member_balances",
                "with (security_invoker = true)",
                "grant select on public.group_member_balances to authenticated",
            ],
        )
    )
    failures.extend(
        require(
            REMEDIATION,
            [
                'drop policy if exists "users_insert_authenticated" on public.users',
                "with check ((select auth.uid())::text = id::text)",
                'create policy "invites_select_group_member"',
                'create policy "settlement_transfers_select_group_member"',
                'create policy "audit_logs_insert_group_member"',
                "create index if not exists expense_payments_expense_id_idx",
                "create index if not exists settlement_transfers_settlement_id_idx",
            ],
        )
    )

    if failures:
        print("supabase live compat stage check failed:")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("supabase live compat stage check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
