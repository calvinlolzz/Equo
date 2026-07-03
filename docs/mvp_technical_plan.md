# Equo MVP 技術規劃

更新日期：2026-06-30

本文件把目前 demo 已確認的簡化使用邏輯，轉成正式 Web MVP 可落地的技術範圍。原則是：前端負責清楚、低負擔的操作體驗；後端負責身份、權限、金額一致性、版本與不可重複寫入。

## 1. MVP 範圍

MVP 內必做：

- Google-only 登入。
- 建立群組、加入群組、邀請碼加入。
- 群組成員與未綁定帳號的虛擬成員。
- 新增紀錄：支出、收入、轉帳。
- 多付款人資料結構：使用 `expense_payments` 支援一筆紀錄由多人付款。
- 分攤方式：平均分攤、指定金額；百分比可保留資料欄位但不必第一版開放完整 UI。
- 群組餘額、成員餘額、建議結清。
- 確認結清，使用 `settlement_version` 避免舊計算被錯用。
- 封存群組、解除封存、軟刪除。
- PWA-lite：手機瀏覽器可加入主畫面，保留基本快取與響應式體驗。

MVP 外延後：

- OCR、AI 自動分類、發票掃描。
- 推播通知。
- 完整離線同步。
- PDF / Excel 匯出。
- 匯率自動換算。
- 多登入供應商。

## 2. 系統架構

第一版以 Web MVP 為主，App 後續共用同一組 API 與資料模型。

- Frontend：React 應用，保留目前 demo 的簡化群組首頁、快速新增紀錄、結清與成員管理流程。
- Backend：API service，集中處理身份、授權、金額校驗、分攤計算與結清版本。
- Database：PostgreSQL，相容 Supabase 或一般託管 PostgreSQL。
- Auth：Google OAuth，後端以 Google subject 建立或查找使用者。
- PWA-lite：提供 manifest、基本 service worker、手機版固定主操作區。

正式版不得依賴 localStorage 作為資料真相來源。localStorage 只能保存非關鍵 UI 狀態，例如最近開啟的群組或表單草稿。

## 3. 登入與身份

MVP 採 Google-only。

登入後建立或更新 `users`：

- `google_sub` 是 Google 帳號的穩定識別。
- `email` 用於顯示與邀請確認，不作為唯一身份來源。
- `display_name` 與 `avatar_url` 可由 Google profile 帶入，使用者後續可調整顯示名稱。

虛擬成員：

- `group_members.user_id` 可為 null。
- 未綁定帳號時仍可參與支出、收入、轉帳與結清。
- 使用者接受邀請後，可選擇建立新成員或認領既有虛擬成員。

## 4. 權限模型

MVP 先使用兩種角色：

- `owner`：可修改群組設定、產生邀請碼、封存、解除封存、軟刪除群組。
- `member`：可查看群組、新增紀錄、編輯自己建立的紀錄、參與結清。

共同規則：

- 所有群組資料讀寫都必須先確認使用者是該群組的 active member。
- archived 群組預設唯讀，owner 可解除封存。
- deleted 群組不可再被一般 API 讀寫，只保留管理或復原用途。
- 後端不得信任前端傳入的角色、群組擁有者或金額計算結果。

## 5. 資料模型

建議資料表：

### users

- `id`
- `google_sub`
- `email`
- `display_name`
- `avatar_url`
- `created_at`
- `updated_at`
- `deleted_at`

### groups

- `id`
- `name`
- `currency`
- `owner_member_id`
- `archived_at`
- `deleted_at`
- `created_at`
- `updated_at`

### group_members

- `id`
- `group_id`
- `user_id` nullable
- `display_name`
- `role`：`owner` 或 `member`
- `status`：`active`、`removed`
- `claimed_at`
- `created_at`
- `updated_at`

### invites

- `id`
- `group_id`
- `token_hash`
- `max_uses`
- `use_count`
- `expires_at`
- `created_by_member_id`
- `revoked_at`
- `created_at`

邀請 token 只在建立時回傳明文，資料庫只保存 hash。

### expenses

- `id`
- `group_id`
- `created_by_member_id`
- `title`
- `kind`：`expense`、`income`、`transfer`
- `category`
- `amount_minor`
- `currency`
- `expense_date`
- `note`
- `version`
- `deleted_at`
- `client_request_id`
- `created_at`
- `updated_at`

`amount_minor` 一律使用最小貨幣單位，例如 TWD 以元為整數，USD 以 cents。

### expense_payments

- `id`
- `expense_id`
- `payer_member_id`
- `amount_minor`
- `currency`
- `created_at`

此表用來支援多人付款，不把付款人塞成單一欄位。

### expense_shares

- `id`
- `expense_id`
- `member_id`
- `share_type`：`equal`、`fixed`、`percent`
- `share_value`
- `amount_minor`
- `created_at`

後端寫入前必須驗證 shares 加總等於紀錄金額。

### settlements

- `id`
- `group_id`
- `settlement_version`
- `calculated_version`
- `status`：`draft`、`confirmed`、`superseded`
- `created_by_member_id`
- `confirmed_at`
- `superseded_at`
- `created_at`

### settlement_transfers

- `id`
- `settlement_id`
- `from_member_id`
- `to_member_id`
- `amount_minor`
- `currency`
- `confirmed_expense_id`
- `created_at`

### audit_logs

- `id`
- `group_id`
- `actor_member_id`
- `action`
- `target_type`
- `target_id`
- `payload`
- `created_at`

## 6. API 規劃

所有 API 回傳 JSON。寫入 API 回傳更新後的主要資源與必要摘要。

Auth：

- `GET /api/v1/me`：取得目前使用者與可用群組摘要。

Groups：

- `GET /api/v1/groups`
- `POST /api/v1/groups`
- `GET /api/v1/groups/:groupId`
- `PATCH /api/v1/groups/:groupId`
- `POST /api/v1/groups/:groupId/archive`
- `POST /api/v1/groups/:groupId/unarchive`
- `DELETE /api/v1/groups/:groupId`

Members：

- `GET /api/v1/groups/:groupId/members`
- `POST /api/v1/groups/:groupId/members`
- `PATCH /api/v1/groups/:groupId/members/:memberId`
- `POST /api/v1/groups/:groupId/members/:memberId/claim`

Invites：

- `POST /api/v1/groups/:groupId/invites`
- `GET /api/v1/invites/:token`
- `POST /api/v1/invites/:token/accept`
- `POST /api/v1/groups/:groupId/invites/:inviteId/revoke`

Expenses：

- `GET /api/v1/groups/:groupId/expenses`
- `POST /api/v1/groups/:groupId/expenses`
- `PATCH /api/v1/groups/:groupId/expenses/:expenseId`
- `DELETE /api/v1/groups/:groupId/expenses/:expenseId`

`POST`、`PATCH` 與 `DELETE` 必須支援 `client_request_id` 或等效 idempotency key，避免重送造成重複紀錄。

Settlement：

- `GET /api/v1/groups/:groupId/settlement/current`
- `POST /api/v1/groups/:groupId/settlement/calculate`
- `POST /api/v1/groups/:groupId/settlement/:settlementId/confirm`

## 7. 支出與分攤流程

前端流程：

1. 使用者選擇 `支出`、`收入` 或 `轉帳`。
2. 輸入標題、金額、日期、分類。
3. 依類型選擇付款人、收款人或收入來源。
4. 選擇分攤成員與分攤方式。
5. 前端顯示即時計算預覽，但只作為輔助。

後端流程：

1. 驗證使用者是 active group member。
2. 驗證群組未刪除，若 archived 則拒絕一般寫入。
3. 驗證金額為正整數，幣別符合群組設定。
4. 驗證 `expense_payments` 加總等於紀錄金額。
5. 驗證 `expense_shares` 加總等於紀錄金額。
6. 在同一個 transaction 寫入 `expenses`、`expense_payments`、`expense_shares`、`audit_logs`。
7. 使用 `client_request_id` 判斷重送，已處理過則回傳原結果。

收入的語意：

- 可視為群組共同收入，用來降低所有被分攤成員的應付。
- 付款來源可是一位成員或外部來源；MVP 可先要求選擇一位成員作為記錄人。

轉帳的語意：

- 轉帳表示成員之間已發生付款。
- 轉帳不再分攤給其他人，只影響兩位成員之間的餘額。

## 8. 結清流程

結清計算只使用：

- active members。
- 未刪除 expenses。
- 未被 supersede 的 confirmed settlement records。

計算流程：

1. 依所有有效紀錄建立成員淨額。
2. 正數表示應收，負數表示應付。
3. 以最少轉帳筆數產生建議付款。
4. 建立 `settlements` draft，寫入 `settlement_version` 與 `calculated_version`。
5. 使用者確認時，後端重新檢查群組資料版本未改變。
6. 若版本一致，確認 settlement，並可建立對應的 transfer record。
7. 若版本不一致，拒絕確認並要求重新計算。

`settlement_version` 用來保證使用者確認的是同一份結清結果，不是過期建議。

## 9. 邀請碼流程

建立邀請碼：

- owner 或 member 可產生邀請碼，第一版可先允許 active member 產生。
- token 明文只回傳一次。
- 資料庫保存 `token_hash`。
- 可設定 `max_uses` 與 `expires_at`。

接受邀請：

1. 使用者開啟邀請連結。
2. 未登入時導向 Google 登入。
3. 後端驗證 token 未過期、未撤銷、未超過使用次數。
4. 使用者選擇建立新成員或認領虛擬成員。
5. 更新 `group_members` 並增加 `invites.use_count`。

## 10. 封存與刪除

封存：

- 只設定 `groups.archived_at`。
- 群組預設從主列表隱藏。
- 封存後一般紀錄寫入被拒絕。
- owner 可以解除封存。

刪除：

- MVP 採 soft delete，設定 `groups.deleted_at`。
- deleted 群組不可被一般列表與讀寫 API 取回。
- audit log 保留刪除事件。
- 若未來要做永久刪除，必須另設管理流程與等待期。

## 11. 前後端責任切分

前端負責：

- 低負擔的主要流程：進群組、新增紀錄、看餘額、確認結清。
- 表單即時檢查與清楚錯誤提示。
- optimistic pending 狀態。
- 手機與桌面一致的核心操作。
- 非關鍵 UI 狀態保存。

後端負責：

- Google identity 驗證。
- 群組權限判斷。
- 金額、分攤與付款加總校驗。
- `client_request_id` idempotency。
- transaction 寫入。
- settlement calculation 與 `settlement_version`。
- audit log。

## 12. 驗證與錯誤

錯誤格式：

```json
{
  "error": {
    "code": "EXPENSE_SHARE_TOTAL_MISMATCH",
    "message": "分攤金額加總必須等於紀錄金額",
    "request_id": "req_..."
  }
}
```

常見錯誤碼：

- `UNAUTHENTICATED`
- `FORBIDDEN`
- `GROUP_ARCHIVED`
- `GROUP_DELETED`
- `MEMBER_NOT_FOUND`
- `INVALID_AMOUNT`
- `PAYMENT_TOTAL_MISMATCH`
- `EXPENSE_SHARE_TOTAL_MISMATCH`
- `IDEMPOTENCY_CONFLICT`
- `SETTLEMENT_VERSION_CONFLICT`
- `INVITE_EXPIRED`
- `INVITE_REVOKED`

## 13. 實作階段

Phase 1：正式專案骨架與資料層

- 建立 Web app 專案結構。
- 建立資料庫 migration。
- 建立 API response/error 格式。
- 建立 auth middleware 與 group permission helper。

Phase 2：登入、群組與邀請

- Google-only 登入。
- 群組 CRUD。
- 成員列表與虛擬成員。
- 邀請碼建立、預覽、接受。

Phase 3：紀錄與餘額

- 支出、收入、轉帳 API。
- `expense_payments` 與 `expense_shares` transaction 寫入。
- 群組摘要、成員餘額、活動紀錄。
- 前端接上正式 API。

Phase 4：結清與安全操作

- settlement calculation。
- `settlement_version` 確認流程。
- 封存、解除封存、軟刪除。
- audit log 視圖或最小管理查詢。

Phase 5：Beta 前整理

- 手機版流程驗證。
- PWA-lite。
- 端到端測試。
- 金額與版本衝突測試。
- 錯誤提示文案整理。
