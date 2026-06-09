# 部署與資料庫接入規劃

## 第一階段：免費網頁版

目前是純靜態網站，可直接部署：

- GitHub Pages：適合公開展示與快速分享
- Vercel：適合之後升級成 React / Next.js
- Netlify：適合靜態網站與表單整合
- Cloudflare Pages：適合全球 CDN 與免費流量

目前決策：使用 Vercel + Supabase。

## GitHub Pages

1. 建立 GitHub repository。
2. 推送本專案。
3. 到 repository Settings > Pages。
4. Source 選 `Deploy from a branch`。
5. Branch 選 `main`，資料夾選 `/root`。
6. 等待 GitHub 產生網址。

## Vercel

1. 登入 Vercel。
2. Import GitHub repository。
3. 選擇 `calvinlolzz/Equo`。
4. Framework Preset 選 `Other`。
5. Build command 留空。
6. Output directory 留空。
7. 在 Environment Variables 加入：

```text
SUPABASE_URL
SUPABASE_ANON_KEY
```

8. 部署後取得測試網址。

## 第二階段：線上資料庫

正式用戶測試不建議使用 localStorage。目前決策：Supabase。

### Firebase

適合快速 MVP：

- Firebase Auth：Apple / Google / Email 登入
- Firestore：群組、支出、結算資料
- Firebase Storage：發票照片
- Firebase Cloud Messaging：付款提醒

### Supabase

適合正式資料結構：

- Supabase Auth：登入
- PostgreSQL：使用者、群組、支出、分攤、付款紀錄
- Row Level Security：群組權限
- Storage：發票照片
- Edge Functions：結算、提醒、AI 處理

## 建議資料表

- users
- groups
- group_members
- expenses
- expense_splits
- settlements
- payment_records
- recurring_bills
- notifications

## 遷移順序

1. 把 localStorage 存取包成資料層函式。
2. 建立 Auth。
3. 建立 groups / group_members。
4. 遷移 expenses / expense_splits。
5. 遷移 settlements / payment_records。
6. 加入 Storage 與發票照片。
7. 加入通知與排程。
