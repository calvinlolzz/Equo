# LINE 官方帳號素材（@100ujhjj）

2026-09-29 設定。HTML 是原稿，用 `render.mjs`（Playwright + 本機 Chromium）輸出 PNG 再轉 JPG 上傳。

2026-10 圖文選單與封面改版成極光配色，跟回覆卡片同一套深色風格：選單六格各有主色與發光圖示（按鈕名稱與動作沒變，見下表），封面左邊是標語、右邊是一張示意的記帳回覆卡。改圖後要重新到 OA Manager 上傳，程式不會自動同步。

| 檔案 | 用途 | 尺寸 | 上傳位置 |
|---|---|---|---|
| `avatar.jpg` | 大頭貼（LINE 會裁成圓形，logo 置中留白） | 1024×1024 | OA Manager → 帳號設定 → 編輯基本檔案（改後 1 小時內不能再改） |
| `cover.jpg` | 基本檔案背景圖（裁切框約 2:1） | 1600×800 | 同上 |
| `richmenu.jpg` | 圖文選單，大尺寸 3×2 版型 | 2500×1686 | OA Manager → 聊天室相關 → 圖文選單 |
| `link-hero.html` → `apps/web/public/assets/line/link-hero-v1.jpg` | 加好友／請連結帳號那張回覆卡片的橫幅（語言中性，2:1 cover） | 1024×512 | **不上傳 OA Manager**：`render.mjs` 直接輸出到 App 的 `public/assets/line/`，隨部署上線，網址 `/assets/line/link-hero-v1.jpg`；`/assets/*` 快取一年，換圖要改檔名（`-v2`），見 `docs/OPERATIONS.md` 第 18 節「回覆卡片」 |

狀態消息：「傳「早餐 60」就記好一筆帳」（上限 20 字）。

## 圖文選單動作（A–F，左上到右下）

| 區 | 按鈕 | 動作 |
|---|---|---|
| A | 本月收支 | 文字「本月」 |
| B | 記收入 | 連結 `https://line.me/R/oaMessage/@100ujhjj/?%E6%94%B6%E5%85%A5%20`（打開聊天框、預填「收入 」） |
| C | 開啟 Equo | 連結 `https://equo-mu.vercel.app/?openExternalBrowser=1`（外部瀏覽器；LINE 內建瀏覽器擋 Google 登入） |
| D | 復原上一筆 | 文字「復原」 |
| E | 使用說明 | 文字「說明」 |
| F | 連結帳號 | 文字「綁定」 |

選單列文字「記帳選單」、預設顯示、使用期間 2026/09/29–2036/12/31。所有好友看到同一份選單（OA Manager 建的選單無法依使用者切換；要分已連結／未連結需改用 Messaging API 的 per-user rich menu）。

## 回覆上的按鈕（不在 OA Manager 設定）

記帳卡上的「編輯／刪除」、每則回覆底下的 Quick Reply（復原、本月、明細、分析、說明…）和「確定刪除／取消」都是**程式在每次回覆時帶上去的**，OA Manager 與圖文選單都不用設定、也改不到。圖文選單的 D「復原上一筆」仍是送出文字「復原」。細節與 log 見 `docs/OPERATIONS.md` 第 18 節。

## LINE Login channel 與 LIFF app（在 LINE 裡開啟 Equo）

給記帳卡的「編輯」與 Quick Reply 的「明細」「分析」用：在 LINE 裡直接開，不經手機瀏覽器。**Messaging API channel（`2011782046`，機器人）與 LINE Login channel 必須在同一個 provider**，否則同一個人的 LINE user id 不同，綁定對不上（`[liff] exchange not_linked` 的 tag 和 webhook 的 tag 會不同）。開關、環境變數與真機清單見 `docs/OPERATIONS.md` 第 18 節「在 LINE 裡開啟（LIFF）」。

已建立（2026-11），設定如下（兩個 id 都不是祕密；**這裡不記錄、也不需要任何 channel secret 或 token**）：

| 項目 | 值 |
|---|---|
| Channel 類型 | LINE Login |
| Channel ID | `2011782032` |
| LIFF ID | `2011782032-WJwjePnJ` |
| Size | Full |
| Endpoint URL | `https://equo-mu.vercel.app/liff` |
| Scopes | 只有 `openid`（不要勾 `profile`、不要 email） |
| Add friend option | Off |
| Scan QR／Module mode | Off |
| 隱私權政策／服務條款 | `https://equo-mu.vercel.app/privacy`／`/terms`，圖示用 `avatar.jpg` |

Console 檢查清單（改過任何一項都回來對一次）：

- [ ] LINE Login channel 與 Messaging API channel 在**同一個 provider**
- [ ] LIFF app：Size = Full、Endpoint URL = `https://equo-mu.vercel.app/liff`（結尾不要加斜線或 query）
- [ ] Scopes 只有 `openid`；Add friend option = Off
- [ ] Channel 狀態 = **Published**（Developing 時只有 channel 管理員登入得了，其他好友會被擋）
- [ ] Vercel Production：`LINE_LIFF_ID` = `2011782032-WJwjePnJ`（`LINE_LOGIN_CHANNEL_ID` 只有前綴與 channel id 不同才要設）
- [ ] `LINE_LIFF_LINKS` **最後**才設為 `1`，且是在真機測試通過之後
- [ ] **Channel `2011782032` 只給這個 LIFF app 用**：這個 channel 裡不要再建別的 LIFF app，也不要加別的 LINE Login 網頁登入的 callback URL。同一個 channel 簽出來的 ID token `aud` 都一樣，我們的伺服器會一律接受；任何其他入口都等於多一條能換到 Equo 憑證的路。LINE Login 分頁的 callback URL 與 LIFF 清單應該只剩我們自己的 endpoint

LIFF 開啟的連結長這樣（OA Manager 與圖文選單都不用動，連結是程式在每次回覆時帶上去的）：

| 用途 | 網址 |
|---|---|
| 明細 | `https://liff.line.me/2011782032-WJwjePnJ?view=records` |
| 分析 | `https://liff.line.me/2011782032-WJwjePnJ?view=analysis` |
| 編輯一筆 | `https://liff.line.me/2011782032-WJwjePnJ?entry=<事件 id，冒號寫成 %3A>` |

圖文選單 C「開啟 Equo」與本月卡底部的「開啟帳本」**維持**開手機瀏覽器（它們要完整的 App，包括 Google 登入）。

## 文字指令（不在圖文選單上）

圖文選單維持上表 A–F 不變；下面這些直接在聊天室傳文字。

| 用途 | 指令範例 |
|---|---|
| 查看每月預算 | `預算`、`我的預算`、`budget` |
| 設定・修改每月預算 | `預算 15000`、`預算改 20000`、`budget 15000` |
| 取消每月預算 | `取消預算`、`budget off` |

`預算 0` 不會取消，會提示改傳「取消預算」；`預算 15000 餐飲` 這種像設定又不完全是的說法會回問是不是要設定預算，不會記成支出；`預算外 300`、`預算書 200` 這類真的項目名稱仍照一般記帳處理。
