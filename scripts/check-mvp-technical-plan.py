from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLAN = ROOT / "docs" / "mvp_technical_plan.md"

REQUIRED = {
    "title": "# Equo MVP 技術規劃",
    "scope": "## 1. MVP 範圍",
    "architecture": "## 2. 系統架構",
    "auth": "## 3. 登入與身份",
    "permissions": "## 4. 權限模型",
    "data model": "## 5. 資料模型",
    "api": "## 6. API 規劃",
    "expense flow": "## 7. 支出與分攤流程",
    "settlement flow": "## 8. 結清流程",
    "invite flow": "## 9. 邀請碼流程",
    "archive delete": "## 10. 封存與刪除",
    "frontend backend split": "## 11. 前後端責任切分",
    "validation": "## 12. 驗證與錯誤",
    "roadmap": "## 13. 實作階段",
    "google only": "Google-only",
    "idempotency": "client_request_id",
    "settlement version": "settlement_version",
    "expense payments": "expense_payments",
}


def main() -> int:
    if not PLAN.exists():
        print(f"FAIL: missing {PLAN.relative_to(ROOT)}")
        return 1
    text = PLAN.read_text(encoding="utf-8", errors="replace")
    missing = [label for label, marker in REQUIRED.items() if marker not in text]
    if missing:
        print("FAIL: missing MVP technical plan markers")
        for label in missing:
            print(f"- {label}")
        return 1
    print("PASS: MVP technical plan verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
