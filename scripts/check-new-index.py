from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / "references" / "index.html"

REQUIRED = {
    "pizo-inspired marker": "Pizo Inspired Create Flow",
    "liquid glass marker": "liquid-glass",
    "create flow marker": "pizo-inspired-create",
    "empty state": "empty-state",
    "create group modal": "create-group-modal",
    "group name input": "group-name-input",
    "currency picker": "currency-picker",
    "first expense modal": "first-expense-modal",
    "add member modal": "add-member-modal",
    "member name input": "member-name-input",
    "members list": "members-list",
    "toast": "toast-region",
    "reduced motion": "prefers-reduced-motion: reduce",
    "group creation action": "createGroup",
    "member creation action": "addMember",
    "open member action": "openMemberModal",
    "single next step action": "openExpenseModal",
}

FORBIDDEN = {
    "old auth screen": 'id="authScreen"',
    "old monolithic default groups": "defaultGroups",
    "old floatpay storage keys": "floatpay-",
    "old Supabase CDN app script": "@supabase/supabase-js",
    "old glass class dependency": 'class="summary glass',
    "rejected dashboard tray": "household-tray",
    "rejected bottom navigation": 'class="nav"',
    "rejected multi-view navigation": "data-view",
    "rejected settlement CTA": "settleNow",
    "rejected expense-first sheet": "openExpenseSheet",
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
    print("PASS: Pizo-inspired low-friction create flow verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
