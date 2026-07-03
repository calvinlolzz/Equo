# Equo MVP Expenses 與 Settlement Repository 階段

更新日期：2026-06-30

本階段補上正式後端最核心的金流資料邊界：支出、收入、轉帳，以及結清計算與確認。

## 已完成

- `expenseRepository`
  - `createExpense`
  - `listExpenses`
  - `softDeleteExpense`
  - `recordClientRequest`
- `supabaseExpenseRepository`
  - 建立 `expenses` 主紀錄。
  - 寫入 `expense_payments`。
  - 寫入 `expense_shares`。
  - 寫入 `client_request_id` 到 `client_requests`。
  - 寫入前使用 `validateCreateExpenseRequest` 擋掉金額不一致。
- `settlementRepository`
  - `calculateCurrentSettlement`
  - `confirmSettlement`
- `supabaseSettlementRepository`
  - 使用 domain `calculateSettlement` 產生建議轉帳。
  - 寫入 `settlements` 與 `settlement_transfers`。
  - 確認時檢查 `settlement_version`，不一致時回傳版本衝突。

## 下一步

1. 將目前的 query client interface 換成真正 Supabase server client。
2. 補 `group_member_balances` view 或改成 repository 內用 SQL 聚合。
3. 對 migration 跑 Supabase advisors。
4. 補 HTTP runtime，例如 Next.js route handler 或 Vercel Function。
