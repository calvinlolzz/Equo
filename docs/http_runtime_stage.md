# Equo MVP HTTP Runtime 階段

更新日期：2026-06-30

本階段把前面完成的 route adapter 包成可部署的 HTTP runtime，讓正式 API path 可以開始接到 Vercel Function 或其他 server runtime。

## 已完成

- `createHttpRuntime`
  - `POST /api/v1/groups`
  - `POST /api/v1/groups/:groupId/invites`
  - `POST /api/v1/invites/:token/accept`
  - `POST /api/v1/groups/:groupId/expenses`
  - `DELETE /api/v1/groups/:groupId/expenses/:expenseId`
  - `POST /api/v1/groups/:groupId/settlement/calculate`
  - `POST /api/v1/groups/:groupId/settlement/:settlementId/confirm`
- Bearer token 解析，用於 Google-only auth。
- 統一 JSON response 與 error response。
- Vercel Function 入口草稿：`api/v1/[...path].ts`。

## 目前刻意保留的缺口

- `Supabase client` 尚未真正接上，因為目前沒有實際 Supabase 連線與 secret。
- Google ID token verifier 尚未真正接上，入口檔目前只保留 `GOOGLE_ID_TOKEN` 位置。

## 下一步

1. 安裝/確認 Node 與 NPM。
2. 補真正的 Supabase server client adapter。
3. 補 Google ID token verifier。
4. 跑 `npm test` 與 Supabase advisors。

## Production Auth Update

- Bearer token remains available for local development.
- `equo_session` cookie is accepted by the HTTP runtime for formal same-origin requests.
- Vercel Function forwards both Authorization and Cookie headers into the shared runtime.
