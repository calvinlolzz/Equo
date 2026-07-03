# Equo MVP 骨架交接

更新日期：2026-06-30

本階段已建立正式 MVP 的第一層工程骨架，不再把正式流程繼續塞進 demo `index.html`。

## 已新增

- `apps/web`：未來正式 Web MVP 的前端工作區。
- `apps/web/src/contracts`：API contract 與錯誤碼。
- `apps/web/src/domain`：金額與結清計算核心。
- `supabase/migrations/20260630000000_mvp_core.sql`：依 MVP 技術規劃整理的乾淨資料庫草稿。
- `scripts/check-mvp-scaffold.py`：骨架驗收檢查。
- `docs/api_contracts_mvp.md`：正式 MVP 的 API 欄位契約。
- `apps/web/src/contracts/schemas.ts`：群組、邀請、支出與結清 request schema。
- `apps/web/src/contracts/validation.ts`：支出建立流程的基本 request 驗證。
- `scripts/check-api-contract-stage.py`：API 合約階段驗收檢查。
- `apps/web/src/server/auth`：Google-only identity 與 authenticated context 邊界。
- `apps/web/src/server/repositories/groupRepository.ts`：groups / group_members / invites repository contract。
- `apps/web/src/server/handlers/groups.ts`：建立群組、建立邀請、接受邀請 handler。
- `scripts/check-auth-groups-stage.py`：登入與群組 API 階段驗收檢查。
- `apps/web/src/server/repositories/supabaseGroupRepository.ts`：Supabase/Postgres repository adapter。
- `apps/web/src/server/routes/groupRoutes.ts`：Google-only auth 到群組 handler 的 route adapter。
- `scripts/check-supabase-repository-stage.py`：Supabase repository 階段驗收檢查。
- `apps/web/src/server/repositories/supabaseExpenseRepository.ts`：支出、付款、分攤 repository adapter。
- `apps/web/src/server/repositories/supabaseSettlementRepository.ts`：結清計算與確認 repository adapter。
- `apps/web/src/server/routes/expenseRoutes.ts`：支出 route adapter。
- `apps/web/src/server/routes/settlementRoutes.ts`：結清 route adapter。
- `scripts/check-expenses-settlement-stage.py`：expenses / settlement 階段驗收檢查。
- `public.group_member_balances`：結清計算用 balance view，使用 `security_invoker = true`。
- `scripts/check-balance-view-stage.py`：balance view 階段驗收檢查。
- `apps/web/src/server/http/runtime.ts`：HTTP runtime 路由器。
- `api/v1/[...path].ts`：Vercel Function 入口草稿。
- `scripts/check-http-runtime-stage.py`：HTTP runtime 階段驗收檢查。
- `apps/web/src/server/runtime/googleTokenVerifier.ts`：Google tokeninfo verifier。
- `apps/web/src/server/runtime/runtimeEnv.ts`：server runtime env 檢查。
- `apps/web/src/server/runtime/supabaseQueryClient.ts`：Supabase query client adapter factory。
- `scripts/check-runtime-adapters-stage.py`：runtime adapters 階段驗收檢查。

## 目前狀態

這個骨架先固定邊界：

- Google-only 登入。
- 寫入 API 必須支援 `client_request_id`。
- 支出付款拆到 `expense_payments`。
- 分攤拆到 `expense_shares`。
- 結清確認依賴 `settlement_version`。
- 邀請碼只保存 `token_hash`。

## 尚未執行的原因

目前本機一般命令路徑沒有 Node/NPM，所以這次先建立檔案與 Python 驗收檢查，尚未安裝 Vite/React 依賴，也尚未啟動正式 Web dev server。

## 下一步

1. 補上可用 Node/NPM 環境。
2. 在 `apps/web` 安裝依賴並跑 `npm test`。
3. 將 migration 與現有 `supabase/schema.sql` 做差異整理。
4. 補真正的 Supabase client adapter，替換目前的 query client interface。
5. 對 `supabase/migrations/20260630000000_mvp_core.sql` 跑 Supabase advisors。
6. 補真正的 Supabase query executor。
7. 補 Node/NPM 後跑 `npm test`。
8. 連上 Supabase 後跑 advisors。
