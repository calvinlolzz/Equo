from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


REQUIRED = {
    "apps/web/src/server/repositories/expenseRepository.ts": [
        "ExpenseRepository",
        "createExpense",
        "listExpenses",
        "softDeleteExpense",
        "expense_payments",
        "expense_shares",
        "client_request_id",
    ],
    "apps/web/src/server/repositories/supabaseExpenseRepository.ts": [
        "createSupabaseExpenseRepository",
        "validateCreateExpenseRequest",
        "insert into public.expenses",
        "insert into public.expense_payments",
        "insert into public.expense_shares",
        "recordClientRequest",
    ],
    "apps/web/src/server/repositories/settlementRepository.ts": [
        "SettlementRepository",
        "calculateCurrentSettlement",
        "confirmSettlement",
        "settlement_version",
        "calculated_version",
    ],
    "apps/web/src/server/repositories/supabaseSettlementRepository.ts": [
        "createSupabaseSettlementRepository",
        "calculateSettlement",
        "insert into public.settlements",
        "insert into public.settlement_transfers",
        "SETTLEMENT_VERSION_CONFLICT",
    ],
    "apps/web/src/server/routes/expenseRoutes.ts": [
        "createExpenseRoute",
        "deleteExpenseRoute",
        "validateCreateExpenseRequest",
    ],
    "apps/web/src/server/routes/settlementRoutes.ts": [
        "calculateSettlementRoute",
        "confirmSettlementRoute",
        "settlement_version",
    ],
    "apps/web/src/server/repositories/supabaseExpenseRepository.test.ts": [
        "writes expense, payments, and shares in order",
        "rejects invalid expense totals before writing",
        "records client_request_id after creating an expense",
    ],
    "apps/web/src/server/repositories/supabaseSettlementRepository.test.ts": [
        "persists calculated settlement transfers",
        "rejects confirmation when settlement_version differs",
    ],
    "docs/expenses_settlement_stage.md": [
        "# Equo MVP Expenses 與 Settlement Repository 階段",
        "expense_payments",
        "expense_shares",
        "settlement_version",
        "client_request_id",
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
        print("FAIL: expenses/settlement stage incomplete")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("PASS: expenses/settlement stage verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
