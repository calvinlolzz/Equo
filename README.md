# FloatPay 分帳 App 原型

這是一個可展示的分帳 App 網頁原型，風格採 iOS 液態毛玻璃設計。現階段使用單一 `index.html` 實作，方便快速預覽、修改與部署成免費網頁版。

## 目前功能

- Apple / Google / Email 原型登入
- 群組建立、群組設定、群組預算
- 成員管理與角色權限：擁有者、管理員、家長、成員、子女、訪客
- 支出新增、AI 文字記帳、AI 發票辨識模擬
- 平均分攤、指定成員分攤、多幣別換算
- 自動最佳化結算
- 一鍵付款、確認收款、付款紀錄
- LINE 分享摘要
- 固定帳單產生
- 首頁待辦提醒與已讀
- 統計分析、群組分析、成員墊付排行
- Excel CSV 匯出、PDF HTML 報表匯出
- 本機資料備份與重設
- 夜間模式

## 試用方式

目前可用本機伺服器開啟：

```bash
python -m http.server 4173 --bind 127.0.0.1
```

瀏覽器打開：

```text
http://127.0.0.1:4173/index.html
```

## 資料儲存

目前資料存在瀏覽器 `localStorage`，適合展示與早期原型測試。

不適合正式多人測試，原因：

- 換裝置資料不會同步
- 群組邀請不會真的多人共用
- 清除瀏覽器資料會遺失

正式用戶測試建議下一階段接：

- Firebase：最快接登入、Firestore、Storage、通知
- Supabase：適合正式資料模型、SQL 查詢與報表

## 上線建議

可先部署為網頁版試用：

- Vercel
- Netlify
- GitHub Pages
- Cloudflare Pages

之後再依用戶回饋決定是否包成 iOS / Android App。

## 下一步

1. 整理專案結構
2. 初始化 Git
3. 上傳 GitHub
4. 部署免費網頁版
5. 接 Firebase 或 Supabase 做多人資料同步

## 文件

- 產品規劃：[docs/分帳APP產品規劃.md](docs/分帳APP產品規劃.md)
- 部署規劃：[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

