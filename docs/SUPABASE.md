# Supabase 設定

Equo 使用 Supabase 作為正式站的登入、多人同步與後台資料來源。

**前台不直接連 Supabase。** 瀏覽器只跟自家的 `/api/v1` 說話；所有資料庫存取都在伺服器端以 `service_role` 進行，「只能動自己群組的資料」是由伺服器的 handler 與 RPC 強制的，不是靠前端的資料庫權限（前端根本沒有任何 Supabase key，也沒裝 `@supabase/supabase-js`）。Supabase 在前端唯一的角色是 OAuth 跳轉。後台 `/admin` 只允許 `app_admins` 名單內的帳號進入。

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

正式庫的 `public` schema 就是這 16 張表（以 baseline 為準）：

| 領域 | 資料表 |
|---|---|
| 身分 | `users`（主要身分表，登入時 upsert）、`profiles`（legacy 的每人設定列，與 `users` 同步維護）|
| 群組 | `groups`、`group_members`、`invites` |
| 支出 | `expenses`、`expense_shares`（分攤）、`expense_payments`（付款人，支援多付款人）|
| 結算 | `settlements`、`settlement_transfers` |
| 後台／維運 | `app_admins`、`admin_audit_logs`、`app_error_logs`、`app_feedback` |
| 基礎設施 | `client_requests`（寫入冪等去重，交易式 RPC 用）|
| 已死 | `audit_logs`（無任何程式碼引用、正式庫 0 列，policies 還指向早已撤權的 `authenticated`）|

所有正式資料表都開了 Row Level Security（`ensure_rls` event trigger 會盯著新表）。

> 這份清單先前列了 `group_invites`／`expense_splits`／`settlement_statuses`／`payment_records`／
> `recurring_bills`／`notifications`／`user_snapshots` —— **全都不存在**（前四個是名字寫錯、後三個
> 純屬虛構），且漏了整個 app 賴以運作的 `users`。2026-07-16 對著 baseline 逐張核對後修正。

## Migration squash baseline

**2026-07-16 已完成收斂，local 與 remote 都只剩單一 baseline。** `npx supabase migration list`
現在應只顯示 `20260601000000` 一列、兩欄對齊：

- **本地**：`supabase/migrations/` 只有 `20260601000000_baseline.sql`（＝上面那份 certified
  dump）。23 支本地增量檔已移除（git 歷史保留）。
- **遠端**：正式庫的 `supabase_migrations.schema_migrations` 原本有 34 筆歷史、版本號與本地
  檔對不上（本地早先把 10 支 prototype 摺進 `mvp_core`，卻沒同步遠端）。已用
  `migration repair` 把那 34 筆全標 `reverted`、把 baseline 標 `applied`。完整的版本清單與
  當時的 runbook 見 PR #16 的 git 歷史——那是一次性動作，不需要再跑。

> 當時安全的關鍵：`migration repair` **只改追蹤表、不動任何 schema 或資料**（Supabase 官方
> 文件明載）。整個收斂沒有重建、刪除或改動任何正式庫物件。

**日常做法（現行）**：新增 schema 變更就走正常 CLI 流程——加一支
`supabase/migrations/<ts>_xxx.sql`，然後 `supabase db push` 只會套用它（baseline 兩邊都已
標記 applied，不會重跑）。

## Vercel 環境變數

**伺服器端（少一個，API 就整個回 503 `RUNTIME_ENV_MISSING`——見 `runtimeEnv.ts`）：**

```text
SUPABASE_URL=你的 Project URL
SUPABASE_ANON_KEY=你的 anon public key   # 伺服器端用途，見下方說明
SUPABASE_SERVICE_ROLE_KEY=你的 service_role key
GOOGLE_OAUTH_CLIENT_ID=你的 OAuth client ID
SESSION_SECRET=夠長的隨機字串
```

**前端 build 需要（就這一個）：**

```text
VITE_SUPABASE_URL=你的 Project URL   # 唯一用途：組 OAuth 跳轉網址
```

`SUPABASE_ANON_KEY` **不是給前端用的**——前端完全沒有任何 Supabase key。它在伺服器端當作
驗證 Supabase access token 時的 apikey（見 `vercel-api/v1Handler.ts` 的
`createSupabaseAccessTokenVerifier`）。`SUPABASE_SERVICE_ROLE_KEY` 與 `SESSION_SECRET`
同樣只存在於伺服器，**永遠不要放進 GitHub 或任何 client 端變數**。

> `VITE_GOOGLE_OAUTH_CLIENT_ID` 目前**是死的**：正式專案雖然設了它，但前端沒有任何程式碼讀它
> （全 repo 只剩 `vite-env.d.ts` 的選用型別宣告）。Google client ID 是設定在 Supabase 的
> provider 裡，`buildAuthorizeUrl` 只用得到 Supabase URL；伺服器端用的則是不帶 VITE 前綴的
> `GOOGLE_OAUTH_CLIENT_ID`。

> 先前這裡寫「`SUPABASE_ANON_KEY` 可以放在前端使用」是錯的，且只列了 5 個必要變數中的 2 個
> （照著設會得到一個一直 503 的部署）。就算真把 anon key 放到前端也沒有用：`anon` 與
> `authenticated` 對所有資料表的權限已於 2026-07-14 全數撤銷，baseline 只留 schema USAGE。

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

目前後台會讀取（皆為 `admin_console_*` RPC）：

- 總覽（`admin_console_overview`）：使用者數、7 日活躍／新增使用者、群組數、7 日活躍群組、支出筆數、7 日支出
- 使用者清單（`admin_console_users`，可搜尋、分頁）與單一使用者細節（`admin_console_user_detail`，只吃 `p_user_id`）
- 群組清單（`admin_console_groups`，可搜尋、分頁、可篩選）
- 後台操作紀錄（`admin_console_audit_logs`，讀 `admin_audit_logs`）
- 錯誤紀錄（`admin_console_errors`）
- 用戶回饋（`admin_console_feedback`）

（先前這裡列的「結算狀態數」不存在——沒有任何 `admin_console_*` RPC 回傳結算指標。）

## 正式站資料流程

1. Auth：使用者用 Google 登入 Supabase Auth；前端把回傳的 access token 交給
   `POST /api/v1/auth/supabase`，由伺服器驗證後簽自己的 session（HttpOnly cookie）。
2. Identity：登入時 upsert **`users`**（`upsertUserByGoogleIdentity`）。`profiles` 是 legacy
   的每人設定列，由伺服器順帶維護同步，不是登入的主要寫入目標。
3. Groups：群組資料同步到 `groups`。
4. Members：成員與角色同步到 `group_members`。
5. Invites：建立邀請寫入 **`invites`**（token 以雜湊保存）；接受邀請走交易式的
   **`accept_invite`** RPC。
6. Expenses：新增／編輯支出走交易式的 **`create_expense`**／**`replace_expense`** RPC，
   由它們一次寫入 `expenses` + `expense_shares` + `expense_payments`（並用 `client_requests`
   做冪等去重）。編輯在 **API 層是 `PUT`／`replace_expense`**，前端不可退回「先 DELETE 再
   POST」的舊做法；至於 DB 層，`replace_expense` 內部是把舊列 soft-delete（`deleted_at`）
   後轉呼叫 `create_expense` 產生新列——整段在同一個交易裡。
7. Settlements：結算走交易式的 **`create_settlement`** RPC，寫入 `settlements` +
   `settlement_transfers`。
8. Admin：後台透過 `admin_console_overview()` 讀取總覽，其餘查詢與管理操作走同一組 `admin_console_*` RPC（`admin_console_users`／`admin_console_groups`／`admin_console_set_user_disabled` 等）。
9. Monitoring：前台與後台錯誤由伺服器以 service_role 直接寫入 `app_error_logs`（見 `supabaseSupportRepository.recordClientError`）。
10. Feedback：用戶回饋由伺服器以 service_role 直接寫入 `app_feedback`（見 `supabaseSupportRepository.createFeedback`）。

## 注意事項

- **service role key 只存在於伺服器；瀏覽器（含 `/admin` 前端）永遠不持有任何 Supabase key。**
  後台的 `admin_console_*` RPC 全部 `REVOKE FROM PUBLIC`、EXECUTE 只給 `service_role`
  （外加 owner `postgres` 本來就有），
  伺服器就是拿 service_role 去呼叫它們的——所以「後台不用 service role key」的說法反了；
  真正的界線是那把 key 不准離開伺服器。
- 後台入口只依賴 Supabase Auth 與 `app_admins`。
- 測試資料清除後，前台應從空資料開始，不再自動顯示展示資料。
- 若 `/admin` 顯示尚未連線，請先確認 Vercel 環境變數是否已設定並重新部署。
