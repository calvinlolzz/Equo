# Apple / Google 登入設定

## 目前狀態

登入牆是硬性的：沒有有效 session 就只看得到 `LoginScreen`，上面**只有兩顆按鈕**——「使用 Google 登入」（可用）與「使用 Apple 登入」（`aria-disabled`，點了只跳「即將推出」）。**沒有 Email 登入**，也沒有訪客模式。

Google 登入已完成正式站設定，可正常從 `https://equo-mu.vercel.app` 跳到 Google 帳號選擇頁。

Apple 登入尚未啟用。後續需要 Apple Developer 帳號，並到 Apple Developer 與 Supabase 兩邊完成設定。

> 先前這裡寫「Email 登入可先作為正式測試用入口」是錯的——這個入口從來不存在（`LoginScreen.tsx`
> 只有上述兩顆按鈕，伺服器也只有 `authGoogleRoute`／`authSupabaseRoute` 兩條 auth 路由）。

## 實際登入流程

1. 前端把瀏覽器整頁導向 Supabase：`{VITE_SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to={origin}`
   （見 `supabaseOAuth.ts` 的 `buildAuthorizeUrl`）。**前端沒有任何 Supabase key**，這是純跳轉。
2. Supabase 跑完 Google 同意流程，帶著 `#access_token=...` 導回來（implicit flow，無 PKCE）。
3. App 開機時解析該 fragment（`parseOAuthFragment`），把 token 交給 `POST /api/v1/auth/supabase`，
   並立刻把 token 從網址列抹掉。
4. 伺服器驗證後簽**自己的** session，放在 HttpOnly 的 `equo_session` cookie；`localStorage`
   只留「誰登入、到何時」的提示，**不存 token**。

（早期用 Google Identity Services（GIS）在瀏覽器直接呼叫 Google 的做法已廢棄，不要復活。）

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
- Authorized redirect URIs（**這個才是關鍵**）：

```text
https://cmfgptuzbayzdrxuoapm.supabase.co/auth/v1/callback
```

> **Authorized JavaScript origins 不需要設**。那是給「瀏覽器直接呼叫 Google」的 GIS 流程用的，
> 而現行流程是整頁導向 Supabase、由 Supabase 去跟 Google 談——瀏覽器從頭到尾沒有直接接觸
> Google 的 JS SDK。設了也無害，但別把登入失敗歸咎於它。

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

1. 開啟 Google Provider 後，在登入牆按「使用 Google 登入」。
2. 完成 Google 授權後，應回到 `https://equo-mu.vercel.app`，且**網址列不該殘留 `#access_token`**。
3. 確認已進入 app：有群組的人會直接落在最近的那個群組，沒有群組的人看到建立/加入群組的起始流程。
4. 點右上角頭像開啟個人資料對話框，確認顯示的是你的 Google 帳號。
5. Apple Provider 完成後用同樣流程測試。

## 使用者畫面原則

App 畫面不顯示 Supabase、OAuth、Provider、Client ID 等技術字眼。這些內容只保留在文件與開發設定中。
