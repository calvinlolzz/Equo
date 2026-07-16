# Supabase 設定

Equo 使用 Supabase 作為正式站的登入、多人同步與後台資料來源。前台只讀寫使用者自己可操作的群組資料；後台只允許 `app_admins` 名單內的帳號進入。

## 建立專案

1. 在 Supabase 建立 project，建議名稱使用 `equo`。
2. Region 選擇主要用戶較近的區域。
3. Database password 請保存於密碼管理工具，不要放入 GitHub。

## 建立資料表

**全新資料庫：只要套用 `supabase/schema.sql`。**

`schema.sql` 是用 `npx supabase db dump --schema public` 從正式庫匯出的**完整當前
schema**（2026-07-16），並逐物件對過 pg_catalog（16 表、69 約束、24 索引、23 functions、
1 view、38 policies、全 16 表開 RLS、service_role grants）。它已經把每一支 migration 的
累積結果摺疊在內，所以套用它一次就是正式庫的現況。

> `--schema public` 不會匯出 event trigger（它是資料庫全域物件，不屬於任何 schema），
> 所以檔案末尾手動補回了 `ensure_rls` event trigger（照 catalog 原樣）。要重新產生時：
> `npx supabase db dump --schema public -f supabase/schema.sql`，然後把那段 event trigger
> 重新補到檔尾。

`supabase/migrations/` 保留作**歷史紀錄**（記錄 schema 怎麼演變到今天，以及每一步的「為什麼」），
**不會**再疊加套用在 `schema.sql` 之上。正式庫已經套過全部 migration；它的 migration 歷史
不受此檔影響。

（先前這裡寫的「schema.sql 是基底、migrations 疊在上面」已作廢——那是 2026-07-16 產出這份
certified baseline 之前的狀態。舊的手寫 schema.sql 描述的是 pre-MVP 原型、且與現況漂移，
已被本檔取代。）

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
