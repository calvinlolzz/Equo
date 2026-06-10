# Apple / Google 登入設定

## 目前狀態

App 內已經有 Apple / Google 登入入口，Email 登入可先作為正式測試用入口。

Google 登入已完成正式站設定，測試結果可正常從 `https://equo-mu.vercel.app` 跳到 Google 帳號選擇頁。

Apple 登入尚未啟用。後續需要 Apple Developer 帳號，並到 Apple Developer 與 Supabase 兩邊完成設定。

## 正式站資訊

- 正式站網址：`https://equo-mu.vercel.app`
- Supabase 專案：`cmfgptuzbayzdrxuoapm`
- Supabase 回呼網址：

```text
https://cmfgptuzbayzdrxuoapm.supabase.co/auth/v1/callback
```

## Supabase URL 設定

Supabase Dashboard > Authentication > URL Configuration：

```text
Site URL:
https://equo-mu.vercel.app

Redirect URLs:
https://equo-mu.vercel.app
https://equo-mu.vercel.app/
https://cmfgptuzbayzdrxuoapm.supabase.co/auth/v1/callback
```

## Google Provider

需要到 Google Cloud Console 建立 OAuth Client：

- Application type：Web application
- Authorized JavaScript origins：

```text
https://equo-mu.vercel.app
```

- Authorized redirect URIs：

```text
https://cmfgptuzbayzdrxuoapm.supabase.co/auth/v1/callback
```

建立後把以下資料填到 Supabase > Authentication > Providers > Google：

- Client ID
- Client Secret

## Apple Provider

需要 Apple Developer 帳號，並建立 Sign in with Apple 設定：

- Services ID
- Team ID
- Key ID
- Private Key

Apple 的 Return URL 使用：

```text
https://cmfgptuzbayzdrxuoapm.supabase.co/auth/v1/callback
```

建立後把 Apple Provider 需要的資料填到 Supabase > Authentication > Providers > Apple。

## 測試方式

1. 先確認 Email 登入可正常使用。
2. 開啟 Google Provider 後，按「使用 Google 登入」。
3. 完成 Google 授權後，應回到 `https://equo-mu.vercel.app`。
4. 進入「我的」頁，確認狀態顯示雲端同步可用。
5. Apple Provider 完成後用同樣流程測試。

## 使用者畫面原則

App 畫面不顯示 Supabase、OAuth、Provider、Client ID 等技術字眼。這些內容只保留在文件與開發設定中。
