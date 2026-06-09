# Supabase 接入指南

## 目標

目前 Equo 使用瀏覽器本機資料，適合展示原型。接上 Supabase 後，才能支援真實用戶測試：

- 跨裝置登入
- 多人群組同步
- 真實邀請成員
- 支出、結算、付款紀錄雲端保存
- Row Level Security 權限控管

## 建立 Supabase 專案

1. 到 Supabase 建立新 project。
2. Project name 建議：`equo`
3. Region 選離主要用戶近的區域。
4. Database password 請保存好，不要提交到 GitHub。

## 建立資料表

1. 進入 Supabase Dashboard。
2. 打開 SQL Editor。
3. 貼上並執行：

```text
supabase/schema.sql
```

此 schema 會建立：

- profiles
- groups
- group_members
- expenses
- expense_splits
- settlements
- payment_records
- recurring_bills
- notifications

也會開啟 Row Level Security。

## 取得前端設定

到 Supabase Project Settings > API，取得：

- Project URL
- anon public key

## 設定 Vercel 環境變數

在 Vercel 專案設定中加入：

```text
SUPABASE_URL=你的 Project URL
SUPABASE_ANON_KEY=你的 anon public key
```

重新部署後，App 的「我的 > 雲端同步」會從「本機」變成「雲端」。

## 後續開發順序

1. Auth：把原型登入替換成 Supabase Auth。
2. Profiles：登入後建立/讀取 profiles。
3. Groups：群組建立寫入 Supabase。
4. Members：邀請成員與角色權限寫入 group_members。
5. Expenses：支出與分攤寫入 expenses / expense_splits。
6. Settlements：結算結果寫入 settlements。
7. Payments：付款紀錄寫入 payment_records。
8. Notifications：待辦提醒寫入 notifications。

## 注意

anon key 可以放前端，但 service role key 絕對不能放前端或 GitHub。

