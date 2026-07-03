from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


REQUIRED = {
    "supabase/migrations/20260630000000_mvp_core.sql": [
        "create or replace view public.group_member_balances",
        "security_invoker = true",
        "expense_payments",
        "expense_shares",
        "balance_minor",
        "grant select on public.group_member_balances to authenticated",
    ],
    "apps/web/src/server/repositories/supabaseSettlementRepository.ts": [
        "from public.group_member_balances",
        "balance_minor",
        "calculateSettlement",
    ],
    "docs/balance_view_stage.md": [
        "# Equo MVP Balance View 階段",
        "group_member_balances",
        "security_invoker",
        "expense_payments",
        "expense_shares",
        "balance_minor",
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
        print("FAIL: balance view stage incomplete")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("PASS: balance view stage verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
