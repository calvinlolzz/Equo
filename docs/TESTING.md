# Equo 算好 測試流程

## 1. 自動化測試

```bash
npm test             # Vitest 全套單元測試
npm run build        # 型別檢查 + 產出 bundle
npm run verify:release   # test + build + 打包內容檢查 + 編碼檢查 + launch readiness
```

`verify:release` 是發佈前的必跑關卡，任何一項失敗都不應部署。

## 2. 手動驗收（正式站或 preview）

### 登入

1. 開啟 <https://equo-mu.vercel.app>，未登入時只會看到登入牆（置中 Logo、「使用 Google 登入」按鈕）。
2. 點「使用 Google 登入」，完成 Google 授權後應自動回到 App 並進入群組畫面。
3. 重新整理頁面，session 應保持登入狀態。

### 群組與成員

1. 建立新群組，輸入群組名稱與成員。
2. 產生邀請連結，用另一個帳號開啟連結加入群組。
3. 確認成員列表顯示正確、頭像正常。

### 支出與分攤

1. 新增一筆均分支出，確認每人分攤金額正確。
2. 新增指定金額 / 比例 / 份數的支出，確認分攤結果。
3. 編輯與刪除支出，確認餘額即時更新。

### 餘額與結算

1. 開啟餘額頁，確認每位成員的應收 / 應付正確。
2. 查看結算建議，確認轉帳筆數最少且金額吻合。

### 行動版

1. 以手機寬度（375 / 390 / 430px）檢查：登入牆、底部導覽、新增支出 bottom sheet。
2. 確認 bottom sheet 可下滑關閉、深色模式下文字清楚。

### 登出

1. 登出後應回到登入牆，重新整理仍維持未登入狀態。

## 3. 正式站煙霧測試（腳本）

```bash
# 需先設定 EQUO_BASE_URL，例如 https://equo-mu.vercel.app
npm run smoke:production:web    # 首頁 shell、登入牆與路由規則
npm run smoke:production        # API 基本行為（未帶認證時的回應）
npm run smoke:production:all    # 以上全部
```

帶認證的 API 煙霧測試需要 `EQUO_GOOGLE_ID_TOKEN`（見 `scripts/smoke-production-api.py`）。
