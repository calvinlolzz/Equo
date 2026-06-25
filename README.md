# Equo 算好

Equo 是一個分帳 App 正式站專案，前台提供手機優先的分帳體驗，後台提供營運與資料檢查入口。專案目前以靜態前端、Vercel 部署與 Supabase 雲端資料庫為核心。

## 目前功能

- Email 登入與雲端同步入口
- 群組、成員、支出、分攤與結算
- 邀請連結與成員角色
- 手機版底部導覽與新增支出流程
- 夜間模式與液態毛玻璃視覺
- CSV / HTML 匯出
- 付款紀錄、固定帳單與提醒
- 後台管理入口 `/admin`
- Supabase RLS 資料保護
- 前台 / 後台錯誤紀錄
- 用戶問題與建議回饋入口

## 預覽

本機前台：

```bash
python -m http.server 4173 --bind 127.0.0.1
```

```text
http://127.0.0.1:4173/index.html
```

本機後台頁面：

```text
http://127.0.0.1:4173/admin.html
```

正式站後台路徑：

```text
/admin
```

## 技術棧

- Frontend：單檔 HTML / CSS / JavaScript
- Hosting：Vercel
- Auth：Supabase Auth
- Database：Supabase PostgreSQL
- Security：Row Level Security
- PWA：Service Worker 與 manifest

詳細內容請看 [docs/TECH_STACK.md](docs/TECH_STACK.md)。

## Supabase

正式資料表與後台管理員設定請看 [docs/SUPABASE.md](docs/SUPABASE.md)。

必要環境變數：

```text
SUPABASE_URL=你的 Project URL
SUPABASE_ANON_KEY=你的 anon public key
```

後台管理員需要先建立 Supabase Auth 帳號，再加入 `app_admins`。

## 部署

1. GitHub 儲存專案。
2. Vercel 連接 GitHub repo。
3. Vercel 設定 Supabase 環境變數。
4. Supabase SQL Editor 執行 `supabase/schema.sql`。
5. 將管理員帳號加入 `app_admins`。

部署說明請看 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## 測試

測試重點：

- 前台登入、登出與資料同步
- 建立群組、成員、支出與結算
- 邀請連結加入群組
- 手機版新增支出流程
- 夜間模式與底部導覽可讀性
- 後台 `/admin` 權限保護
- 後台總覽資料是否來自 Supabase
- 後台系統頁是否能看到最近錯誤紀錄
- 後台紀錄頁是否能看到用戶回饋

詳細測試請看 [docs/TESTING.md](docs/TESTING.md)。

## 產品文件

- [docs/SDD.md](docs/SDD.md)
- [docs/equo_sdd_v2.html](docs/equo_sdd_v2.html)
- [docs/Equo 算好設計優化建議書.md](docs/Equo%20算好設計優化建議書.md)
