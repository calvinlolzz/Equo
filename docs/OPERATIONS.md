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
- dump 之後同一個 job 還會跑資料保留（第 2 節）與循環支出的產生，每一步各自回報心跳（第 3 節）。**順序是刻意的**：清掉的東西一定已經在今晚的備份裡。

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

## 2. 資料保留

沒有保留期的表會一直長。free plan 只有 500 MB，而備份是 workflow artifact，也得小到傳得上去。

清理全部掛在**每晚 workflow** 的同一個步驟裡（收在一支 `record_ops_heartbeat('retention', ...)` 底下，所以後台看得到昨晚清了幾列），不放 `pg_cron`——理由跟備份本身一樣：跑掛了要看得見（workflow 變紅），而不是安靜地死在資料庫裡。

**這一步刻意排在 dump 之後，而且沿用「前一步失敗就中止」的預設**：這些是 DELETE，備份沒成功的晚上就不該跑。

| 表 | 保留 | 條件 | 函式 |
|---|---|---|---|
| `user_notifications` | 7 天 | 只清**已讀**；未讀的還沒完成它的任務 | `purge_read_notifications` |
| `receipt_scan_logs` | 365 天 | 全部 | `purge_receipt_scan_logs` |
| `app_error_logs` | 90 天 | 全部，並順帶清掉沒有任何 log 對應的 `app_error_group_status` | `purge_error_logs` |
| `client_requests` | 90 天 | 全部 | `purge_client_requests` |
| `invites` | 90 天 | **只清死掉的**（已撤銷／用完／已過期） | `purge_dead_invites` |

三件下手前要知道的事：

1. **`client_requests` 是冪等鍵，刪掉的唯一後果是「重送會變成重複的支出」。** 90 天遠大於真實的重送窗口——危險情境只有「伺服器寫成功了、回應掉了、client 重送」，而離線佇列是一連上線就送，所以重送是幾分鐘幾小時的事，不是幾個月。離線很久的裝置反而沒有風險：伺服器根本沒收過那筆，那是第一次到達不是重播。
2. **`invites` 絕不能用「超過 N 天就刪」。** 正式庫 29 筆邀請**全部** `expires_at IS NULL`（API 收得下到期時間，app 從來沒送過），所以「清過期的」會一筆都清不到，而「清舊的」會把還能用的邀請連結刪掉——那個連結還躺在別人的聊天室裡。條件必須是「死了」而不是「舊了」。
3. **每支函式都有 30 天下限**（`greatest(p_days, 30)`），手滑打成 `purge_error_logs(1)` 不會清掉上週的資料。

改動這些函式之後，用「`DO` 區塊裡跑完再 `RAISE` 回滾」驗證，零殘留：把資料 backdate、跑 purge、把數字用 `RAISE EXCEPTION` 帶出來，整個交易回滾。

---

## 3. 排程任務的心跳

每晚的 workflow 做三件事，**每一件各自回報一次心跳**（`ops_heartbeats`，`kind` 當主鍵、upsert）：

| `kind` | 做什麼 | detail 帶什麼 |
|---|---|---|
| `db_backup` | pg_dump + 加密 + 上傳 | dump 大小、artifact 名、run id |
| `retention` | 五張表的保留期清理 | 每張表各清了幾列 |
| `recurring_expenses` | 把到期的循環支出規則變成真的帳 | `{created, failed, skipped}` |

**為什麼要拆開：** 這三件事本來在同一個 job 裡循序執行，而只有備份會寫心跳。所以備份一失敗，整個 job 中止，**循環支出就悄悄不跑了**——某個人的房租那個月沒有出現，而唯一的訊號是一則關於備份的警告。後台當時也只說得出「備份過期」，說不出「循環支出停了」。

兩個對應的修正：

1. **循環支出那一步是 `if: always()`。** 它是這個排程裡唯一**面向使用者**的事，不該被備份綁架；而且產生一筆支出並不需要一份剛出爐的備份才安全。它本身是冪等的（每一期寫死一個 `client_request_id`），所以無條件跑、手動重跑都不會重複記帳。保留期清理則相反，維持「備份沒成功就不跑」。
2. **後台的健康卡列出「應該要有」的任務**（`SCHEDULED_JOBS`，在 `adminDashboard.ts`）。`ops_heartbeats` 只有跑過的任務才有列，所以**沒跑過的任務是「資料裡不存在」**——列出期望清單，才能把那個不存在變成一張紅卡片而不是什麼都沒有。超過 36 小時算停了（都是每日排程，一天半代表停掉不是遲到）；`recurring_expenses` 的 `failed > 0` 就算時間新鮮也轉黃，因為失敗的規則會被停用並記下錯誤、然後安靜地不再產生帳。

> ⚠️ `health.jobs` 是**沒有這個欄位**還是**空陣列**，意思相反：`undefined` 是 API 還沒更新（什麼都別說），`[]` 是 API 有回報而且真的一個都沒跑過（要叫）。

---

## 4. 索引：advisor 說的不能照單全收

Supabase 的 performance advisor 有兩條規則會互相打架，2026-08-24 補完外鍵索引之後就同時出現了：

- **`unindexed_foreign_keys`**：八個外鍵沒有覆蓋索引。**這條值得修**，但理由不是它的名字暗示的那個——那八個欄位**沒有任何查詢會讀**。它們的用途是反方向：**父列被刪掉時，Postgres 要證明沒有子列還參照它**，沒索引就是整張子表 seq scan。實測 20 萬列的子表，刪一列父列 **16.9 ms → 0.4 ms**。碰到全部八個的操作只有一個：刪帳號。
- **`unused_index`**：同樣那八個索引「從未被使用」。**這條要無視。** 它們是為了「刪父列」而存在的，而正式庫還沒有人刪過帳號；等到有人刪的時候才建就太晚了。`user_notifications_batch_idx` / `read_at_idx` 同理——它們服務的是保留期清理，在只有幾列的表上 Postgres 本來就會選 seq scan。

判準：**索引為了「會發生但還沒發生」的操作而存在時，`unused_index` 沒有資訊量。** 要判斷該不該留，看的是有沒有一條真實路徑會用到它，不是 `pg_stat_user_indexes` 的計數器。

稀疏欄位用**部分索引**（`WHERE col IS NOT NULL`）：`col = $1` 永遠不會配到 NULL，所以排除 NULL 沒有代價，而索引大小只跟「可能配到的列」成正比——那張 20 萬列的子表只有 1% 非 NULL，索引 32 kB。`expenses.payer_id` / `created_by` 是 FloatPay 時代的遺留欄位，`create_expense` 根本不寫，所以會永遠停在 7 列。

---

## 5. 錯誤告警

前端錯誤現在會**主動推播給後台的 owner／admin**（`support` 不會——那是回答回饋的角色，不是 on-call 輪班；為了一個你當下也修不了的 crash 半夜震動，只會讓人把通知關掉）。

推的內容是「什麼壞了」加「24 小時內幾次」，點下去直接到那個 fingerprint 的下鑽頁。

**這件事的難處全部在「不要推太多」。** 一個 bug 弄壞一個畫面，就是同時對所有人弄壞，所以最天真的版本是每次發生推一次，那比完全不推更糟——管理員被洗版一次之後把 Equo 靜音，從此什麼告警都收不到。三道界線，而且都在**同一個 atomic statement** 裡（`claim_error_alert`），這樣同一個 crash 的併發回報不會各自認定自己是第一個：

| 界線 | 預設 | 擋掉什麼 |
|---|---|---|
| 以 **fingerprint** 為單位，不是以「次」 | — | 200 個人踩到同一個 bug＝1 則 |
| 每個 fingerprint 的冷卻 | 6 小時 | 一個 bug 整個下午一直噴，不會整個下午一直推 |
| **全域每小時上限** | 5 則 | 一次爛部署冒出 20 種新錯誤＝5 則，不是 20 則 |

第三道同時是**資安控制**：`POST /api/v1/errors` 是匿名端點、限流 30 次/小時/IP，沒有全域上限的話，任何人都能靠送 30 種不同訊息讓管理員的手機一小時震 30 次。

`app_error_alerts` 跟 `app_error_group_status` **刻意分開**：後者記的是「人」對這個 fingerprint 的判斷（open／resolved），合在一起會變成「管理員標記已解決＝順便靜音了它下次復發的告警」——正好相反，已解決的 bug 又出現是最值得告警的一種。

保留期 90 天（掛在每晚的清理裡）：一個一年沒出現過的 fingerprint 再出現時應該重新告警，而不是被去年春天的那列壓著。

還沒做：回饋、排程任務逾時目前仍然只在後台看得到，沒有推播。

---

## 6. Uptime 監控

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

## 7. 目前沒做的（要花錢或需要決策）

- Supabase Pro + PITR（完整備份、含 `auth.*`、可還原到任意時間點）
- 自訂網域（目前仍是 `equo-mu.vercel.app`）
