from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


REQUIRED_FILES = {
    "package.json": ["workspaces", "apps/web"],
    "apps/web/package.json": ["equo-web", "scripts", "test"],
    "apps/web/index.html": ["Equo", "root"],
    "apps/web/src/main.tsx": ["MVP App Shell", 'import "./app/App.css"', "<App />"],
    "apps/web/src/app/App.tsx": ["建立群組", "client_request_id", "清償債務"],
    "apps/web/src/domain/money.ts": ["Money", "amount_minor", "assertSameCurrency"],
    "apps/web/src/domain/settlement.ts": ["calculateSettlement", "SettlementTransfer"],
    "apps/web/src/contracts/api.ts": ["/api/v1/groups", "/api/v1/groups/:groupId/expenses", "client_request_id"],
    "apps/web/src/contracts/errors.ts": ["EXPENSE_SHARE_TOTAL_MISMATCH", "SETTLEMENT_VERSION_CONFLICT"],
    "apps/web/src/domain/settlement.test.ts": ["calculates minimal transfers", "throws when currencies differ"],
    "supabase/migrations/20260630000000_mvp_core.sql": [
        "expense_payments",
        "expense_shares",
        "client_request_id",
        "settlement_version",
        "token_hash",
    ],
    "docs/mvp_scaffold_handoff.md": ["# Equo MVP 骨架交接", "apps/web", "supabase/migrations"],
}


def main() -> int:
    failures: list[str] = []

    for relative_path, markers in REQUIRED_FILES.items():
        path = ROOT / relative_path
        if not path.exists():
            failures.append(f"missing {relative_path}")
            continue

        text = path.read_text(encoding="utf-8")
        for marker in markers:
            if marker not in text:
                failures.append(f"{relative_path}: missing marker {marker!r}")

    if failures:
        print("FAIL: MVP scaffold incomplete")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("PASS: MVP scaffold verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
