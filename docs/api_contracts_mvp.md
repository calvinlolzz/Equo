# Equo MVP API 合約

更新日期：2026-06-30

本文件是正式 MVP 後端與前端共用的 API 欄位契約。所有寫入 API 都以 JSON 傳入，回傳 JSON；後端負責權限、金額加總、版本與防重送。

## 共通規則

- 登入：MVP 採 Google-only。
- 寫入：需要 `client_request_id`，同一群組內重送同一 request id 時，後端要回傳既有結果。
- 金額：使用 `amount_minor` 整數，不使用浮點數。
- 幣別：MVP 預設 TWD，單筆紀錄內付款幣別必須與紀錄幣別一致。
- 錯誤：回傳 `{ error: { code, message, request_id } }`。

## POST /api/v1/groups

建立群組與 owner member。

Request：

```json
{
  "client_request_id": "req_...",
  "name": "東京旅行",
  "currency": "TWD"
}
```

Response：

```json
{
  "id": "group_uuid",
  "name": "東京旅行",
  "currency": "TWD",
  "archived_at": null
}
```

## POST /api/v1/groups/:groupId/invites

建立邀請碼。資料庫只保存 token hash，不保存明文 token。

Request：

```json
{
  "client_request_id": "req_...",
  "max_uses": 5,
  "expires_at": "2026-07-07T00:00:00.000Z"
}
```

Response：

```json
{
  "id": "invite_uuid",
  "token": "EQO7TWD",
  "max_uses": 5,
  "expires_at": "2026-07-07T00:00:00.000Z"
}
```

## POST /api/v1/invites/:token/accept

接受邀請，建立新成員或認領虛擬成員。

Request：

```json
{
  "client_request_id": "req_...",
  "display_name": "小明",
  "claim_member_id": "member_uuid"
}
```

Response：

```json
{
  "group_id": "group_uuid",
  "member_id": "member_uuid",
  "claimed": true
}
```

## POST /api/v1/groups/:groupId/expenses

建立支出、收入或轉帳。支出付款使用 `expense_payments`，分攤使用 `expense_shares`。

Request：

```json
{
  "client_request_id": "req_...",
  "title": "晚餐",
  "kind": "expense",
  "category": "food",
  "amount_minor": 1200,
  "currency": "TWD",
  "expense_date": "2026-06-30",
  "expense_payments": [
    {
      "payer_member_id": "member_alice",
      "amount_minor": 1200,
      "currency": "TWD"
    }
  ],
  "expense_shares": [
    {
      "member_id": "member_alice",
      "share_type": "fixed",
      "amount_minor": 600
    },
    {
      "member_id": "member_bob",
      "share_type": "fixed",
      "amount_minor": 600
    }
  ]
}
```

後端必須驗證：

- `amount_minor` 是正整數。
- `expense_payments` 加總等於 `amount_minor`。
- `expense_shares` 加總等於 `amount_minor`，轉帳除外。
- 所有 member 都屬於同一群組。
- 群組不可為 archived 或 deleted。

## POST /api/v1/groups/:groupId/settlement/calculate

計算目前建議結清，不直接寫入付款結果。

Response：

```json
{
  "settlement_id": "settlement_uuid",
  "settlement_version": 3,
  "calculated_version": 12,
  "transfers": [
    {
      "from_member_id": "member_bob",
      "to_member_id": "member_alice",
      "amount_minor": 600,
      "currency": "TWD"
    }
  ]
}
```

## POST /api/v1/groups/:groupId/settlement/:settlementId/confirm

確認結清。後端必須比對 `settlement_version`，若資料已變動，回傳 `SETTLEMENT_VERSION_CONFLICT`。

Request：

```json
{
  "client_request_id": "req_...",
  "settlement_version": 3
}
```

Response：

```json
{
  "id": "settlement_uuid",
  "status": "confirmed",
  "settlement_version": 3
}
```
