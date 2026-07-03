# Equo MVP Supabase Repository 階段

更新日期：2026-06-30

本階段把 groups / group_members / invites 的 repository contract 接到 Supabase/Postgres 風格的查詢邊界，同時補上 migration 的 RLS 與 explicit grants 檢查。

## 已完成

- `createSupabaseGroupRepository`
  - 建立群組。
  - 建立 owner member。
  - 建立虛擬 member。
  - 建立 invite，回傳明文 token，但只儲存 `token_hash`。
  - 接受 invite，可認領虛擬 member。
  - 寫入 `client_requests` 保存 `client_request_id`。
- `groupRoutes`
  - Google-only identity 驗證。
  - user upsert。
  - 呼叫 handler。

## Supabase 安全邊界

Supabase 新建 public tables 不應假設會自動暴露給 Data API，因此 migration 明確包含：

- explicit grants。
- RLS。
- `to authenticated` policies。
- `client_requests` idempotency table。

## 下一步

1. 補真正的 Supabase client adapter。
2. 補 route runtime，例如 Next.js route handler 或 Vercel Function。
3. 對 migration 跑 Supabase advisors。
4. 進入 expenses API repository 與 settlement repository。
