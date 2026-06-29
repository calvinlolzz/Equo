from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / "references" / "index.html"

REQUIRED = {
    "fresh page marker": "Fresh Calm Index",
    "approved style name": "Calm Household",
    "liquid glass marker": "liquid-glass",
    "household tray": "household-tray",
    "expense sheet": "expense-sheet",
    "toast": "toast-region",
    "reduced motion": "prefers-reduced-motion: reduce",
    "nav interaction": "data-view",
    "add expense action": "openExpenseSheet",
    "settle action": "settleNow",
}

FORBIDDEN = {
    "old auth screen": 'id="authScreen"',
    "old monolithic default groups": "defaultGroups",
    "old floatpay storage keys": "floatpay-",
    "old Supabase CDN app script": "@supabase/supabase-js",
    "old glass class dependency": 'class="summary glass',
}


def main() -> int:
    html = HTML.read_text(encoding="utf-8", errors="replace")
    missing = [label for label, marker in REQUIRED.items() if marker not in html]
    present_forbidden = [label for label, marker in FORBIDDEN.items() if marker in html]
    if missing or present_forbidden:
        if missing:
            print("FAIL: missing required new-index markers")
            for label in missing:
                print(f"- {label}")
        if present_forbidden:
            print("FAIL: old-index markers still present")
            for label in present_forbidden:
                print(f"- {label}")
        return 1
    print("PASS: fresh Calm Household index markers verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
