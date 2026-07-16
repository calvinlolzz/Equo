# Equo 技術棧

本文件描述 Equo **目前實際的**架構。

> 這份文件在 2026-07-14 之前描述的是一個早已不存在的系統：vanilla JS、單一 `index.html`、`localStorage` 免登入試用、「暫不採用 React」。那個原型的痕跡至今還留在資料庫裡（見「資料庫」一節），但程式碼早就不是那樣了。整份重寫。

## 一句話

React SPA + Vercel Serverless API + Supabase Postgres。**瀏覽器不直接碰資料庫**，所有資料存取都經過我們自己的 API。

## 技術棧

| 層級 | 技術 |
| --- | --- |
| 前端 | React 19 + TypeScript，Vite build（無 vite config，JSX 走 esbuild 預設） |
| 樣式 | 手寫 CSS，RGB-triplet custom properties 做日/夜主題 |
| API | Vercel Serverless Function（單一 catch-all，region `sin1`） |
| 資料庫 | Supabase Postgres |
| 登入 | Supabase OAuth（Google）redirect → 換成我們自己簽的 session |
| 檔案 | Supabase Storage（`equo-images` bucket） |
| 測試 | Vitest（node 環境為主；hook 測試用 per-file `@vitest-environment jsdom` + @testing-library/react） |
| 部署 | GitHub → Vercel（push `main` 即上線） |

## 請求怎麼跑

```text
瀏覽器 (React SPA)
  │  fetch("/api/v1/...")，帶 equo_session cookie（HttpOnly）
  ▼
vercel.json rewrite:  /api/v1/(.*) -> /api/v1/[...path]
  │  ← 這條 rewrite 不可刪。少了它，兩段以上的路徑會在 edge 404，
  │    而單層路徑照常運作，所以看起來完全健康。（真的壞過 8 小時。）
  ▼
api/v1/[...path].ts  →  vercel-api/v1Handler.ts
  │
  ▼
apps/web/src/server/http/runtime.ts        路由表（method + 正則）
  │
  ├─ auth/routeContext.ts                  唯一的認證入口
  │    ├ Google/Supabase token → upsert user
  │    └ equo session token   → 查 users.deleted_at（帳號是否被停用）
  │
  ├─ routes/*.ts                           驗證輸入、對應錯誤碼
  ├─ handlers/*.ts                         權限與流程
  └─ repositories/supabase*.ts             資料存取
       │
       ▼
     db/postgrestClient.ts                 型別化的 select/insert/update/rpc
       │  以 service_role 連線
       ▼
     Supabase PostgREST
```

## 資料存取的兩條規則

**1. Repository 直接呼叫型別化的 `PostgrestClient`。**

以前 repository 送出的是 **SQL 字串，而那些 SQL 從來不會被執行** —— 有一層 800 行的翻譯器用 substring 比對把它們手工翻成 PostgREST 呼叫。兩邊可以無限期地各說各話（而且真的發生了：邀請的過期檢查寫在 SQL 裡、翻譯後的呼叫裡沒有）。那層已於 2026-07-14 刪除。**不要再寫 SQL 字串給 repository。**

**2. 多語句寫入一律進 Postgres function。**

PostgREST 是一個語句一個 HTTP 呼叫，中間沒有 transaction。所以任何「寫 A 再寫 B」的動作都必須包成一支 function：

- `create_expense` / `replace_expense` / `soft_delete_expense`
- `accept_invite`
- `create_settlement`

它們同時負責 membership 檢查、跨群組 member id 驗證、以及 `client_requests` 的冪等檢查 —— **檢查和它要保護的那個寫入在同一個 transaction 裡**，不會互相競爭。

編輯支出是 `PUT /api/v1/groups/:groupId/expenses/:expenseId`（`replace_expense`）。**不要退回「前端先 delete 再 create」** —— 那正是會弄丟使用者紀錄的舊做法。

## 認證

- 登入：前端跳轉到 Supabase OAuth → 回來時 URL fragment 帶 `access_token` → 交給 `POST /api/v1/auth/supabase` → 伺服器簽一個自己的 session。
- Session 存在 **`equo_session` HttpOnly cookie** 裡。**JavaScript 碰不到它，也不該碰。**
- `localStorage` 只存「誰登入了、到什麼時候」—— 那是渲染用的提示，不是權威。權威在伺服器。
- 前端**沒有** `@supabase/supabase-js`，也沒有 anon key。Supabase 只用來跑 OAuth 跳轉。

## 資料庫

**全新資料庫 = 套用 `supabase/migrations/20260601000000_baseline.sql`（單一 squash baseline，就這一個檔）。**

這支 baseline 是 2026-07-16 用 `supabase db dump --schema public` 從正式庫匯出、並逐物件對過 pg_catalog 的**完整當前 schema**（已把所有 migration 的累積結果摺疊在內；末尾手動補回 `--schema public` 會漏掉的 `ensure_rls` event trigger）。23 支本地增量 migration 已 squash 進它並移除（git 歷史保留）；正式庫的 migration ledger（34 筆歷史）則用 `docs/SUPABASE.md` 的 runbook `migration repair` 收斂成這一支。

**角色**：只有 `service_role`。`anon` 和 `authenticated` 對 public schema 的所有權限已於 2026-07-14 撤銷（連 default privileges 一起，不然新表會被自動重新授權）。要開放資料給前端，**加 API endpoint，不要開資料表權限**。

## 測試

```bash
npm test                  # vitest
npm run verify:release    # test + build + encoding + launch-readiness
```

- 純函式與伺服器端邏輯：node 環境，佔絕大多數。
- React hook：檔頭加 `// @vitest-environment jsdom`，用 `@testing-library/react` 的 `renderHook`。
- 整頁元件測試：`App.test.tsx`（桌面）與 `App.mobile.test.tsx`（手機）透過 `appTestHarness` mount 真的 `<App/>`，只 fake fetch 與 jsdom 缺的瀏覽器 API —— 攔得住「type-check 過、build 過、單元測試全綠，但 UI 壞掉」的改動。

## 已知的技術債

- `App.tsx` 約 1,470 行。自成一體的 concern 都已抽成 hook（`useToast`、`useThemeMode`、`useIsMobileLayout`、`useArchivedGroups`、`useGroupRoute`、`useAuthSession`，以及雲端 mutation / composer 狀態的 `useActionGuard`／`useCloudActivities`／`useExpenseComposer`／`useGroupMutations`／`useMemberMutations`／`useInviteFlow`）；留在檔內的是純渲染與 render-衍生狀態緊耦合的少數 handler。
- `docs/` 其餘文件年代不一，讀之前先確認。
