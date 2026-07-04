# Equo Claude Continuation Handoff

Date: 2026-07-04

## Use This Workspace Only

Continue from:

```text
C:\Users\wukec\Documents\分帳系統\.worktrees\equo-new-calm-index
```

Do not continue from the repository root. The root workspace previously contained an older prototype and a bad standalone login-gate experiment. Treat this worktree as the current Claude-made product baseline.

## Current Product Direction

- The official product should continue from the Claude-made dark, Pizo-like group workspace.
- The first screen must remain the create, join, and continue flow. Do not replace it with a forced login page.
- MVP auth remains Google-only unless the user explicitly changes scope.
- Keep primary actions obvious: create group, join group, add member, invite member, add expense, settle debt, archive group, and delete group.
- UI behavior must be verified in a real browser, not only by reading code.
- Prefer Pizo-style simple modal flows over full-page detours.

## Canonical References

Read these before changing behavior:

- `docs/Equo_功能規格_MVP.md`
- `docs/launch_readiness_stage.md`
- `docs/stage6_launch_closure.md`
- `docs/production_readiness_stage.md`
- `apps/web/src/app/App.tsx`
- `apps/web/src/app/App.css`
- `apps/web/src/app/uiText.ts`
- `apps/web/src/app/ProfileDialog.tsx`
- `apps/web/src/app/StartFlowPanel.tsx`
- `apps/web/src/app/cloudStore.ts`
- `apps/web/src/app/cloudAdapters.ts`

## Current Production

The production alias is:

```text
https://equo-mu.vercel.app
```

The last verified Claude-worktree deployment was promoted to that alias. Before promoting any new deployment, run the release checks and smoke checks below.

## Portable Node On This Machine

If normal `node` or `npm` is not found, use the portable runtime:

```powershell
$nodeDir='C:\Users\wukec\Documents\分帳系統\.worktrees\equo-new-calm-index\tmp\node-portable'
$env:PATH="$nodeDir;C:\Windows\System32;C:\Windows;C:\Windows\System32\WindowsPowerShell\v1.0;$env:PATH"
```

Then run npm through:

```powershell
& "$nodeDir\npm.cmd" run verify:release
```

## Required Release Verification

From the worktree root:

```powershell
npm run verify:release
$env:EQUO_BASE_URL='https://equo-mu.vercel.app'
npm run smoke:production:all
```

Expected:

- All web tests pass.
- The web build succeeds.
- The built home still contains `建立群組`, `加入群組`, and `繼續使用`.
- The built home does not become a standalone login gate.
- Production web smoke passes.
- Production API smoke passes, with Google token exchange skipped when `EQUO_GOOGLE_ID_TOKEN` is not set.

## Do Not Regress These Items

- Do not bring back the old static `index.html` flow.
- Do not add extra tabs for archived groups. Pizo places archived groups behind the archive icon near the group list header.
- Do not put the settle debt button outside the debt relationship card.
- Do not overload the profile dialog with unrelated information.
- Do not require login before showing the start flow.
- Do not deploy from the repository root.
- Do not write files with tools that corrupt UTF-8 Chinese text.

## Next Product Tasks

1. Profile dialog parity:
   - Keep only Pizo-like profile content.
   - Account tab shows Google and Apple rows.
   - Google row reflects linked or not-linked state.
   - Linked row shows `已連結` and `解除綁定`.
   - Not-linked row shows `未連結` and `綁定帳號`.
   - Other tab shows theme, language, privacy policy, and terms.
   - Reassess whether bottom `取消` and `確認` are necessary. If no state is pending, close-only is acceptable.

2. Group start flow:
   - Keep the first screen as create, join, and continue.
   - Keep create group as a centered modal like Pizo: image placeholder, name input, currency selector, cancel, create.
   - Creation, update, archive, and delete should feel instant with optimistic UI and background sync.

3. Group workspace parity:
   - Match Pizo's information hierarchy, not exact brand art.
   - Central summary card should stay simple.
   - Right rail should include group edit near the group title.
   - Debt relationship, expense records, and recent activity should use the current Equo color system but retain Pizo-like simple structure.

4. Archived and destructive flows:
   - Archived groups live behind the archive icon near the group list header.
   - Archive group and delete group actions remain at the lower-right group management area.
   - Archive, restore, delete, and create flows need browser verification.

5. URL behavior:
   - Group switching should update the URL to `/group/<groupId>`.
   - Directly opening `/group/<groupId>` must load the app shell through the SPA fallback.
   - Unknown group IDs should show a recoverable empty/not-found state, not a Vercel 404.

6. Final browser pass:
   - Start flow.
   - Create group.
   - Edit group.
   - Add virtual member.
   - Invite member.
   - Add expense.
   - View expense record.
   - View recent activity.
   - Settle debt.
   - Archive group.
   - Restore archived group.
   - Delete group.
   - Open profile, switch tabs, test Google link state, test close behavior.

## Suggested Prompt For Claude

```text
Continue the Equo MVP from this exact worktree:
C:\Users\wukec\Documents\分帳系統\.worktrees\equo-new-calm-index

Do not use the repository root as the source. Do not reference or restore the old index.html prototype. The Claude-made version in this worktree is the baseline.

First read:
- docs/claude_continuation_handoff.md
- docs/Equo_功能規格_MVP.md
- docs/launch_readiness_stage.md
- apps/web/src/app/App.tsx
- apps/web/src/app/App.css
- apps/web/src/app/uiText.ts
- apps/web/src/app/ProfileDialog.tsx

Then implement the next product phase:
1. Refine the profile dialog to match the Pizo-like structure: minimal content, account tab, other settings tab, linked/not-linked account states, unlink/link buttons, and no unnecessary footer buttons when there is no pending state.
2. Preserve the create/join/continue start flow. Do not create a forced login gate.
3. Keep archived groups behind the archive icon near the group list header.
4. Keep group URLs under /group/<groupId> and preserve SPA fallback behavior.
5. Verify in-browser after changes.

Before reporting completion, run:
npm run verify:release
$env:EQUO_BASE_URL='https://equo-mu.vercel.app'
npm run smoke:production:all

Do not deploy unless the checks pass and the preview has been verified.
```
