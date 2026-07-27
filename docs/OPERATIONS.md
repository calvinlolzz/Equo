# 營運手冊（備份、監控）

正式站：<https://equo-mu.vercel.app> ｜ Supabase 專案：`cmfgptuzbayzdrxuoapm`（region `ap-southeast-1`）

目前 Supabase 組織在 **free plan**，這決定了下面兩件事的做法。

---

## 1. 資料庫備份

### 為什麼要自己做

**free plan 沒有任何自動備份。** 誤刪或寫壞就是永久失去。Supabase 的 PITR 需要 Pro（US$25/月）再加購 PITR（約 US$100/月）——在有營收前，用 GitHub Actions 自己排程 `pg_dump` 是零成本的替代方案。

### 設定（一次性，需要你操作）

在 GitHub repo → Settings → Secrets and variables → Actions → New repository secret，新增兩個：

| Secret | 取得方式 |
|---|---|
| `SUPABASE_DB_URL` | Supabase → Project Settings → Database → Connection string → **URI**。用 **Session pooler** 或 **Direct connection**；<br>**不要用 Transaction pooler**（不支援 `pg_dump` 用到的語句）。 |
| `BACKUP_PASSPHRASE` | 自己產一組長隨機字串，**另外存在密碼管理器**。弄丟就解不開備份了。 |

設定完可以到 Actions → **Database backup** → Run workflow 手動跑一次驗證。

### 運作方式

[`.github/workflows/db-backup.yml`](../.github/workflows/db-backup.yml)

- 每天 **02:30（台北）** 自動執行，也可手動觸發（做危險變更前先跑一次）。
- `pg_dump --schema=public --no-owner --no-privileges` → GPG AES-256 加密 → 上傳成 workflow artifact，保留 **30 天**。
- 明文 dump 在上傳前就刪掉；artifact 只有 repo 協作者看得到，但因為裡面是所有使用者的財務資料，仍然加密。
- pg_dump 主版本鎖 **17**（對齊伺服器；client 比 server 舊會直接拒絕）。

### 還原

```bash
gpg --batch --yes --decrypt --passphrase "$BACKUP_PASSPHRASE" \
  --output equo.sql equo-<stamp>.sql.gpg
psql "$TARGET_DB_URL" -f equo.sql
```

> **先還原到新的 Supabase 專案或本機驗證，不要直接往正式庫灌。**

### 已知限制（誠實說明）

- 只備份 `public` schema。`auth.*` 是 Supabase 管理的，不在這份 dump 裡 —— 也就是說**登入身分無法從這份備份還原**，能救回來的是群組與帳目資料。要完整備份需要 Pro 方案。
- 不是 point-in-time：最壞情況會遺失最多 24 小時的資料。
- 資料量大到 artifact 塞不下時要改推到物件儲存（S3/R2），屆時再調整。

---

## 2. Uptime 監控

### 為什麼不要只監控首頁

前端是靜態檔、由 Vercel 邊緣供應。**資料庫掛掉或 free-tier 專案被自動暫停時，`/` 仍然會回 200** —— 監控會一路綠燈，正好漏掉最該通知你的那種故障。

### 監控這個端點

```
https://equo-mu.vercel.app/api/v1/health
```

- 正常：`200` + `{"status":"ok","database":"ok"}`
- 資料庫不通：`503` + `{"status":"degraded","database":"down"}`
- 不需登入（監控服務無法登入），回應只有兩個固定欄位，不洩漏任何資料或設定。
- 結果在伺服器端記憶體快取 10 秒，所以它不會變成打資料庫的工具；監控間隔 1 分鐘以上都沒問題。

### 建議設定（免費方案就夠）

| 服務 | 免費額度 |
|---|---|
| UptimeRobot | 50 個監控、5 分鐘間隔 |
| Better Stack | 10 個監控、3 分鐘間隔 |

建議加兩個監控：

1. `GET /api/v1/health` — **期望狀態碼 200**（這個會抓到資料庫故障）
2. `GET /` — 期望 200（抓到整站/部署故障）

通知設 email 或手機推播。

### free plan 的暫停問題

閒置約 7 天後 Supabase 會暫停專案，站等於掛掉。備份 workflow 每天都會連線，實務上可以避免；但這是副作用不是保證，**上面的 health 監控才是真正會通知你的那道防線**。

---

## 3. 目前沒做的（要花錢或需要決策）

- Supabase Pro + PITR（完整備份、含 `auth.*`、可還原到任意時間點）
- 錯誤告警：錯誤有寫進 DB 並可在 `/admin` 查看，但沒有主動推播
- 自訂網域（目前仍是 `equo-mu.vercel.app`）
