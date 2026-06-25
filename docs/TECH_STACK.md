# Equo 算好技術棧與改良路線

本文件依據 `docs/Equo 算好設計優化建議書.md` 整理。核心原則不是增加功能，而是讓使用者用最少步驟完成分帳：先新增支出、確認誰該付誰、再分享結算。

## 產品技術定位

Equo 目前採用「手機優先的 PWA」策略：

- 手機版是主產品，預估 90% 使用情境發生在手機。
- 網頁版是展示、試用、桌面管理與匯出入口。
- 使用者不必先登入；只有備份、跨裝置、邀請真實成員時才要求登入。
- 支出、結算與分享是第一優先；報表、家庭模式、自動化是進階功能。

## 目前技術棧

| 層級 | 技術 | 用途 |
| --- | --- | --- |
| 前端 | HTML / CSS / Vanilla JavaScript | 單頁 PWA 原型與手機版互動 |
| 視覺 | iOS liquid glass 風格 CSS | 毛玻璃卡片、bottom sheet、夜間模式 |
| 本機資料 | `localStorage` | 免登入試用、展示資料、離線草稿 |
| 雲端資料 | Supabase Auth + PostgreSQL | 登入、備份、多人群組、支出與結算資料 |
| 部署 | Vercel | 免費網頁版與 API config |
| PWA | `site.webmanifest` + `sw.js` | 安裝到手機桌面與靜態快取 |
| 文件 | `docs/SDD.md` / `docs/SUPABASE.md` | 產品流程、資料流與雲端接入 |

## 目前架構

```text
index.html
  UI markup
  CSS design system
  App state
  Local persistence
  Supabase client calls
  Rendering functions
  Sheet and form interactions

api/config.js
  Reads Vercel environment variables
  Returns Supabase public config to browser

supabase/schema.sql
  Defines profiles, groups, members, expenses, settlements, payments
  Enables Row Level Security
```

目前 `index.html` 承載太多責任，但短期仍保留單檔架構，原因是現階段優先目標是驗證產品流程，而不是重寫技術框架。

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

## 後續重構方向

當真實測試資料與流程穩定後，再評估重構：

1. 將 `index.html` 拆成 `app.js`、`state.js`、`supabase-client.js`、`renderers.js`。
2. 將 CSS 拆成 `base.css`、`components.css`、`mobile.css`、`dark.css`。
3. 若多人維護或功能快速擴張，再評估 Vite / React / Next.js。
4. 不在核心流程尚未穩定前重寫框架，避免把時間花在遷移而不是產品驗證。

## 驗收標準

- 新用戶不用登入即可建立群組或新增支出。
- 首頁第一眼只看到清楚的下一步，不被進階功能干擾。
- 手機 375px 寬度可完整操作新增支出、群組、結算分享。
- 夜間模式下底部導覽、sheet、主要按鈕都有足夠對比。
- 登入只在備份、邀請、跨裝置時成為必要入口。
