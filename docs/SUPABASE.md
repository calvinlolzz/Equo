# Supabase 設定

Equo 使用 Supabase 作為正式站的登入、多人同步與後台資料來源。前台只讀寫使用者自己可操作的群組資料；後台只允許 `app_admins` 名單內的帳號進入。

## 建立專案

1. 在 Supabase 建立 project，建議名稱使用 `equo`。
2. Region 選擇主要用戶較近的區域。
3. Database password 請保存於密碼管理工具，不要放入 GitHub。

## 建立資料表

**全新資料庫：只要套用 `supabase/migrations/20260601000000_baseline.sql`（單一 squash baseline）。**

這支 baseline 是用 `npx supabase db dump --schema public` 從正式庫匯出的**完整當前
schema**（2026-07-16），並逐物件對過 pg_catalog（16 表、69 約束、24 索引、23 functions、
1 view、38 policies、全 16 表開 RLS、service_role grants）。它已經把每一支 migration 的
累積結果摺疊在內，所以套用它一次就是正式庫的現況。

> `--schema public` 不會匯出 event trigger（它是資料庫全域物件，不屬於任何 schema），
> 所以檔案末尾手動補回了 `ensure_rls` event trigger（照 catalog 原樣）。要重新產生時：
> `npx supabase db dump --schema public -f supabase/migrations/20260601000000_baseline.sql`，
> 然後把那段 event trigger 重新補到檔尾。

（先前這裡的 `supabase/schema.sql` 已在 2026-07-16 squash 成上面這支單一 baseline
migration；23 支本地增量 migration 檔一併移除，git 歷史仍保留。更早的「schema.sql 是基底、
migrations 疊在上面」模型已作廢。squash + 遠端 ledger repair 的做法見下方〈Migration
squash baseline〉。）

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

## Migration squash baseline

2026-07-16 把增量 migration 收斂成單一 baseline：

- **本地（已完成）**：`supabase/migrations/` 現在只有 `20260601000000_baseline.sql`
  （＝上面那份 certified dump）。23 支本地增量檔已移除（git 歷史保留）。
- **遠端（待執行）**：正式庫的 `supabase_migrations.schema_migrations` 有 34 筆真實歷史，
  版本號與本地檔對不上（本地早先已把 10 支 prototype 摺進 mvp_core，卻沒同步遠端）。
  下方 runbook 用 `migration repair` 把那 34 筆全標 `reverted`、把 baseline 標 `applied`，
  讓 local 與 remote 收斂成同一支 baseline。**此步尚未執行**——指令如下。

> `migration repair` **只改追蹤表、不動任何 schema 或資料**（Supabase 官方文件明載）。
> 這步不會重建、刪除或改動任何正式庫物件——正式庫的實際 schema 完全不變。

一次性收斂指令（在已 `supabase link` 到正式專案、且能連到 DB 的終端執行）。
**步驟 1、2 要接連跑完、中間不要 `db push`**：步驟 1 之後遠端 ledger 會短暫變空，此時若
`db push` 會嘗試把 baseline SQL 真的套到正式庫（會在第一個重複的 `CREATE POLICY` 就中止，
不致損壞，但仍應避免）。

```bash
# 1) 把遠端 34 筆歷史全部標記為 reverted（只改記帳表）
npx supabase migration repair --status reverted \
  20260610062230 20260610062301 20260610070037 20260610070320 20260610071944 \
  20260610073727 20260611025818 20260625092403 20260625094019 20260625134312 \
  20260630043638 20260630043815 20260630123733 20260701001352 20260704105056 \
  20260705114530 20260705120735 20260706121425 20260707015933 20260707150107 \
  20260707154135 20260711020324 20260711055419 20260711142656 20260711142712 \
  20260712074915 20260712155549 20260714040033 20260714122019 20260714122107 \
  20260714133931 20260714135723 20260714140634 20260714163519

# 2) 把單一 baseline 標記為 applied
npx supabase migration repair --status applied 20260601000000

# 3) 驗證：local 與 remote 應只剩 20260601000000 這一支，且對齊
npx supabase migration list
```

之後新增 schema 變更就走正常 CLI 流程：新增一支 `supabase/migrations/<ts>_xxx.sql`，
`supabase db push` 只會套用它（baseline 已在兩邊標記 applied，不會重跑）。

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
