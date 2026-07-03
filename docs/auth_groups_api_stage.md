# Equo MVP 登入與群組 API 階段

更新日期：2026-06-30

本階段把正式後端的第一批 API 邊界切出來：Google-only 登入 context、群組權限檢查、groups / group_members / invites 的 repository contract 與 handler。

## 目標

- 登入只接受 Google identity，不加入 Email magic link 或其他供應商。
- handler 不直接依賴 Supabase client，先依賴 repository 介面。
- 群組建立時同時建立 owner member。
- 邀請碼流程只透過 `token_hash` 查找。
- 寫入流程保留 `client_request_id`，讓後端可做 idempotency。

## 已建立的邊界

- `apps/web/src/server/auth/google.ts`
  - `GoogleIdentity`
  - `verifyGoogleIdToken`
- `apps/web/src/server/auth/session.ts`
  - `AuthenticatedContext`
  - `requireAuthenticatedUser`
- `apps/web/src/server/repositories/groupRepository.ts`
  - `createGroup`
  - `createVirtualMember`
  - `createInvite`
  - `acceptInvite`
  - `hashInviteToken`
  - `recordClientRequest`
- `apps/web/src/server/handlers/groups.ts`
  - `handleCreateGroup`
  - `handleCreateInvite`
  - `handleAcceptInvite`
  - `requireGroupMember`

## 下一步

1. 將 repository 介面接到 Supabase/Postgres 實作。
2. 將 `users` 的 Google subject upsert 接進 `requireAuthenticatedUser`。
3. 補 groups / members / invites 的 route adapter。
4. 實作 idempotency table 或以 resource unique key 管理 `client_request_id`。
5. 再進入 expenses API 與 settlement API。
