# Equo MVP Balance View 階段

更新日期：2026-06-30

本階段補上 settlement repository 需要的 `group_member_balances` view，讓結清計算可以從資料庫取得每位成員的淨額。

## 已完成

- 在 migration 中新增 `public.group_member_balances`。
- view 使用 `security_invoker = true`，避免 view 繞過底層表的 RLS。
- view 來源包含：
  - `expense_payments`
  - `expense_shares`
  - transfer 類型的付款流出
  - transfer 類型的收款流入
- 輸出欄位：
  - `group_id`
  - `member_id`
  - `currency`
  - `balance_minor`
- 對 authenticated role 明確 `grant select`。

## 計算語意

- 一般支出：付款增加成員淨額，分攤降低成員淨額。
- 收入：目前沿用 shares 方向，後續如果收入語意要調整，可在此 view 集中修改。
- 轉帳：付款人視為流出，`transfer_to_member_id` 視為收款流入。

## 下一步

1. 補真正 SQL 測試或 Supabase advisors。
2. 補 HTTP runtime。
