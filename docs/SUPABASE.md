# Supabase 設定

Equo 使用 Supabase 作為正式站的登入、多人同步與後台資料來源。前台只讀寫使用者自己可操作的群組資料；後台只允許 `app_admins` 名單內的帳號進入。

## 建立專案

1. 在 Supabase 建立 project，建議名稱使用 `equo`。
2. Region 選擇主要用戶較近的區域。
3. Database password 請保存於密碼管理工具，不要放入 GitHub。

## 建立資料表

Schema 的唯一真相來源是 `supabase/migrations/`，依檔名順序套用。

過去這裡指向的 `supabase/schema.sql` 已於 2026-07-14 移除：它描述的是 pre-MVP 原型的
schema（`expense_splits`、`recurring_bills`、`notifications`、`user_snapshots`、
`group_invites`…），那些表早已被 `20260711230000_drop_legacy_prototype_tables.sql`
刪除，跟實際運作的 schema 完全對不上。它僅存的四張活表（`app_admins`、
`admin_audit_logs`、`app_feedback`、`app_error_logs`）已收進
`20260714120000_admin_support_tables.sql`。

目前主要資料表：

- `profiles`
- `groups`
- `group_members`
- `group_invites`
- `expenses`
- `expense_splits`
- `settlements`
- `settlement_statuses`
- `payment_records`
- `recurring_bills`
- `notifications`
- `user_snapshots`
- `app_admins`
- `admin_audit_logs`
- `app_error_logs`
- `app_feedback`

所有正式資料表都需要 Row Level Security。

## Vercel 環境變數

在 Vercel 專案設定中加入：

```text
SUPABASE_URL=你的 Project URL
SUPABASE_ANON_KEY=你的 anon public key
```

`SUPABASE_ANON_KEY` 可以放在前端使用，但 `service_role` key 不可以放入 GitHub 或前端程式。

## 後台管理員

正式後台路徑：

```text
/admin
```

後台登入前，先用前台或 Supabase Auth 建立一個帳號。接著在 Supabase SQL Editor 將該帳號加入 `app_admins`。

```sql
insert into public.app_admins (user_id, role)
values ('你的 auth.users.id', 'owner')
on conflict (user_id) do update set role = excluded.role;
```

可用角色：

- `owner`：產品擁有者。
- `admin`：一般管理員。
- `support`：客服與資料檢查。

目前後台會讀取：

- 使用者數
- 群組數
- 支出數
- 結算狀態數
- 最近使用者
- 最近群組
- 後台操作紀錄
- 最近錯誤紀錄
- 用戶回饋

## 正式站資料流程

1. Auth：使用者登入 Supabase Auth。
2. Profile：登入後建立或更新 `profiles`。
3. Groups：群組資料同步到 `groups`。
4. Members：成員與角色同步到 `group_members`。
5. Invites：邀請連結寫入 `group_invites`。
6. Expenses：支出寫入 `expenses` 與 `expense_splits`。
7. Settlements：付款狀態寫入 `settlement_statuses` 與 `payment_records`。
8. Admin：後台透過 `get_admin_dashboard()` 讀取總覽資料。
9. Monitoring：前台與後台錯誤透過 `record_app_error()` 寫入 `app_error_logs`。
10. Feedback：用戶回饋透過 `record_user_feedback()` 寫入 `app_feedback`。

## 注意事項

- 後台不要使用 service role key。
- 後台入口只依賴 Supabase Auth 與 `app_admins`。
- 測試資料清除後，前台應從空資料開始，不再自動顯示展示資料。
- 若 `/admin` 顯示尚未連線，請先確認 Vercel 環境變數是否已設定並重新部署。
