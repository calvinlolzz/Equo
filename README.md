# Equo 算好

Equo 是一個手機優先的分帳 Web App：建立群組、記錄支出、多種分攤方式、自動計算餘額與最少轉帳的結算建議。

正式站：<https://equo-mu.vercel.app>

## 功能

- Google 登入牆（Supabase OAuth redirect，無訪客模式）
- 群組建立、邀請連結加入、成員管理與頭像
- 支出記錄：均分、指定金額、比例、份數等分攤方式
- 群組餘額與最少轉帳結算建議
- 支出分頁載入與伺服器端彙總
- 群組封面與圖片上傳（Supabase Storage）
- 行動版底部導覽、bottom sheet 操作、液態毛玻璃視覺

## 技術棧

- 前端：React 19 + TypeScript + Vite（`apps/web`）
- API：單一 Vercel Function `api/v1/[...path].ts` → `vercel-api/v1Handler.ts` → `apps/web/src/server`（routes → handlers → repositories）
- 資料庫：Supabase Postgres（server 端以 service role 經 REST 存取，RLS 與 RPC 面已強化）
- 認證：Supabase OAuth（Google）換發 Equo 自簽 session cookie（`equo_session`）
- 測試：Vitest 三層——純函式／伺服器邏輯（node）、hook 測試、整頁元件測試（jsdom + Testing Library，mount 真的 `<App/>`）

## 開發

```bash
npm install
npm run dev      # 本機開發伺服器
npm test         # 全部測試
npm run build    # tsc -b && vite build
```

發佈前完整驗證：

```bash
npm run verify:release
```

正式站煙霧測試（需 `EQUO_BASE_URL`）：

```bash
npm run smoke:production:all
```

## 專案結構

```
api/                  Vercel Function 進入點
vercel-api/           v1 API handler（轉接到 apps/web/src/server）
apps/web/src/app/     前端 SPA（App.tsx 為主畫面）
apps/web/src/server/  API routes、handlers、repositories、auth
apps/web/src/domain/  金額與結算領域邏輯
supabase/migrations/  單一 squash baseline（全新 DB 套這支；squash/repair 見 docs/SUPABASE.md）
scripts/              release 驗證與煙霧測試腳本
docs/                 部署、OAuth、Supabase、測試等文件
```

## 相關文件

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — 部署流程與環境變數
- [docs/OAUTH.md](docs/OAUTH.md) — Google / Supabase OAuth 設定
- [docs/SUPABASE.md](docs/SUPABASE.md) — 資料庫說明
- [docs/TESTING.md](docs/TESTING.md) — 測試流程
- [docs/claude_continuation_handoff.md](docs/claude_continuation_handoff.md) — **歷史交接快照（2026-07-04，大部分已失效）**，只留決策出處；現況看上面幾份
