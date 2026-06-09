# Equo 算好 分帳 App 原型

Equo 算好是一個分帳 App 網頁原型，設計方向為 iOS 液態毛玻璃風格。現階段使用單一 `index.html` 實作，方便快速預覽、修改與部署成免費網頁版。

## 目前功能

- Apple / Google / Email 登入入口原型
- 群組建立、群組設定、成員與家庭權限
- 新增支出、分帳成員選擇、多幣別換算
- 結算建議、付款狀態、確認收款與提醒
- 固定帳單、防重複產生、付款紀錄
- 月報表、分類分析、成員排行
- CSV / HTML 報表匯出與本機資料備份
- 夜間模式與 iOS 風格底部導覽
- Vercel 靜態部署設定
- Supabase 資料庫結構草稿

## 本機預覽

```bash
python -m http.server 4173 --bind 127.0.0.1
```

開啟：

```text
http://127.0.0.1:4173/index.html
```

## 資料狀態

目前 App 先使用瀏覽器 `localStorage` 保存展示資料。這適合產品展示、流程測試與早期用戶訪談。

若要讓真實用戶跨裝置同步資料，下一步會接 Supabase：

- Supabase Auth：登入與使用者身分
- PostgreSQL：群組、支出、分帳、付款紀錄
- Row Level Security：不同群組與角色的資料權限
- Storage：未來可放發票或收據圖片

## 部署

目前選定路線：

1. GitHub 保存原始碼
2. Vercel 部署免費網頁版
3. Supabase 作為多人測試資料庫

詳細步驟請看 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) 與 [docs/SUPABASE.md](docs/SUPABASE.md)。
