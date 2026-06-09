# 部署與資料庫接入規劃

## 目前路線

Equo 算好目前採用：

- GitHub：保存專案原始碼
- Vercel：部署免費網頁版
- Supabase：後續提供登入、多人同步與線上資料庫

## Vercel 部署

1. 登入 Vercel。
2. Import Git Repository。
3. 選擇 `calvinlolzz/Equo`。
4. Framework Preset 選 `Other`。
5. Build Command 留空。
6. Output Directory 留空。
7. 先不填 Supabase 環境變數也可以部署；App 會維持本機資料模式。
8. 點選 Deploy。

完成後，Vercel 會產生一個 `*.vercel.app` 正式網址。之後每次推送 GitHub `main` 分支，Vercel 會自動重新部署。

## Supabase 環境變數

建立 Supabase 專案後，請在 Vercel Project Settings > Environment Variables 加入：

```text
SUPABASE_URL
SUPABASE_ANON_KEY
```

加入後需要重新部署一次，正式站才會讀到新的設定。

## Supabase 接入順序

1. 建立 Supabase 專案。
2. 在 SQL Editor 執行 `supabase/schema.sql`。
3. 開啟 Auth Provider。
4. 將 `SUPABASE_URL` 與 `SUPABASE_ANON_KEY` 放到 Vercel。
5. 將目前 `localStorage` 資料流程逐步改成 Supabase API。
6. 測試不同帳號、不同群組、不同家庭角色的資料權限。

## 交付狀態

目前 Vercel 部署可以先供用戶試用 App 原型。Supabase 尚未接上前，資料會留在使用者自己的瀏覽器裡，不會跨裝置同步。
