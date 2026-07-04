# Claude Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hand off the current Equo MVP safely to Claude or another worker without losing the Claude-made production baseline.

**Architecture:** Keep the product code in the existing Claude worktree, add a durable handoff document, preserve release guards that prevent a login-gate regression, and use browser verification for user-facing flows.

**Tech Stack:** React, Vite, TypeScript, Python release guards, Vercel deployment smoke checks, Supabase-backed MVP API.

---

### Task 1: Protect The Current Baseline

**Files:**
- Read: `docs/claude_continuation_handoff.md`
- Read: `docs/Equo_功能規格_MVP.md`
- Read: `docs/launch_readiness_stage.md`
- Read: `apps/web/src/app/App.tsx`
- Read: `apps/web/src/app/App.css`
- Read: `apps/web/src/app/uiText.ts`

- [ ] **Step 1: Confirm the active workspace**

Run:

```powershell
pwd
```

Expected path:

```text
C:\Users\wukec\Documents\分帳系統\.worktrees\equo-new-calm-index
```

- [ ] **Step 2: Confirm the current working changes**

Run:

```powershell
git status --short
```

Expected: existing Claude worktree changes may be present. Do not discard them unless the user explicitly asks.

- [ ] **Step 3: Confirm the guarded start flow**

Run:

```powershell
rg -n "建立群組|加入群組|繼續使用|使用 Equo|使用 Google 登入|使用 Apple 登入" apps/web/src scripts docs
```

Expected: `建立群組`, `加入群組`, and `繼續使用` remain in the start flow and release guards. Standalone login-gate labels must not replace the start flow.

### Task 2: Profile Dialog Parity

**Files:**
- Modify: `apps/web/src/app/ProfileDialog.tsx`
- Modify: `apps/web/src/app/App.css`
- Modify: `apps/web/src/app/uiText.ts`
- Test: `apps/web/src/app/appComponents.test.ts` or the nearest existing profile dialog test file

- [ ] **Step 1: Add or update a profile dialog test**

Test behavior:

```tsx
expect(screen.getByText("個人資料")).toBeInTheDocument();
expect(screen.getByText("帳號設定")).toBeInTheDocument();
expect(screen.getByText("其他設定")).toBeInTheDocument();
expect(screen.getByText("Google 帳號")).toBeInTheDocument();
expect(screen.getByText("Apple 帳號")).toBeInTheDocument();
```

Expected: the test should fail if the current dialog still contains extra unrelated information or lacks account state rows.

- [ ] **Step 2: Implement minimal Pizo-like profile rows**

Required rows:

```text
Google 帳號 | 已連結 | 解除綁定
Apple 帳號  | 未連結 | 綁定帳號
```

If the user is not signed in with Google, the Google row should display:

```text
Google 帳號 | 未連結 | 綁定帳號
```

- [ ] **Step 3: Remove unnecessary footer buttons when no pending setting exists**

If the profile dialog only launches immediate actions, use the close icon as the main dismissal control. Keep footer buttons only if a tab contains unsaved changes.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npm test
```

Expected: all tests pass.

### Task 3: Group Flow Parity

**Files:**
- Modify: `apps/web/src/app/StartFlowPanel.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/App.css`
- Test: `apps/web/src/app/appComponents.test.ts`

- [ ] **Step 1: Keep the create-group button as Pizo-style `建立群組`**

Required behavior:

```text
Click 建立群組 -> centered modal opens
Modal contains group image placeholder, 名稱 input, 貨幣 TWD selector, 取消, 建立
Click 建立 -> modal closes quickly and new group appears in the group list
```

- [ ] **Step 2: Keep URL state on group switching**

Required behavior:

```text
Select group A -> URL becomes /group/<groupAId>
Select group B -> URL becomes /group/<groupBId>
Reload /group/<groupBId> -> app shell loads
```

- [ ] **Step 3: Keep archived groups behind the header archive icon**

Do not add a separate archive tab. The archive icon near the group list header is the entry point.

- [ ] **Step 4: Run browser verification**

Use a local preview and verify:

```text
create group
switch group
archive group
restore archived group
delete group
reload /group/<groupId>
```

### Task 4: Release Verification

**Files:**
- Read: `package.json`
- Read: `scripts/check-built-web-home.py`
- Read: `scripts/smoke-production-web.py`

- [ ] **Step 1: Run the release gate**

Run:

```powershell
npm run verify:release
```

Expected:

```text
tests pass
build succeeds
check-built-web-home passes
check-encoding passes
check-launch-readiness passes
```

- [ ] **Step 2: Run production smoke checks after deployment**

Run:

```powershell
$env:EQUO_BASE_URL='https://equo-mu.vercel.app'
npm run smoke:production:all
```

Expected:

```text
production web smoke checks passed
production API smoke passed
```

- [ ] **Step 3: Report only verified status**

Report the exact checks that were run and whether deployment was changed. If no deployment was made, say so directly.
