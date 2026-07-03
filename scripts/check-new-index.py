from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / "references" / "index.html"

REQUIRED = {
    "pizo-inspired marker": "Pizo Inspired Group Home",
    "liquid glass marker": "liquid-glass",
    "group shell": "pizo-inspired-group-shell",
    "group switch list": "group-switch-list",
    "active group action": "setActiveGroup",
    "group shell render action": "renderGroupShell",
    "home summary": "home-summary",
    "member strip": "member-strip",
    "spending switch": "spending-switch",
    "debt preview": "debt-preview",
    "record preview": "record-preview",
    "activity preview": "activity-preview",
    "group sidebar": "group-sidebar",
    "floating expense action": "floating-expense-action",
    "expense entry modal": "expense-entry-modal",
    "expense mode tabs": "expense-mode-tabs",
    "allocation preview": "allocation-preview",
    "allocation member list": "allocation-member-list",
    "split amount preview": "split-amount-preview",
    "payer selector": "payer-select",
    "recipient selector": "recipient-select",
    "record type badge": "record-type-badge",
    "invite member modal": "invite-member-modal",
    "currency panel": "currency-panel",
    "join code modal": "join-code-modal",
    "join code input": "join-code-input",
    "join group action": "joinGroupByCode",
    "invite code hint": "EQO7TWD",
    "detail panel": "detail-panel",
    "detail panel title": "detail-panel-title",
    "record detail": "record-detail-view",
    "analysis detail": "analysis-detail-view",
    "debt detail": "debt-detail-view",
    "settlement confirm modal": "settlement-confirm-modal",
    "settlement confirm summary": "settlement-confirm-summary",
    "settlement confirm action": "confirmSettlement",
    "open settlement action": "openSettlementConfirm",
    "settlement state action": "markGroupSettled",
    "members detail": "members-detail-view",
    "activity detail": "activity-detail-view",
    "archive detail": "archive-detail-view",
    "demo guide detail": "demo-guide-detail-view",
    "demo guide action": "openDemoGuide",
    "empty records state": "empty-records-state",
    "empty archive state": "empty-archive-state",
    "mobile safety marker": "mobile-stack-safe",
    "archive group modal": "archive-group-modal",
    "delete group modal": "delete-group-modal",
    "archive group action": "archiveActiveGroup",
    "restore group action": "restoreGroup",
    "delete group action": "deleteActiveGroup",
    "danger confirm action": "openDangerConfirm",
    "create group modal": "create-group-modal",
    "group name input": "group-name-input",
    "currency picker": "currency-picker",
    "add member modal": "add-member-modal",
    "member name input": "member-name-input",
    "members list": "members-list",
    "expense summary": "expense-summary",
    "expense list": "expenses-list",
    "settlement preview": "settlement-preview",
    "toast": "toast-region",
    "reduced motion": "prefers-reduced-motion: reduce",
    "group creation action": "createGroup",
    "member creation action": "addMember",
    "open member action": "openMemberModal",
    "single next step action": "openExpenseEntry",
    "expense mode action": "setExpenseMode",
    "allocation preview action": "renderAllocationPreview",
    "detail panel action": "openDetailPanel",
    "close detail action": "closeDetailPanel",
    "expense summary action": "renderExpenseSummary",
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
