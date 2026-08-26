# Equo 算好

Equo 是一個手機優先的分帳 Web App：建立群組、記錄支出、多種分攤方式、自動計算餘額與最少轉帳的結算建議。

正式站：<https://equo-mu.vercel.app>

## 功能

**記帳與分帳**

- 支出記錄：均分、指定金額、比例、份數等分攤方式
- 群組餘額與最少轉帳結算建議；一鍵標記清償，清償紀錄查得到整段歷史
- **收款資訊**：每位成員可填銀行末五碼／LINE Pay／付款連結，要付錢的人在清償建議上直接看到並複製
- 循環支出：每月自動把規則變成真的帳（每晚排程產生）
- 多幣別，餘額依幣別分開計算；匯率每日更新，後台可手動覆寫
- 記錄搜尋與篩選由伺服器執行，搜得到整段歷史（不只已載入的那頁）
- 分析頁：時間區段統計（每年／每月）、分類佔比、個人／群組切換、**跟上個月比多花／少花多少**
- **每月預算**：設一個數字，分析頁顯示用掉多少、還剩多少、超支多少（選填，群主設定）
- **一筆支出最多 5 張收據**，詳情頁可左右翻看
- **留言**：在一筆支出底下討論「這筆是誰付的」，會推播給群組其他人；自己的留言可以收回（群主可以收回任何一則）
- CSV 匯出

**群組**

- Google 登入牆（Supabase OAuth redirect，無訪客模式）
- 群組建立、邀請連結／QR 加入、成員管理與頭像
- 虛擬成員（沒有帳號也能被記帳、被分攤）
- 群組列表直接顯示自己的餘額（應收／應付／已結清）與跨群組總覽
- 群組封面與圖片上傳（Supabase Storage）
- 封存與還原

**通知**

- 推播：新增支出、有人加入群組、被提醒還款、支出被留言（**用收件裝置自己的語言**）
- 提醒還款：對欠款成員發推播，每位收款對象有 6 小時冷卻（`group_nudges`）
- 自動催繳：欠款超過設定天數自動提醒欠款的人（不具名、與手動催繳共用冷卻）。**預設關閉**，在 `/admin` 開啟
- 站內通知收件匣：已讀管理、自行刪除、已讀七天後自動清理

**收據**

- AI 辨識自動填入金額與店名（首次掃描需明確同意，可在個人資料關閉）
- 一筆支出可以掛多張（上限 5 張，見 [docs/OPERATIONS.md](docs/OPERATIONS.md)）
- 從系統分享選單直接把收據送進記帳流程（Web Share Target）

**行動裝置**

- PWA：可安裝、離線可開，未讀數上主畫面圖示
- **離線寫入佇列**：斷線時記的帳排進佇列，回線自動送出（以 `client_request_id` 冪等，不會重複記帳）
- 日間／夜間主題
- **繁體中文／English**：跟著瀏覽器語言自動選，也可以在個人資料手動切換
- 底部導覽、bottom sheet 操作、側滑編輯、液態毛玻璃視覺

**帳號**

- 隱私權政策與服務條款（在 app 內，個人資料頁；英文版是便利翻譯，中文版為準）
- 自助刪除帳號（脫鉤匿名化：其他人的餘額不受影響）

## 後台（`/admin`）

需要 `app_admins` 授權，分 owner／admin／support 三種角色。

- 總覽：使用者／群組／記帳量、成長趨勢圖、**世代留存**、待辦收件匣
- 系統健康：備份、每晚排程任務的心跳、錯誤量、限流、儲存空間
- 使用者與群組查詢、停用／封存／軟刪除、CSV 匯出
- 客服操作：改帳目、轉移群主、合併帳號、匯出或刪除某人的資料
- 回饋與前端錯誤（依 fingerprint 分組、可標記處理完成）
- 站內通知發送
- 收據辨識：緊急開關、切換模型、**用量與估算花費**
- 自動催繳：開關與天數設定（預設關閉）
- 主資料：分類、幣別、匯率覆寫
- **站台公告與維護模式**：公告顯示給所有人（含登入頁）；維護模式只擋寫入，讀取照常，後台不受影響
- **以使用者身分唯讀檢視**：重現「我的餘額不對」；伺服器端擋寫入，15 分鐘到期，會寫稽核記錄
- 稽核記錄

## 技術棧

- 前端：React 19 + TypeScript + Vite（`apps/web`）
- API：單一 Vercel Function `api/v1/[...path].ts` → `vercel-api/v1Handler.ts` → `apps/web/src/server`（routes → handlers → repositories）
- 資料庫：Supabase Postgres（server 端以 service role 經 REST 存取；多語句寫入走交易式 RPC）
- 認證：Supabase OAuth（Google）換發 Equo 自簽 session cookie（`equo_session`）
- 排程：GitHub Actions 每晚跑備份、資料保留清理、循環支出產生；Vercel Cron 每天跑自動催繳（見 [docs/OPERATIONS.md](docs/OPERATIONS.md)）
- 測試：Vitest 三層——純函式／伺服器邏輯（node）、hook 測試、整頁元件測試（jsdom + Testing Library，mount 真的 `<App/>`）

## 開發

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

發佈前完整驗證（測試 + build + 靜態檢查）：

```bash
npm run verify:release
```

正式站煙霧測試（需 `EQUO_BASE_URL`）：

```bash
npm run smoke:production:all
```

## 專案結構

```
api/                  Vercel Function 進入點
vercel-api/           v1 API handler（轉接到 apps/web/src/server）
apps/web/src/app/     前端 SPA（App.tsx 為主畫面，AdminApp.tsx 為後台）
apps/web/src/server/  API routes、handlers、repositories、auth
apps/web/src/domain/  金額與結算領域邏輯
apps/web/src/contracts/  API 型別與請求驗證
supabase/migrations/  依序套用；最舊的一支是 squash 後的 baseline（見 docs/SUPABASE.md）
scripts/              release 驗證與煙霧測試腳本
.github/workflows/    CI 與每晚的備份／保留／循環支出排程
docs/                 部署、OAuth、Supabase、測試、營運等文件
```

## 相關文件

- [docs/TECH_STACK.md](docs/TECH_STACK.md) — 目前實際的架構
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — 部署流程與環境變數
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — 備份、資料保留、排程心跳、錯誤告警、推播健康、額度、自動催繳、監控
- [docs/OAUTH.md](docs/OAUTH.md) — Google / Supabase OAuth 設定
- [docs/SUPABASE.md](docs/SUPABASE.md) — 資料庫說明
- [docs/TESTING.md](docs/TESTING.md) — 測試流程
- [docs/claude_continuation_handoff.md](docs/claude_continuation_handoff.md) — **歷史交接快照（2026-07-04，大部分已失效）**，只留決策出處；現況看上面幾份
- `docs/SDD.md` 與 `docs/Equo_功能規格_MVP.md` — **規劃型歷史文件，不是現況**
