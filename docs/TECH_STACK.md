# Equo 算好技術棧決策

本文件依據 `docs/Equo 算好設計優化建議書.md` 整理。核心原則不是增加功能，而是讓使用者用最少步驟完成分帳：先新增支出、確認誰該付誰、再分享結算。

版本：1.0
狀態：已採用
適用階段：PWA 試用版、真實用戶小規模測試、Vercel 免費網頁版

## 產品技術定位

Equo 目前採用「手機優先的 PWA」策略：

- 手機版是主產品，預估 90% 使用情境發生在手機。
- 網頁版是展示、試用、桌面管理與匯出入口。
- 使用者不必先登入；只有備份、跨裝置、邀請真實成員時才要求登入。
- 支出、結算與分享是第一優先；報表、家庭模式、自動化是進階功能。

## 技術棧總覽

| 層級 | 技術 | 用途 |
| --- | --- | --- |
| 前端 | HTML / CSS / Vanilla JavaScript | 單頁 PWA、手機版互動、快速產品驗證 |
| 視覺系統 | CSS custom properties + liquid glass styles | 毛玻璃卡片、bottom sheet、夜間模式、手機優先版面 |
| 本機資料 | `localStorage` | 免登入試用、展示資料、離線草稿、快速回訪 |
| 雲端資料 | Supabase Auth + PostgreSQL + RLS | 登入、備份、多人群組、邀請、支出與結算資料 |
| API | Vercel Serverless Function | 提供前端 Supabase public config，不把敏感資訊寫進 HTML |
| 部署 | GitHub + Vercel | 版本控管、免費網頁版、自動部署 |
| PWA | `site.webmanifest` + `sw.js` | 手機桌面安裝、靜態資源快取 |
| 文件 | `docs/SDD.md` / `docs/SUPABASE.md` / `docs/TECH_STACK.md` | 產品流程、資料流、技術決策 |

## 技術選型結論

### 目前採用

- **Vanilla HTML/CSS/JS**：保留現有單頁 App，先把使用者流程打磨到能測試。
- **Supabase**：作為多人測試資料庫與登入系統，避免自建後端過早增加維運成本。
- **Vercel**：作為免費網頁版與 API config 入口，適合快速部署與分享測試。
- **PWA**：先讓手機用戶可直接開網頁或加到桌面，不先投入原生 App。

### 暫不採用

- **React / Next.js 重寫**：現在重寫會中斷既有流程，先等核心流程與真實測試穩定。
- **原生 iOS / Android App**：目前產品還在驗證流程，PWA 足夠支援早期試用。
- **完整付款串接**：目前以分享結算與付款狀態為主，真正金流等需求明確再做。
- **複雜狀態管理框架**：現階段資料量小，先用清楚的 state helpers 與 render functions 控制。

## 目前架構

```text
index.html
  UI markup：首頁、群組、統計、我的、各種 sheet
  CSS design system：liquid glass、dark mode、mobile layout
  App state：groups、users、expenses、settlements、payments
  Local persistence：localStorage load/save
  Supabase client calls：auth、profiles、groups、members、expenses
  Rendering functions：renderHome、renderGroup、renderStats、renderPayments
  Interactions：open sheet、submit forms、copy/share、theme toggle

api/config.js
  Reads Vercel environment variables.
  Returns Supabase public config to browser.

supabase/migrations/
  The schema, in order. Tables (users, groups, group_members, expenses,
  expense_payments, expense_shares, invites, settlements, client_requests),
  the transactional write RPCs, the admin_console_* reporting functions,
  and Row Level Security.

sw.js
  Caches static files for PWA behavior.
  Version must bump when index.html or manifest behavior changes.
```

目前 `index.html` 承載太多責任，但短期仍保留單檔架構，原因是現階段優先目標是驗證產品流程，而不是重寫技術框架。

## 資料策略

### 未登入

未登入使用者使用本機資料：

- 儲存在 `localStorage`。
- 可建立群組、成員、支出與結算。
- 可匯出與重設資料。
- 不保證跨裝置同步。

目的：降低首次使用門檻，符合「不用登入也能先算」的產品定位。

### 已登入

已登入使用者使用 Supabase：

- Auth 建立使用者身分。
- Profiles 保存個人資料、頭像與偏好。
- Groups / Members 保存群組與權限。
- Expenses / Splits 保存支出與分攤。
- Settlement statuses 保存付款與收款確認。
- RLS 控制不同群組與角色能看到的資料。

目的：支援真實用戶測試、多人同步、邀請成員與跨裝置使用。

### 展示資料

展示資料只應存在本機試用模式。登入後如果雲端沒有資料，應顯示乾淨空狀態，不自動載入展示資料。

## 前端分層規則

短期仍在 `index.html` 內維護，但開發時要按責任區分：

1. **State**：只處理資料陣列與目前選取狀態。
2. **Persistence**：只處理 `localStorage` 與 Supabase 讀寫。
3. **Rendering**：只把資料轉成畫面，不直接做雲端寫入。
4. **Interactions**：只處理點擊、表單送出、sheet 開關。
5. **Business rules**：金額四捨五入、分攤、結算、權限判斷要集中，不散在 UI 字串中。

後續拆檔時也沿用這五個責任。

## 部署策略

```text
GitHub main
  -> Vercel production deployment
  -> /api/config exposes Supabase public config
  -> Browser loads index.html
  -> App chooses localStorage or Supabase based on login state
```

部署規則：

- `SUPABASE_URL` 與 `SUPABASE_ANON_KEY` 放 Vercel env。
- Supabase service role key 不得放前端、GitHub 或 Vercel public env。
- 每次改 `index.html` 行為後要更新 `sw.js` cache name。
- 用本機 HTTP server 驗證，不用 `file://`。

## 測試策略

目前沒有大型自動化測試框架，短期採用「命令檢查 + 瀏覽器流程驗證」：

- `git diff --check`：檢查空白與 patch 格式。
- 本機 HTTP server：確認頁面可載入。
- 手機寬度驗證：首頁、群組、新增支出、我的、bottom sheet。
- 夜間模式驗證：底部導覽、sheet、主要按鈕、進階區。
- 雲端流程驗證：登入、建立群組、成員、支出、結算狀態。

未來如果重構成模組化 JS，才補單元測試與端到端測試。

## 改良順序

### 第一階段：主流程收斂

目標：讓第一次使用者清楚知道下一步。

- 首頁只強化「新增支出」、「建立群組」、「查看結算」。
- 空狀態改成下一步操作，不只顯示 `$0`。
- 新增支出維持手動最短路徑，更多設定收合。
- 分享結算文案保持白話，可直接貼到 LINE。

### 第二階段：資訊架構整理

目標：降低設定頁與進階功能干擾。

- 「我的」拆成帳號、偏好、資料管理、進階功能。
- 報表、付款、家庭模式、自動化維持可用，但降低第一眼權重。
- 技術或測試用語不出現在一般用戶介面。

### 第三階段：信任與資料安全

目標：讓真實用戶知道資料放在哪、何時需要登入。

- 明確說明「此裝置資料」與「登入備份」差異。
- 隱私、匯出、刪除資料放在資料管理區。
- Supabase RLS 與邀請權限持續保留為雲端正式版基礎。

### 第四階段：差異化能力

目標：在核心流程穩定後，再放大 AI 與自動化。

- AI 記帳作為新增支出的快速輸入方式。
- 發票掃描作為輸入方式，不是獨立流程。
- 多幣別旅遊模式與室友固定帳單按情境逐步加強。

## 重構門檻

符合以下任一條件，才開始拆檔或評估框架：

- 真實測試者穩定使用，且核心流程不再頻繁變動。
- `index.html` 修改一個功能時經常影響三個以上區域。
- Supabase 資料流需要更多錯誤恢復、離線合併或背景同步。
- 需要多人協作開發。
- 需要正式加入自動化測試與 CI。

## 後續重構方向

第一步不是直接換框架，而是先拆出靜態資產：

```text
assets/css/base.css
assets/css/components.css
assets/css/mobile.css
assets/css/dark.css

assets/js/state.js
assets/js/storage.js
assets/js/supabase-client.js
assets/js/calculations.js
assets/js/render-home.js
assets/js/render-group.js
assets/js/interactions.js
```

拆檔後若維護需求仍增加，再評估：

- Vite + Vanilla JS：最低遷移成本。
- Vite + React：適合元件化 UI 與多人維護。
- Next.js：只有在需要正式路由、SSR、SEO、後台頁面時才採用。

## 驗收標準

- 新用戶不用登入即可建立群組或新增支出。
- 首頁第一眼只看到清楚的下一步，不被進階功能干擾。
- 手機 375px 寬度可完整操作新增支出、群組、結算分享。
- 夜間模式下底部導覽、sheet、主要按鈕都有足夠對比。
- 登入只在備份、邀請、跨裝置時成為必要入口。

## 目前最適合的下一步

技術棧確定後，下一個工程步驟應該是：

1. 先完成主流程 UI 收斂，不再新增第三優先功能。
2. 將 `index.html` 內的資料計算規則整理到同一區域，避免 UI 與分帳規則混在一起。
3. 補一份「手動測試清單」，固定每次提交前檢查手機、夜間模式、建立群組、新增支出、分享結算。
4. 等真實測試穩定，再進入 JS/CSS 拆檔。
