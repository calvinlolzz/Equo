# Equo Claude Continuation Handoff（歷史文件，勿當成現況）

Date: 2026-07-04

> **⚠️ 這是 2026-07-04 的一次性交接快照，不是現況說明，也不要照它的指示動手。**
> 2026-07-17 對著程式碼核對後確認**大部分已失效**：描述的 session 儲存方式已改（token 現在
> 只在 HttpOnly cookie 裡）、〈Use This Workspace Only〉的理由已不成立（root 與 worktree 現在
> 同步）、〈Next Product Tasks〉列的工作**都做完了**、它要人先讀的三份 docs
> （`launch_readiness_stage.md`／`stage6_launch_closure.md`／`production_readiness_stage.md`）
> **都不存在**，而它把 App.tsx 當成行為的權威來源——那是 PR #14 把 App.tsx 拆成一堆 hook 之前的事。
>
> 保留本檔只為了**決策出處**。它唯二仍然有效的結論（硬登入牆、GIS 永不復活）已經寫進
> `docs/OAUTH.md`；現況請看 `docs/OAUTH.md`、`docs/SUPABASE.md`、`docs/TECH_STACK.md`、
> `docs/TESTING.md`、`README.md`。

## Login Wall Decision (2026-07-04, supersedes earlier "no forced login" guidance)

The owner made a hard product decision: Equo now requires a Pizo-style hard login wall. With no valid session, the ONLY screen shown is `LoginScreen` (`apps/web/src/app/LoginScreen.tsx`) — centered logo mark, app name, tagline, a primary "使用 Google 登入" button, and a disabled "使用 Apple 登入" placeholder with a "即將推出" hint. There is no guest mode, no `稍後再說`, and no local/offline groups. The create/join/continue start flow described elsewhere in this document still exists, but only renders after a successful login.

Sign-in mechanism: Supabase OAuth redirect (Google), not Google Identity Services (GIS). The client redirects to Supabase's `/auth/v1/authorize?provider=google&redirect_to=<origin>` (see `apps/web/src/app/supabaseOAuth.ts` for `buildAuthorizeUrl`/`parseOAuthFragment`). Supabase completes the Google consent flow and redirects back with `#access_token=...` in the URL fragment (implicit flow, no PKCE). The app parses that fragment on boot, exchanges the token via `POST /api/v1/auth/supabase`, and stores the resulting session the same way the app always has (`sessionStore.ts`).

GIS (the old button flow that called `google.accounts.id` directly) is abandoned for good: it fails in production because the Google OAuth client has no authorized JavaScript origins configured, and fixing that is explicitly out of scope. `apps/web/src/app/googleIdentity.ts` and its test have been deleted; do not resurrect that flow.

Any "do not require login before showing the start flow" language below is historical and no longer applies — it is superseded by this decision. The launch readiness guards (`scripts/check-built-web-home.py`, `scripts/smoke-production-web.py`, `scripts/check-launch-readiness-stage.py`) were updated accordingly: they now require BOTH the login wall copy (`使用 Google 登入`) AND the create/join/continue copy (`建立群組`, `加入群組`, `繼續使用`) to be present in the built bundle, since both screens ship in the same SPA bundle. There is no more "forbidden marker" concept for login-gate copy.

## Use This Workspace Only

Continue from:

```text
C:\Users\wukec\Documents\分帳系統\.worktrees\equo-new-calm-index
```

Do not continue from the repository root. The root workspace previously contained an older prototype and a bad standalone login-gate experiment. Treat this worktree as the current Claude-made product baseline.

## Current Product Direction

- The official product should continue from the Claude-made dark, Pizo-like group workspace.
- A hard login wall (`LoginScreen`) is required before anything else. Once logged in, the first screen is the create, join, and continue flow. See "Login Wall Decision" above.
- MVP auth remains Google-only unless the user explicitly changes scope. The mechanism is Supabase OAuth redirect, not GIS.
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
- `apps/web/src/app/LoginScreen.tsx`
- `apps/web/src/app/supabaseOAuth.ts`
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
- The built bundle contains the login wall copy (`使用 Google 登入`) AND the post-login create/join/continue copy (`建立群組`, `加入群組`, `繼續使用`).
- Production web smoke passes.
- Production API smoke passes, with Google token exchange skipped when `EQUO_GOOGLE_ID_TOKEN` is not set.

## Do Not Regress These Items

- Do not bring back the old static `index.html` flow.
- Do not add extra tabs for archived groups. Pizo places archived groups behind the archive icon near the group list header.
- Do not put the settle debt button outside the debt relationship card.
- Do not overload the profile dialog with unrelated information.
- Do require login before showing the start flow (hard login wall — see "Login Wall Decision" above; this reverses the earlier no-login-gate guidance).
- Do not resurrect the GIS button flow (`googleIdentity.ts`); the login mechanism is the Supabase OAuth redirect.
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
2. Preserve the create/join/continue start flow after login. The app requires a hard Pizo-style login wall (Supabase OAuth redirect) before it — see "Login Wall Decision" above.
3. Keep archived groups behind the archive icon near the group list header.
4. Keep group URLs under /group/<groupId> and preserve SPA fallback behavior.
5. Verify in-browser after changes.

Before reporting completion, run:
npm run verify:release
$env:EQUO_BASE_URL='https://equo-mu.vercel.app'
npm run smoke:production:all

Do not deploy unless the checks pass and the preview has been verified.
```
