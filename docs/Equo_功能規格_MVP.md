# Equo 算好 功能規格與 MVP 建議

版本：v0.1  
狀態：Prototype 盤點與正式產品規格草案  
依據：目前 `index.html` demo、既有 SDD、Supabase schema、產品優化方向  

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

- MVP 可以支援 Email magic link 或 Google 登入擇一。
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

1. 使用者可先試用。
2. 需要跨裝置或邀請時，提示登入。
3. 登入後資料同步到帳號。
4. 不應讓使用者理解資料表、snapshot 或技術細節。

## 7. MVP 版本

### 7.1 MVP 目標

MVP 只解決一件事：

> 一群人可以快速記一筆支出，系統算出誰該付誰，並能分享結果。

### 7.2 MVP 必做功能

#### 使用者

- Email 或 Google 登入擇一。
- 登出。
- 基本個人資料。
- 人形頭像或帳號照片。

#### 群組

- 建立群組。
- 編輯群組名稱。
- 群組列表。
- 群組搜尋。
- 封存群組。

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
- 選擇付款人。
- 選擇參與分攤成員。
- 支出列表。

#### 結算

- 後端計算結算。
- 顯示誰該付誰。
- 標記已付款。
- 確認收款。
- 分享結算文字。

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

### 7.4 MVP 成功標準

- 使用者能在 60 秒內完成第一筆分帳。
- 新增支出成功率高於 95%。
- 分享結算使用率高於 50%。
- 支出建立後結算結果可被理解。
- 手機版 375px 寬度無遮擋、無錯位。
- 後端 API 不允許未授權讀寫群組資料。

## 8. 後端 API 規格草案

正式產品前端只能呼叫 API。

### 8.1 Auth

```text
GET    /api/v1/me
POST   /api/v1/auth/logout
```

### 8.2 Groups

```text
GET    /api/v1/groups
POST   /api/v1/groups
GET    /api/v1/groups/:groupId
PATCH  /api/v1/groups/:groupId
POST   /api/v1/groups/:groupId/archive
```

### 8.3 Members

```text
GET    /api/v1/groups/:groupId/members
POST   /api/v1/groups/:groupId/members
PATCH  /api/v1/groups/:groupId/members/:memberId
POST   /api/v1/groups/:groupId/members/:memberId/remove
```

### 8.4 Invites

```text
POST   /api/v1/groups/:groupId/invites
GET    /api/v1/invites/:token
POST   /api/v1/invites/:token/accept
```

### 8.5 Expenses

```text
GET    /api/v1/groups/:groupId/expenses
POST   /api/v1/groups/:groupId/expenses
GET    /api/v1/groups/:groupId/expenses/:expenseId
PATCH  /api/v1/groups/:groupId/expenses/:expenseId
DELETE /api/v1/groups/:groupId/expenses/:expenseId
```

### 8.6 Settlement

```text
GET    /api/v1/groups/:groupId/settlement
POST   /api/v1/groups/:groupId/settlement/recalculate
PATCH  /api/v1/groups/:groupId/settlement/:transferId
POST   /api/v1/groups/:groupId/settlement/share-draft
```

### 8.7 Feedback and Monitoring

```text
POST   /api/v1/feedback
POST   /api/v1/client-errors
```

### 8.8 Admin

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
- created_at
- updated_at

### 9.2 groups

- id
- name
- base_currency
- created_by
- archived_at
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
- joined_at

### 9.4 group_invites

- id
- group_id
- token_hash
- role
- created_by
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
- payer_member_id
- category
- note
- expense_date
- created_by
- client_request_id
- created_at
- updated_at
- deleted_at

### 9.6 expense_splits

- id
- expense_id
- member_id
- amount
- split_type

### 9.7 settlement_transfers

- id
- group_id
- from_member_id
- to_member_id
- amount
- status
- calculated_version
- paid_at
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

MVP 只支援平均分攤。

公式：

```text
每人應付 = 支出金額 / 參與人數
付款人餘額 = 已付款金額 - 自己應分攤金額
其他參與者餘額 = -自己應分攤金額
```

### 10.2 四捨五入

正式規則必須由後端統一處理。

建議：

- 金額以整數最小幣別儲存，例如 TWD cents 或 TWD integer。
- 顯示時再格式化。
- 平均分攤有餘數時，餘數分配給付款人或依固定排序分配。
- 結算計算必須可重現。

### 10.3 結算最小化

後端根據群組所有支出計算每位成員餘額：

- 負數：需要付款的人。
- 正數：應收款的人。
- 依金額互相抵銷，產生最少轉帳建議。

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

## 12. 版面設計版本建議

目前 demo 的三套風格仍只是 prototype。正式產品至少應再探索以下四種方向。

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

評分項目：

- 是否一眼知道下一步。
- 是否降低新增支出的心理負擔。
- 金額是否清楚。
- 結算是否好理解。
- 分享是否自然。
- 是否看起來像正式產品。

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

### 13.3 建議補資料一致性策略

尤其是：

- 多人同時新增支出。
- 支出刪除後結算重算。
- 成員被移出後歷史支出歸屬。
- 邀請連結過期。
- 離線後重新連線。

### 13.4 建議補正式測試清單

MVP 至少需要：

- 單元測試：金額、分攤、結算。
- API 測試：權限、建立、修改、刪除。
- E2E 測試：建立群組到分享結算。
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
- invite_created
- invite_accepted
- login_started
- login_completed
- error_seen

## 14. 建議開發順序

### Phase 1：規格凍結

- 確認 MVP 功能。
- 確認後端 API contract。
- 確認資料模型。
- 確認第一版視覺方向。

### Phase 2：正式技術架構

- 建立前端專案。
- 建立後端 API。
- 建立資料庫 migration。
- 建立 Auth。
- 移除前端直連資料庫。

### Phase 3：MVP 核心流程

- 登入。
- 群組。
- 成員。
- 支出。
- 結算。
- 分享。

### Phase 4：後台基礎

- 管理員登入。
- 總覽。
- 錯誤紀錄。
- 回饋檢視。

### Phase 5：測試與封閉試用

- 10 到 30 位真實用戶測試。
- 收集卡點。
- 修正 MVP。

## 15. 結論

目前 demo 已經足以證明 Equo 的產品方向，但還不能直接上線。

最重要的修正是：

1. `index.html` 保留為 prototype。
2. 正式產品前端禁止直接連資料庫。
3. 建立後端 API 作為唯一資料讀寫入口。
4. MVP 先專注群組、成員、支出、結算、分享。
5. AI、掃描、日程、固定帳單、家庭模式、客服工作台延後。
6. 視覺還要再提供至少 3 個以上完整方向進行比較。

