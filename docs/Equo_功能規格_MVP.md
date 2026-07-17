# Equo 算好 功能規格與 MVP 建議（歷史文件）

> **⚠️ 歷史規劃文件，不是現況說明。** 這是 MVP 前的**規格草案**（v0.1，2026-06-26 後未更新），
> 整份是在盤點當時那個 `index.html` demo 並提出建議——**那個 demo 已經不存在**，正式產品也
> 早就照著自己的路走完 MVP 了。**不要拿它跟程式碼對帳**，也不要據此推論現況或當成待辦清單。
>
> 現況請看：`README.md`、`docs/TECH_STACK.md`、`docs/SUPABASE.md`、`docs/OAUTH.md`、
> `docs/TESTING.md`（這幾份有對著程式碼與 DB baseline 校正過）。
>
> 保留本檔是為了產品思路的出處。2026-07-17 標記。

版本：v0.1  
狀態：Prototype 盤點與正式產品規格草案（歷史）  
依據：當時的 `index.html` demo（已不存在）、既有 SDD、Supabase schema、產品優化方向  

## 1. 文件目的

目前 `index.html` 是 demo 展示品，不應視為可上線產品。它的價值是驗證分帳流程、畫面語氣、操作邏輯與功能想像；正式產品需要重新拆分前端、後端、資料庫與權限邊界。

本文件整理：

- 目前 demo 已展示的功能。
- 正式產品應保留、調整或延後的功能。
- 使用者主要操作流程。
- MVP 第一版應做哪些功能。
- 資料庫讀寫必須改由後端提供，前端禁止直接連資料庫。
- 後續至少 3 種以上可參考的版面設計方向。
- 額外建議與風險。

## 2. 產品定位

Equo 算好是一個以手機使用為主的分帳產品，核心目標是：

> 讓使用者不用理解複雜帳務，也能在 30 秒內新增支出、知道誰該付誰、把結果分享給朋友。

主要使用場景：

- 朋友聚餐
- 旅遊分帳
- 室友生活費
- 家庭共同開支
- 臨時活動或小型群組支出

使用比例假設：

- 手機版：90%
- 桌面網頁版：10%

## 3. 現況判斷

### 3.1 目前 index.html 的定位

目前 `index.html` 應定位為：

- Prototype
- Demo 展示品
- 流程驗證工具
- 視覺方向探索稿

不應定位為：

- 可正式上線產品
- 正式前端架構
- 正式資料同步架構
- 正式資安架構

### 3.2 目前主要問題

1. 前端直接使用 Supabase client 與資料庫互動。
2. 資料、畫面、商業邏輯、同步邏輯都集中在單一 `index.html`。
3. localStorage、demo data、Supabase tables、snapshot 模式混在一起。
4. 部分功能是展示型 mock，尚未達到產品級穩定度。
5. UI 已做多輪迭代，但仍屬 prototype，不是最終視覺。
6. 後台已有雛形，但客服與營運處理流程尚未完整。

## 4. 正式產品架構原則

### 4.1 前端禁止直連資料庫

正式產品必須遵守：

- 前端不可直接呼叫 Supabase table。
- 前端不可持有資料庫操作邏輯。
- 前端只呼叫後端 API。
- 後端負責驗證身份、權限、資料格式、商業規則與資料庫讀寫。
- 資料庫只接受後端服務層的讀寫。

### 4.2 建議正式架構

```text
Mobile Web / PWA / Desktop Web
  -> Backend API
  -> Auth Service
  -> Business Service
  -> Database
  -> Storage / Queue / Notification
```

建議技術方向：

- 前端：Next.js 或 Vite + React
- 後端：Next.js API Routes / NestJS / Fastify 擇一
- 資料庫：PostgreSQL
- Auth：Supabase Auth、Clerk、Auth.js 或自建 JWT
- ORM：Prisma 或 Drizzle
- 部署：Vercel 前端 + 後端 API，或前後端分離
- 檔案：S3 相容儲存或 Supabase Storage，但由後端簽名上傳
- Queue：結算重算、通知、報表輸出可後續加入

### 4.3 前端與後端責任分工

前端負責：

- 畫面呈現
- 表單輸入
- 互動狀態
- 呼叫 API
- 顯示錯誤與空狀態
- PWA 安裝與快取靜態資源

後端負責：

- 登入狀態驗證
- 使用者權限判斷
- 群組、成員、支出、結算資料讀寫
- 分帳計算
- 邀請連結產生與驗證
- 重複請求防呆
- 審計紀錄
- 錯誤紀錄
- 資料備份與匯出

資料庫負責：

- 持久化資料
- 關聯約束
- 基本一致性
- 索引與查詢效能

## 5. 目前 demo 已展示功能盤點

### 5.1 首頁

目前功能：

- 顯示使用者今日狀態。
- 顯示應付、應收、淨額。
- 顯示下一步操作。
- 顯示待處理結算提醒。
- 顯示最近群組。
- 顯示最近支出。
- 空狀態引導建立群組或新增支出。

正式產品建議：

- 保留「下一步操作」邏輯。
- 強化「今天最該處理什麼」。
- 減少統計資訊，避免首頁像儀表板。
- 首頁只放 1 個主要 CTA。

### 5.2 群組

目前功能：

- 建立群組。
- 編輯群組名稱、幣別、預算。
- 群組列表與搜尋。
- 群組分類篩選。
- 顯示群組成員。
- 顯示角色與權限說明。
- 顯示群組支出。
- 顯示群組結算。
- 顯示群組分析。
- 刪除群組。

正式產品建議：

- MVP 保留群組建立、編輯、封存，不建議第一版做永久刪除。
- 群組分析延後。
- 群組預算可延後。
- 群組搜尋在群組數多時必須保留。

### 5.3 成員

目前功能：

- 新增成員。
- 編輯成員名稱。
- 編輯成員角色。
- 刪除成員。
- 頭像選擇。
- 帳號照片展示。
- 角色：擁有者、管理員、家長、成員、子女、訪客。

正式產品建議：

- MVP 只保留：擁有者、成員、訪客。
- 家長、子女、管理員可放到 v2。
- 成員刪除需要處理歷史支出，不可直接硬刪。
- 建議採「移出群組」或「停用成員」。

### 5.4 支出

目前功能：

- 新增支出。
- 編輯支出。
- 刪除支出。
- 支出明細。
- 支出搜尋與分類篩選。
- 金額、幣別、付款人、分類、分攤方式。
- 參與分攤成員勾選。
- 備註。
- 預覽分攤結果。
- AI 文字解析 mock。
- 掃描發票 mock。
- 避免重複送出。
- 新增成功後引導查看結算。

正式產品建議：

- MVP 必須保留新增、編輯、刪除、分攤預覽。
- AI 與掃描發票不列入 MVP。
- 多幣別可先只支援 TWD，或只做欄位不做匯率自動更新。
- 刪除支出必須重新計算結算。
- 金額需由後端做四捨五入與精度控管。

### 5.5 結算

目前功能：

- 根據支出計算誰該付誰。
- 顯示付款狀態。
- 標記已付款。
- 確認收款。
- 提醒付款。
- 分享結算文字。
- 複製結算訊息。
- 使用 Web Share API 分享。
- 付款紀錄。

正式產品建議：

- MVP 必須保留結算計算與分享。
- 付款狀態可保留「未付款 / 已付款 / 已確認」。
- 實際金流串接不列入 MVP。
- LINE deep link 或分享格式要優先優化。

### 5.6 邀請

目前功能：

- 產生邀請連結。
- 複製邀請連結。
- 邀請角色選擇。
- 接受邀請。
- 邀請登入提示。

正式產品建議：

- MVP 保留邀請連結。
- 邀請有效期建議 7 天。
- 邀請接受流程必須由後端驗證 token。
- 前端只拿到可加入結果，不自行判斷資料庫權限。

### 5.7 帳號與備份

目前功能：

- Email 登入。
- Email 註冊。
- Apple / Google 登入入口。
- 登出。
- 本機資料摘要。
- 帳號資料摘要。
- 備份到帳號。
- 查看備份。
- 載入帳號資料。
- 下載備份檔。
- 重設本機資料。
- 清除 demo 資料入口。

正式產品建議：

- MVP 只支援 Google 登入。
- 備份概念在正式版應改成「雲端同步」或「帳號資料」，但文案仍要白話。
- 不建議正式產品有 snapshot 匯入覆蓋模式作為主流程。
- 匯出資料可作為資料權利功能，放在設定深層。

### 5.8 統計與報表

目前功能：

- 本月支出。
- 類別分布。
- 成員排行。
- 幣別分布。
- Excel 匯出。
- PDF / HTML 報表匯出。

正式產品建議：

- MVP 可以只保留簡單總支出。
- Excel/PDF 匯出可延後到 v1.1。
- 統計頁不應搶主流程。

### 5.9 日程與固定帳單

目前功能：

- 日程建議群組。
- Google Calendar 連接 mock。
- 根據日程建立群組 mock。
- 固定帳單產生。

正式產品建議：

- 不列入 MVP。
- 日程串接需要正式 OAuth scope、隱私說明與授權撤回。
- 固定帳單適合 v2。

### 5.10 回饋與錯誤紀錄

目前功能：

- 使用者回報問題。
- 後台可查看回饋。
- 前台錯誤紀錄上報。

正式產品建議：

- MVP 可保留回饋表單。
- 錯誤紀錄應由後端接收，避免前端直接寫 DB。
- 客服工作台後續再做。

### 5.11 後台

目前功能：

- 後台登入。
- 管理員權限檢查。
- 總覽：使用者、群組、支出、待看項目。
- 使用者列表。
- 群組列表。
- 用戶回饋。
- 錯誤紀錄。
- 系統狀態。

正式產品建議：

- MVP 後台只需要「讀取監控」。
- 客服處理、人工改資料、封鎖帳號、資料修復必須後續獨立做，且要有審計紀錄。

### 5.12 視覺與主題

目前功能：

- 日間模式。
- 夜間模式。
- 三套 prototype 風格：
  - 清帳 Flow
  - 夜航 Mint
  - 珊瑚 Pop

正式產品建議：

- 這些仍是 prototype 視覺，不是最終定稿。
- 正式版應再設計 3 個以上完整方向供選擇。
- 風格切換不一定要放進正式產品，可只作為內部評選工具。

## 6. 使用者主要操作流程

### 6.1 第一次使用

目標：不用登入也能理解產品。

流程：

1. 使用者進入首頁。
2. 看見「今天要結哪一筆？」或類似明確問題。
3. 點「開始」或「建立群組」。
4. 建立第一個群組。
5. 新增成員。
6. 新增第一筆支出。
7. 查看誰該付誰。
8. 分享結算結果。

MVP 目標：

- 第一次成功分帳時間低於 60 秒。
- 熟悉後低於 30 秒。

### 6.2 建立群組

流程：

1. 點建立群組。
2. 輸入群組名稱。
3. 選擇幣別。
4. 可選擇類型。
5. 建立完成。
6. 自動進入成員或新增支出下一步。

### 6.3 新增成員

流程：

1. 進入群組。
2. 點新增成員。
3. 輸入名稱。
4. 選擇頭像。
5. 儲存。

MVP 不建議在新增時顯示太多權限設定。

### 6.4 新增支出

流程：

1. 點新增支出。
2. 預設帶入最近使用群組。
3. 輸入項目名稱。
4. 輸入金額。
5. 選擇付款人。
6. 選擇參與分攤成員。
7. 查看預覽分攤。
8. 確認建立。
9. 顯示下一步：查看結算或分享。

### 6.5 查看與分享結算

流程：

1. 進入群組結算頁。
2. 查看誰該付誰。
3. 點分享結算。
4. 顯示可讀訊息。
5. 複製或使用系統分享。

### 6.6 登入與同步

正式流程：

1. MVP 第一版建議先要求登入後使用，避免匿名資料合併造成開發與客服成本。
2. 可提供「看範例」作為未登入體驗，但範例資料不可寫入正式資料庫。
3. 需要建立群組、新增支出、接受邀請、跨裝置同步時，必須登入。
4. 若後續要支援未登入試用，必須另設 anonymous_session 與資料歸戶流程。
5. 不應讓使用者理解資料表、snapshot 或技術細節。

匿名試用若放入後續版本，規則如下：

- 未登入資料只存在瀏覽器本機暫存。
- 使用者登入後，前端送出一次 migration request，由後端建立正式資料。
- 後端必須回傳合併結果與衝突項目。
- 未登入資料不可直接寫入正式群組資料表。
- 邀請加入與分享結算不支援匿名資料。

### 6.7 成員歸戶流程

分帳 App 需要區分「使用者帳號」與「群組成員」：

- 使用者帳號：代表一個登入者，例如 Email 或 Google 帳號。
- 群組成員：代表群組內的一個分帳對象，例如「小明」。
- 一個使用者帳號可以在不同群組有不同成員名稱。
- 一個群組成員可以先不綁帳號，由建立者代為新增。

正式流程：

1. 建立群組時，群組擁有者可以先建立未綁帳號成員。
2. 未綁帳號成員的 `user_id` 為 null，但仍可參與支出與結算。
3. 使用者透過邀請連結加入時，後端判斷是否要建立新成員或認領既有成員。
4. 若邀請連結指定 member_id，登入者可認領該成員。
5. 若未指定 member_id，登入者加入時建立新的 group_member。
6. 已有支出紀錄的成員被認領後，歷史支出仍保留在同一個 group_member，不重新建立。
7. 認領後 `group_members.user_id` 寫入登入者 id，並記錄 claimed_at。

限制：

- 同一群組中，一個 user_id 只能綁定一個 active group_member。
- 被移出的成員不能再被認領，除非擁有者重新邀請。
- 若使用者誤認領，MVP 不提供自助拆分，需由後台人工標記處理。
- 「我參與的群組」以 users.id 查找已綁定的 group_members，不以 display_name 搜尋。

### 6.8 所有權移轉與帳號刪除

#### 群組所有權

MVP 必須支援群組所有權移轉。

規則：

- 擁有者可以將群組所有權移轉給另一位 active 成員。
- 群組必須永遠保留一位 active 擁有者。
- 擁有者不能直接退出自己擁有的群組，必須先移轉所有權或封存群組。
- 若擁有者帳號進入刪除流程，系統要求先移轉其擁有的群組。
- 若帳號異常或客服介入，後台可執行所有權移轉，但必須留下 audit log。

#### 帳號刪除

MVP 可不在前台提供完整刪除帳號 UI，但後端與營運流程必須能處理。

規則：

- 使用者提出刪除帳號後，進入 30 天冷卻期。
- 冷卻期內可取消刪除。
- 冷卻期結束後，users 設定 `deleted_at`，個資欄位匿名化。
- 已建立的支出、群組、結算紀錄不可直接刪除，避免破壞其他成員帳務。
- 匿名化後顯示名稱改為「已離開的成員」。
- 若該使用者仍是群組擁有者，必須先移轉所有權才能完成刪除。

## 7. MVP 版本

### 7.1 MVP 目標

MVP 只解決一件事：

> 一群人可以快速記一筆支出，系統算出誰該付誰，並能分享結果。

### 7.2 MVP 必做功能

#### 使用者

- Google 登入。
- 登出。
- 基本個人資料。
- 人形頭像或帳號照片。

#### 群組

- 建立群組。
- 編輯群組名稱。
- 群組列表。
- 群組搜尋。
- 封存群組。
- 群組封存後預設不出現在首頁，但可從「封存群組」找回。
- MVP 不做永久刪除給一般使用者，避免誤刪帳務。
- 後台可標記測試期垃圾群組，後續由管理員批次清理。

#### 成員

- 新增成員。
- 編輯成員名稱。
- 移出成員。
- 基本角色：擁有者、成員、訪客。

#### 支出

- 新增支出。
- 編輯支出。
- 刪除支出。
- 平均分攤。
- 排除特定成員不分攤。
- 個別成員固定加減金額微調。
- 選擇單一或多位付款人。
- 百分比分攤。
- 份數分攤。
- 多人代墊拆帳。
- 退款或負數支出。
- 選擇參與分攤成員。
- 支出列表。
- 儲存後先顯示「已新增，同步中」，同步失敗再提示使用者重試。
- 後端必須用 client_request_id 防止重複建立同一筆支出。

#### 結算

- 後端計算結算。
- 顯示誰該付誰。
- 標記已付款。
- 確認收款。
- 分享結算文字。
- 產生提醒付款文字，使用者自行複製或分享到 LINE。
- 支出新增、編輯、刪除後，後端自動重新計算未確認的結算版本。
- 已標記付款或已確認收款的紀錄不可被靜默覆蓋，必須保留歷史版本。

#### 邀請

- 產生邀請連結。
- 接受邀請加入群組。
- 邀請有效期。

#### 設定

- 夜間模式。
- 資料匯出 JSON。
- 回報問題。

#### 後台

- 管理員登入。
- 總覽數據。
- 錯誤紀錄。
- 使用者回饋檢視。

### 7.3 MVP 不做功能

- AI 記帳助手。
- 掃描發票。
- Google Calendar 串接。
- 固定帳單。
- 家庭模式。
- 多層權限。
- 真實金流付款。
- Excel/PDF 報表。
- 複雜統計。
- 客服工作台。
- 管理員人工改資料。
- 多幣別匯率自動更新。
- 完整離線資料庫同步。
- 匿名資料自動歸戶。
- App push notification。
- Email 付款提醒。
- Email magic link 登入。
- 密碼登入、忘記密碼、密碼重設。

備註：

- MVP 可以做 PWA-lite：支援加到主畫面、快取靜態頁面、弱網提示。
- MVP 不做完整離線共同編輯；離線期間最多允許前端暫存「待同步支出」，恢復網路後交由後端 API 寫入。

### 7.4 MVP 成功標準

- 使用者能在 60 秒內完成第一筆分帳。
- 新增支出成功率高於 95%。
- 完成分帳流程後，點擊分享按鈕比例高於 30%。
- 支出建立後結算結果可被理解。
- 不熟悉分帳 App 的新使用者，不看說明也能完成「建立群組 -> 新增支出 -> 分享結算」。
- 手機版 375px 寬度無遮擋、無錯位。
- 後端 API 不允許未授權讀寫群組資料。

## 8. 後端 API 規格草案

正式產品前端只能呼叫 API。

### 8.1 Auth

```text
GET    /api/v1/me
POST   /api/v1/auth/logout
POST   /api/v1/account/delete-request
POST   /api/v1/account/delete-cancel
```

登入規則：

- MVP 只支援 Google 登入。
- MVP 不支援 Email magic link。
- MVP 不支援密碼登入，避免處理密碼規則、忘記密碼與密碼外洩風險。
- Access token 建議有效期 1 小時。
- Refresh token 建議有效期 30 天。
- MVP 不限制同時登入裝置數。
- MVP 不做閒置自動登出，依 token 過期處理。

### 8.1.1 前端 URL 路由

```text
/                      -> 首頁
/login                 -> 登入
/groups                -> 群組列表
/groups/:id            -> 群組詳情
/groups/:id/expenses   -> 支出列表
/groups/:id/settlement -> 結算頁
/invite/:token         -> 邀請接受頁
/settings              -> 設定
```

路由規則：

- PWA 與分享連結必須支援 deep linking。
- 未登入使用者進入受保護頁面時，導到 `/login`，登入後回到原頁。
- 無權限使用者進入群組頁時，顯示加入或返回入口，不顯示完整帳務。
- 瀏覽器上一頁需能回到上一個列表或頁面狀態。

### 8.2 Groups

```text
GET    /api/v1/groups?cursor=&limit=&status=&q=
POST   /api/v1/groups
GET    /api/v1/groups/:groupId
PATCH  /api/v1/groups/:groupId
POST   /api/v1/groups/:groupId/archive
POST   /api/v1/groups/:groupId/unarchive
POST   /api/v1/groups/:groupId/transfer-owner
```

列表規則：

- `limit` 預設 20，最大 50。
- `status` 可為 active、archived。
- `q` 搜尋群組名稱。
- 排序預設為 `updated_at desc`。

### 8.3 Members

```text
GET    /api/v1/groups/:groupId/members
POST   /api/v1/groups/:groupId/members
PATCH  /api/v1/groups/:groupId/members/:memberId
POST   /api/v1/groups/:groupId/members/:memberId/remove
POST   /api/v1/groups/:groupId/members/:memberId/claim
```

### 8.4 Invites

```text
POST   /api/v1/groups/:groupId/invites
GET    /api/v1/invites/:token
POST   /api/v1/invites/:token/accept
```

邀請規則：

- MVP 預設邀請連結可多次使用，類似 LINE 群組邀請。
- 預設有效期 7 天。
- 預設 `max_uses` 為 30。
- 每次成功接受邀請後 `use_count + 1`。
- 超過有效期或使用次數後，前端顯示「邀請已失效，請請群組成員重新邀請」。

### 8.5 Expenses

```text
GET    /api/v1/groups/:groupId/expenses?cursor=&limit=&from=&to=&category=&payer_member_id=
POST   /api/v1/groups/:groupId/expenses
POST   /api/v1/groups/:groupId/expenses/preview
GET    /api/v1/groups/:groupId/expenses/:expenseId
PATCH  /api/v1/groups/:groupId/expenses/:expenseId
DELETE /api/v1/groups/:groupId/expenses/:expenseId
```

支出列表規則：

- `limit` 預設 30，最大 100。
- 排序預設為 `expense_date desc, created_at desc`。
- 可依日期區間、分類、付款人篩選。
- MVP response 可不回傳全量 `total_count`，避免昂貴查詢。
- 若需要下一頁，response 回傳 `next_cursor`。

標準列表 response：

```json
{
  "items": [],
  "next_cursor": "opaque-cursor-or-null",
  "has_more": false
}
```

新增支出 request 必須包含：

```json
{
  "client_request_id": "uuid-from-client",
  "title": "晚餐",
  "amount": 1200,
  "currency": "TWD",
  "payment_type": "multiple_payers",
  "payments": [
    {
      "member_id": "member-id-1",
      "amount": 800
    },
    {
      "member_id": "member-id-2",
      "amount": 400
    }
  ],
  "split_method": "share",
  "splits": [
    {
      "member_id": "member-id-1",
      "shares": 2
    },
    {
      "member_id": "member-id-2",
      "shares": 1
    }
  ],
  "adjustments": [
    {
      "member_id": "member-id-2",
      "type": "fixed_delta",
      "amount": -200,
      "reason": "未喝酒"
    }
  ],
  "category": "餐飲",
  "note": "含服務費",
  "expense_date": "2026-06-26"
}
```

後端規則：

- `client_request_id` 由前端產生 UUID。
- 同一使用者、同一群組、同一 `client_request_id` 只能建立一次。
- 重複送出時，後端回傳第一次建立的支出結果，不新增第二筆。
- 前端按下儲存後可先顯示同步中狀態，但最終資料以後端回傳為準。
- `POST /expenses/preview` 不寫入資料庫，只呼叫後端同一套分攤計算邏輯回傳預覽。
- `PATCH /expenses/:expenseId` 必須帶 `version`，版本不一致時回傳 409 Conflict。
- 409 文案：「這筆支出剛被修改，請重新載入後再確認」。
- `payments` 合計必須等於 `amount`。
- `split_method` 可為 `equal`、`percent`、`share`、`fixed_adjustment`。
- 退款或負數支出需標記 `expense_kind=refund`，並由後端反向計入餘額。

### 8.6 Settlement

```text
GET    /api/v1/groups/:groupId/settlement
POST   /api/v1/groups/:groupId/settlement/recalculate
PATCH  /api/v1/groups/:groupId/settlement/:transferId
POST   /api/v1/groups/:groupId/settlement/share-draft
POST   /api/v1/groups/:groupId/settlement/reminder-draft
```

結算重算規則：

- 新增支出、編輯支出、刪除支出、移出成員後，由後端自動重算。
- `POST /settlement/recalculate` 只作為手動修復或管理操作，不是一般使用者主流程。
- 重算必須建立新的 `calculated_version`。
- 舊版本若已有已付款或已確認紀錄，不可刪除，必須標記為 superseded。
- 前端顯示最新有效版本，並在必要時提示「結算已依最新支出更新」。

分享文字範例：

```text
Equo 算好｜本次結帳明細

需要付款：
小明 -> 付 $500 給 小華
小美 -> 付 $300 給 小華

查看詳情：
https://example.com/groups/xxx
```

分享限制：

- 預設分享文字建議控制在 200 字內，避免 LINE 預覽截斷。
- 若 transfer 超過 5 筆，分享文字只顯示前 5 筆與「還有 N 筆請查看連結」。
- 分享連結需有 OG title、description、image，方便 LINE 預覽。
- 分享內容不可暴露未登入者不應看到的完整帳務明細；未授權使用者點入只看到加入或登入入口。
- MVP 不提供公開完整帳務頁；未登入者只能看到群組名稱、結算摘要標題與登入/加入入口。
- 已登入但非群組成員者，需先接受邀請或由成員加入後才能看明細。

提醒付款規則：

- MVP 不發送 push notification。
- MVP 不發送 email 提醒。
- `reminder-draft` 只產生提醒文字。
- 使用者自行複製或使用系統分享貼到 LINE。
- 提醒文字只包含未付款項目，不包含已確認付款與 $0 項目。
- 單次提醒文字控制在 200 字內。

### 8.7 Sync

MVP 不做真正即時多人同步。

```text
GET /api/v1/groups/:groupId/changes?since=
```

同步規則：

- 群組頁每 30 秒 polling 一次。
- 使用者回到前景時立即拉一次最新資料。
- 使用者可手動重新整理。
- 若偵測到遠端資料變更，顯示「有新的支出，已更新」。
- WebSocket、SSE、Realtime 放在後續版本。

### 8.8 Feedback and Monitoring

```text
POST   /api/v1/feedback
POST   /api/v1/client-errors
```

### 8.9 Export

```text
GET /api/v1/export
GET /api/v1/groups/:groupId/export
```

匯出規則：

- MVP 支援全部可見資料匯出與單一群組匯出。
- 只匯出目前登入者有權查看的資料。
- 不匯出其他使用者的 email、登入識別與內部權限欄位。
- 檔案格式為 JSON。
- 檔名格式：`equo_export_YYYY-MM-DD.json` 或 `equo_group_{groupId}_YYYY-MM-DD.json`。
- 匯出用途是資料權利與備份，不作為正式資料匯入入口。

### 8.10 Admin

```text
GET    /api/v1/admin/overview
GET    /api/v1/admin/users
GET    /api/v1/admin/groups
GET    /api/v1/admin/feedback
GET    /api/v1/admin/errors
```

## 9. 資料模型 MVP

### 9.1 users

- id
- email
- display_name
- avatar_url
- deleted_at
- deletion_requested_at
- last_active_at
- created_at
- updated_at

### 9.2 groups

- id
- name
- base_currency
- type
- created_by
- owner_member_id
- max_members
- archived_at
- archived_by
- created_at
- updated_at

### 9.3 group_members

- id
- group_id
- user_id nullable
- display_name
- avatar_url
- role
- status
- invited_by
- joined_at
- claimed_at
- removed_at
- removed_by

### 9.4 group_invites

- id
- group_id
- token_hash
- role
- created_by
- max_uses
- use_count
- expires_at
- accepted_by
- accepted_at
- created_at

### 9.5 expenses

- id
- group_id
- title
- amount
- currency
- expense_kind
- payment_type
- split_method
- category
- note
- expense_date
- created_by
- updated_by
- client_request_id
- sync_status
- version
- created_at
- updated_at
- deleted_at
- delete_finalized_at

### 9.5.1 expense_payments

- id
- expense_id
- member_id
- amount
- payment_source
- created_at

### 9.6 expense_splits

- id
- expense_id
- member_id
- amount
- split_type
- percent
- shares
- adjustment_amount
- adjustment_reason

### 9.7 settlement_transfers

- id
- group_id
- from_member_id
- to_member_id
- amount
- status
- calculated_version
- superseded_at
- superseded_by_version
- paid_at
- confirmed_by
- confirmed_at
- updated_at

### 9.8 feedback

- id
- user_id
- type
- message
- contact
- status
- created_at

### 9.9 audit_logs

- id
- actor_id
- action
- target_type
- target_id
- metadata
- created_at

## 10. 分帳規則

### 10.1 MVP 分攤方式

MVP 支援以下分攤方式：

1. 平均分攤。
2. 排除特定成員：未勾選者不分攤該筆支出。
3. 固定金額微調：可對單一成員加上或減少固定金額，例如「未喝酒 -200」。
4. 百分比分攤。
5. 份數分攤。
6. 單筆支出多付款人。
7. 多人代墊拆帳。
8. 退款或負數支出。

預設仍以平均分攤作為第一選項，其他方式需收在進階設定中，避免新增支出流程變複雜。

平均分攤公式：

```text
可分攤金額 = 支出金額 - 所有固定加減金額合計
每人應付 = 可分攤金額 / 參與人數 + 該成員固定加減金額
付款人餘額 = 已付款金額 - 自己應分攤金額
其他參與者餘額 = -自己應分攤金額
```

百分比分攤公式：

```text
成員應付 = 支出金額 * 成員百分比
所有百分比加總必須等於 100%
```

份數分攤公式：

```text
每份金額 = 支出金額 / 總份數
成員應付 = 每份金額 * 成員份數
```

多付款人公式：

```text
成員餘額 = 該成員付款總額 - 該成員應分攤金額
```

退款或負數支出公式：

```text
退款金額以負數或 expense_kind=refund 表示
系統將退款反向計入付款與應分攤結果
```

限制：

- 固定微調後，任一成員應付金額不得小於 0。
- 所有成員應付金額加總必須等於支出金額。
- 多付款人的付款金額加總必須等於支出金額。
- 百分比分攤的百分比合計必須等於 100%。
- 份數分攤的總份數必須大於 0。
- 退款或負數支出不可讓任一成員產生不合理負應付；後端需以 preview 提醒使用者。
- 若微調造成金額不合法，後端回傳 validation error，前端顯示白話提示。

### 10.1.1 多付款人與多人代墊拆帳差異

單筆支出多付款人：

- 指同一張帳單本身就由多個人一起付款。
- 例：晚餐 NT$3,000，A 刷卡 NT$2,000，B 付現 NT$1,000。
- 系統只需要知道這張帳單總額、每個人付了多少、最後每個人應分攤多少。

多人代墊拆帳：

- 指一次活動中有多個人各自先墊了不同項目，最後要一起結算。
- 例：A 墊餐費 NT$2,000，B 墊計程車 NT$600，C 墊飲料 NT$400，最後三筆一起算誰該補誰。
- 實作上可以由多筆支出組成，也可以在同一流程中快速輸入多筆代墊項目。
- MVP 支援方式：先以多筆支出 + 結算最小化處理；UI 可提供「繼續新增下一筆代墊」的快速流程。

### 10.2 四捨五入

正式規則必須由後端統一處理。

建議：

- 金額以整數最小幣別儲存，例如 TWD cents 或 TWD integer。
- 顯示時再格式化。
- 平均分攤有餘數時，預設由付款人承擔或收取餘數。
- 若付款人未列入參與分攤成員，餘數依 member id 固定排序分配給第一位參與者。
- 使用者介面需顯示簡短說明：「零頭會自動補到付款人，確保總額正確」。
- 結算計算必須可重現。

### 10.3 結算最小化

後端根據群組所有支出計算每位成員餘額：

- 負數：需要付款的人。
- 正數：應收款的人。
- 依金額互相抵銷，產生最少轉帳建議。

MVP 演算法：

- 採用貪心法：最大債務人優先配最大債權人。
- 每次配對產生一筆 transfer，直到所有餘額歸零。
- 時間複雜度以 O(n log n) 為目標。
- MVP 單一群組 active 成員上限為 30 人。
- 30 人以上提示建立子群組或封存不活躍成員。
- MVP 不追求數學上的全域最少筆數，優先確保結果穩定、可解釋、容易測試。

重算版本規則：

- 每次重算產生新的 `calculated_version`。
- 最新版本狀態為 active。
- 舊版本狀態改為 superseded，並記錄 `superseded_at`。
- 已確認付款的 transfer 保留為歷史紀錄，不因新版本消失。
- 若新版本與已確認付款互相衝突，前端需提示「此群組已有付款紀錄，請確認是否重新結算」。
- superseded 版本保留 180 天；超過後可由後台任務保留摘要並清理明細。
- 結算金額為 0 的成員不產生 transfer。
- 結算頁可在成員明細顯示「已平衡」，但分享文字不包含 $0 項目。

### 10.4 群組封存與資料保留

- 封存群組仍可查看歷史支出、成員與結算。
- 封存群組不可新增支出、不可新增成員、不可產生新邀請。
- 擁有者可以解除封存，不限制次數與時間。
- 解除封存後，原本 active 成員狀態不變，已移出成員不會自動恢復。
- 封存群組仍計入使用者歷史資料，但不出現在首頁 active 列表。
- MVP 不設定使用者群組數量上限；若未來加入免費方案限制，封存群組是否計入需另行定義。
- 測試期垃圾群組可由後台標記，滿 30 天未更新且支出少於 2 筆時，進入管理員清理候選清單。

### 10.5 支出分類、金額與日期

#### 分類

MVP 使用固定分類選單，不開放自由輸入。

預設分類：

- 餐飲
- 交通
- 住宿
- 娛樂
- 購物
- 生活
- 其他

規則：

- 資料庫儲存 category code，前端顯示繁體中文名稱。
- 自訂分類放到後續版本。
- 若舊資料沒有分類，預設為「其他」。

#### 金額

- 一般支出金額必須大於 0。
- 一般支出最小金額為 1 TWD。
- 一般支出最大金額為 1,000,000 TWD。
- 不允許 0 元支出。
- 退款可用負數或 `expense_kind=refund` 表示。
- 單筆退款絕對值最大為 1,000,000 TWD。
- 退款必須選擇對應參與成員，並進入同一套結算規則。

顯示格式：

- App 內金額統一顯示 `$1,200`。
- 對外分享文字統一顯示 `NT$1,200`。
- 使用千分位逗號。
- 不顯示小數位，除非未來支援非整數幣別。
- 金額格式由共用 money formatter 處理，不在各元件自行組字串。

#### 日期與時區

- `expense_date` 是使用者輸入的本地日期，使用 DATE 型別，不含時區。
- `created_at`、`updated_at`、`paid_at`、`confirmed_at` 使用 UTC timestamp。
- 列表按 `expense_date` 分組，顯示時不做時區換日。
- 後端仍記錄 request timezone，方便排查跨時區問題。
- `expense_date` 預設為使用者本地今天。
- 允許回溯日期，最早可選 1 年前。
- 允許未來日期，最遠可選 1 年後，用於預付住宿或預付票券。
- 超出日期範圍時，後端回傳 validation error。

### 10.6 支出刪除與復原

- 刪除支出採 soft delete，寫入 `deleted_at`。
- 前端刪除後顯示 5 秒 Undo toast。
- Undo 期間前端先標示已刪除，但後端仍可立即重算；若使用者復原，再次重算。
- MVP 可接受刪除與復原各觸發一次重算，優先保持資料一致。
- Soft delete 明細保留 180 天；之後可由後台任務清理或轉為摘要保留。
- 已被清理的支出不可復原。

### 10.7 成員數與被移出成員

- 群組只有擁有者一人時，不允許新增支出。
- 單人群組首頁顯示「請先新增成員」。
- 單人群組結算區塊隱藏或顯示「目前沒有需要結算的款項」。
- 成員被移出後，不能再查看該群組。
- 被移出成員的歷史支出與結算紀錄保留。
- 若被移出成員仍有未付款項，群組內其他 active 成員仍可看到該筆待處理關係。
- 被移出成員可透過新邀請重新加入，但會建立或認領新的 active 狀態，不自動恢復舊狀態。

### 10.8 Prototype 資料遷移

正式版不遷移 `index.html` prototype 或 demo 中的本機資料。

規則：

- demo 資料視為展示與測試資料。
- 正式產品從正式後端資料庫重新開始。
- 不製作 prototype localStorage 或 snapshot 的正式遷移腳本。
- 若封閉測試者需要保留資料，僅提供 JSON 匯出供人工參考，不做正式匯入。

## 11. 權限規格 MVP

### 11.1 角色

擁有者：

- 管理群組。
- 新增、編輯、刪除支出。
- 邀請成員。
- 移出成員。
- 封存群組。

成員：

- 查看群組。
- 新增支出。
- 編輯自己建立的支出。
- 查看結算。
- 標記付款。

訪客：

- 查看群組。
- 查看結算。
- 不可新增或修改資料。

### 11.2 後端權限判斷

所有權限必須在後端判斷。前端可以隱藏按鈕，但不可依賴前端隱藏作為安全機制。

### 11.3 安全基線

MVP 後端至少需要以下安全規則：

- Rate limit：登入、邀請連結生成、新增支出、回饋表單都需要限制頻率。
- Auth token：必須有明確有效期與刷新機制，過期後要求重新登入。
- CORS：正式環境只允許正式前端網域，不允許任意 origin。
- Input limit：群組名稱最多 40 字，成員名稱最多 24 字，支出標題最多 40 字，備註最多 300 字。
- Amount limit：單筆支出需設定合理上限，MVP 可先限制 TWD 0 到 9,999,999。
- Invite token：只儲存 hash，不儲存明文 token；預設 7 天過期。
- Audit log：重要操作需記錄 actor、target、action、created_at。
- Admin：後台必須與一般使用者權限分離，不可只靠前端入口隱藏。

### 11.4 PWA 與弱網邊界

MVP 支援 PWA-lite，不承諾完整離線 App。

可支援：

- 加到主畫面。
- 快取靜態資源。
- 網路不穩時顯示弱網提示。
- 已載入群組可離線查看最近快取資料。
- 離線新增支出可暫存為待同步項目。

限制：

- 待同步支出最多暫存 20 筆或 24 小時。
- 離線時不可接受邀請、不可登入、不可建立新群組。
- 離線時看到的結算結果需標示「可能不是最新」。
- 恢復網路後，待同步支出逐筆送到後端 API，由後端判斷是否成功。
- 若同步時發現群組已封存、成員已移除、權限不足，該筆轉為失敗並提示使用者。
- iOS Safari PWA 不承諾 push notification、badge、背景同步。

### 11.5 前端狀態、重試與無障礙

#### Loading 與錯誤

- 首次載入列表使用 skeleton，不使用全頁空白。
- 局部操作使用按鈕 loading 狀態，不鎖死整個頁面。
- API 超過 10 秒未回應視為逾時。
- 逾時文案：「連線有點慢，請再試一次」。
- 所有失敗狀態都需提供「重試」或「返回」。

#### 重試策略

- 寫入型 API 自動重試最多 3 次。
- 重試間隔採 1 秒、2 秒、4 秒。
- 3 次失敗後保留待同步狀態，讓使用者手動重試或刪除。
- 待同步支出最多 20 筆或 24 小時，超過後提示使用者先處理。

#### Accessibility

- MVP 至少符合 WCAG AA 對比度。
- 所有 icon-only button 必須有 `aria-label`。
- 所有主要流程可用鍵盤操作。
- 金額輸入框使用 `inputmode="decimal"`。
- 表單錯誤需綁定到欄位，不只顯示 toast。
- 動畫需尊重 `prefers-reduced-motion`。

#### i18n 預留

- MVP 只上繁體中文，但文字不可直接散落在元件中。
- 前端文字使用 key-value 字串檔管理。
- 日期、數字、貨幣格式使用 `Intl` API。
- category、role、status 皆儲存 code，顯示文字由前端字串檔轉換。

### 11.6 頭像規格

MVP 不做自訂上傳頭像。

規則：

- Google 登入可帶入 Google 帳號照片。
- Email 登入預設使用人形圖示或姓名首字。
- 群組成員可顯示 avatar_url，但不可在 MVP 上傳圖片。
- 自訂上傳、裁切、CDN 與檔案清理放到後續版本。

## 12. 版面設計版本建議

目前 demo 的三套風格仍只是 prototype。正式產品至少應再探索以下四種方向。

備註：本章是設計方向摘要。規格凍結後，版本 C 與版本 D 應移到獨立設計提案文件，MVP 主規格只保留 A+B 混合方向。

### 12.1 版本 A：Ledger Minimal

定位：最正式、最像可上線金融工具。  
適合：想建立信任感、降低玩具感。  

特色：

- 白底或接近白底。
- 細線、清楚層級、低彩度。
- 首頁像一張今日清帳單。
- CTA 少而明確。
- 卡片不浮誇，重點在數字與轉帳關係。

適合當正式 MVP 預設方向。

### 12.2 版本 B：Social Split

定位：朋友聚餐、旅遊分帳的社交感。  
適合：年輕族群、LINE 分享場景。  

特色：

- 成員頭像更突出。
- 群組像聊天群或活動卡。
- 結算訊息像可分享貼文。
- 色彩較活潑，但不能干擾金額閱讀。

適合做成第二候選方向。

### 12.3 版本 C：Trip Wallet

定位：旅遊分帳專用感。  
適合：日本旅遊、出國分帳、多人行程。  

特色：

- 群組首頁以旅程為中心。
- 支出按日期分段。
- 多幣別與匯率位置更自然。
- 結算在旅程結束時成為主要 CTA。

適合未來切旅遊分帳垂直場景。

### 12.4 版本 D：Family Calm

定位：家庭與室友共同支出。  
適合：長期群組、固定帳單、家長子女權限。  

特色：

- 色彩安靜。
- 固定帳單、月支出、家庭成員更突出。
- 統計與提醒比社交分享更重要。
- 權限文字要生活化。

適合 v2 家庭模式。

### 12.5 建議設計評選標準

每個版本都用同一組流程測：

1. 第一次建立群組。
2. 新增第一筆支出。
3. 查看誰該付誰。
4. 分享結算。
5. 修改一筆支出。
6. 手機 375px 檢查。
7. 夜間模式檢查。
8. 不給任何說明，請第一次使用者完成一輪流程。

評分項目：

- 是否一眼知道下一步。
- 是否降低新增支出的心理負擔。
- 金額是否清楚。
- 結算是否好理解。
- 分享是否自然。
- 是否看起來像正式產品。
- 使用者是否能在不問人的情況下完成。

### 12.6 MVP 建議採用方向

MVP 建議採用「版本 A：Ledger Minimal」混合「版本 B：Social Split」。

原則：

- 主流程採 Ledger Minimal：低干擾、少按鈕、金額與下一步最清楚。
- 結算頁採 Social Split：頭像、付款關係、分享文字更像社群訊息。
- 首頁不追求功能完整展示，只回答「現在要記一筆，還是查看誰該付誰」。
- 分享結果要適合貼到 LINE 群組，不需要使用者再手動整理文字。
- 桌面版可更像工作台，手機版必須像真正 App，而不是縮小版網頁。

## 13. 需要補充的建議

### 13.1 建議先重構，不要直接把 index.html 產品化

`index.html` 已經承載太多責任。正式開發應拆成：

```text
src/
  app/
  components/
  features/
    groups/
    expenses/
    settlement/
    members/
    auth/
  services/
    api-client.ts
  domain/
    settlement.ts
    money.ts
  styles/
  types/
server/
  routes/
  services/
  repositories/
  auth/
  jobs/
```

### 13.2 建議補一份 API Contract

前後端應先約定：

- request body
- response body
- error code
- 權限錯誤
- validation 錯誤
- idempotency key

API Contract 最低要求：

- 每個 endpoint 必須定義成功 response。
- 每個 endpoint 必須定義 400、401、403、404、409、422、500 的錯誤格式。
- 所有寫入型 endpoint 必須支援 `client_request_id` 或同等防重複機制。
- 前端不得自行組 SQL、不得引用 Supabase client 直接讀寫資料表。
- 前端只可透過 `api-client` 呼叫後端 API。
- 後端回傳錯誤時，需同時提供 `code` 與可顯示給使用者的 `message`。

標準錯誤格式：

```json
{
  "error": {
    "code": "EXPENSE_DUPLICATED_REQUEST",
    "message": "這筆支出已經新增過了",
    "request_id": "server-request-id"
  }
}
```

### 13.3 建議補資料一致性策略

尤其是：

- 多人同時新增支出。
- 支出刪除後結算重算。
- 成員被移出後歷史支出歸屬。
- 邀請連結過期。
- 離線後重新連線。
- 樂觀 UI 顯示同步中，但後端失敗。
- 同一支出被重複送出。

### 13.4 建議補正式測試清單

MVP 至少需要：

- 單元測試：金額、分攤、結算。
- 單元測試：平均、百分比、份數、固定加減、退款、多付款人。
- API 測試：權限、建立、修改、刪除。
- E2E 測試：建立群組到分享結算。
- E2E 測試：多付款人支出與多人代墊連續新增。
- E2E 測試：邀請連結 deep link、登入後返回原頁。
- E2E 測試：封存與解除封存。
- E2E 測試：單人群組不能新增支出。
- E2E 測試：支出日期回溯、未來日期、超出範圍錯誤。
- E2E 測試：提醒付款文字與 JSON 匯出。
- 手機版視覺測試。
- 後端安全測試。

### 13.5 建議補事件追蹤

MVP 應追蹤：

- app_opened
- group_created
- member_added
- expense_created
- settlement_viewed
- settlement_shared
- expense_create_failed
- settlement_share_failed
- invite_created
- invite_accepted
- invite_expired
- login_started
- login_completed
- error_seen

事件追蹤要求：

- 失敗事件必須帶上原因分類，例如 validation、permission、network、server。
- 不追蹤完整帳務內容，避免把金額細節送進分析工具。
- 可追蹤金額區間，例如 0-500、501-2000、2001-10000。
- 每個事件需帶上 app_version、platform、viewport_type。

### 13.6 合規、監控與備份

#### 隱私權與服務條款

正式對外測試前必須準備：

- 隱私權政策。
- 服務條款。
- Cookie 或追蹤技術聲明。
- 註冊或首次登入時的同意紀錄。
- 刪除帳號或資料請求的客服處理流程。

隱私權政策需說明：

- 收集哪些資料。
- 資料用途。
- 資料保留期限。
- 使用者如何請求刪除或匯出資料。
- 第三方服務，例如 Vercel、Supabase、Google Login、分析工具。

#### 監控與告警

MVP 監控目標：

- API P95 response time 小於 500ms。
- 5xx 錯誤率超過 1% 時告警。
- 登入失敗率異常升高時告警。
- 支出建立失敗率超過 5% 時告警。
- 資料庫連線數、儲存空間、備份狀態需可查看。
- 使用 Uptime Robot 或同等工具做外部 uptime 監控。

#### 備份與災難復原

MVP 最低要求：

- 資料庫每日自動備份。
- 備份保留 30 天。
- RPO 目標小於 24 小時。
- RTO 目標小於 4 小時。
- 每月至少做一次備份還原演練。
- 跨區備份可放到付費版或用戶量增加後再導入。

## 14. 建議開發順序

### Phase 1：規格凍結

- 確認 MVP 功能。
- 確認後端 API contract。
- 確認資料模型。
- 確認第一版視覺方向，但前端元件設計可和 API 開發並行。
- 確認 PWA-lite 範圍：加到主畫面、靜態快取、弱網提示，不做完整離線共同編輯。

預估：3 到 5 個工作天。  
人力假設：產品/設計 1 人，前端 1 人，後端 1 人。

### Phase 2：正式技術架構

- 建立前端專案。
- 建立後端 API。
- 建立資料庫 migration。
- 建立 Auth。
- 移除前端直連資料庫。

預估：2 週。  
人力假設：前端 1 人，後端 1 人。

### Phase 3：MVP 核心流程

- 登入。
- 群組。
- 成員。
- 支出。
- 結算。
- 分享。

預估：3 到 4 週。  
人力假設：前端 1 人，後端 1 人，設計支援 0.5 人。

### Phase 4：後台基礎

- 管理員登入。
- 總覽。
- 錯誤紀錄。
- 回饋檢視。

預估：1 到 2 週。  
人力假設：全端 1 人。

### Phase 5：測試與封閉試用

- 10 到 30 位真實用戶測試。
- 收集卡點。
- 修正 MVP。

預估：2 週。  
人力假設：產品/營運 1 人，前端或全端 1 人。

整體粗估：

- 若 1 名前端 + 1 名後端穩定投入，MVP 約 8 到 10 週。
- 若只有 1 名全端開發，MVP 約 12 到 16 週。
- 若視覺設計反覆大改，需另加 1 到 3 週緩衝。

## 15. 結論

目前 demo 已經足以證明 Equo 的產品方向，但還不能直接上線。

最重要的修正是：

1. `index.html` 保留為 prototype。
2. 正式產品前端禁止直接連資料庫。
3. 建立後端 API 作為唯一資料讀寫入口。
4. MVP 先專注群組、成員、支出、結算、分享。
5. AI、掃描、日程、固定帳單、家庭模式、客服工作台延後。
6. 視覺還要再提供至少 3 個以上完整方向進行比較。
