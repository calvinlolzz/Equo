# 營運手冊（備份、監控）

正式站：<https://equo-mu.vercel.app> ｜ Supabase 專案：`cmfgptuzbayzdrxuoapm`（region `ap-southeast-1`）

目前 Supabase 組織在 **free plan**（2026-08-26 對著 Management API 確認過），這決定了下面幾件事的做法。

**兩個硬限制**（取自 Supabase 官方 quota 表）：

| 項目 | Free 額度 | 超過會怎樣 |
|---|---|---|
| Database Size | **500 MB / 專案** | **專案轉唯讀**——`cannot execute INSERT in a read-only transaction`，等於 app 不能再記帳 |
| Storage Size | 1 GB | 超額通知＋寬限期，之後套用 Fair Use 限制 |

2026-08-26 實測：資料庫 **29 MB（5.9%）**、儲存 **1.5 MB（0.15%）**。兩個都還很空，但這是懸崖不是斜坡，所以後台現在會顯示（見第 8 節）。

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
| `app_error_alerts` | 90 天 | 全部（一年沒出現的 fingerprint 再出現時應該重新告警） | `purge_error_alerts` |
| `push_delivery_logs` | 90 天 | 全部 | `purge_push_delivery_logs` |
| `expense_comments` | 90 天 | **只清收回的**（`deleted_at` 有值）；還看得到的留言不清 | `purge_deleted_expense_comments` |
| `line_link_requests` | **1 天** | 過期超過一天的（見第 18 節：它們 10 分鐘後就是死憑證，不是歷史） | `purge_line_link_requests` |
| `line_bot_entries` | 90 天 | 全部（只為復原視窗與重送冪等存在；帳目本身不動） | `purge_line_bot_entries` |
| `line_undo_events` | **2 天**（下限 1 天） | 全部（只需涵蓋 LINE 重送的時間窗；刻意很短，因為這張表沒有外鍵，帳號刪除後 LINE id 只能靠它過期才消失；解除綁定時也會直接清掉） | `purge_line_undo_events` |

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

## 6. 推播健康

推播的失敗模式是**安靜**。其他子系統壞掉都會講話：寫入失敗是 500、掃描壞了是 503、備份過期是紅卡片。推播沒有——VAPID 金鑰換錯、訂閱失效、瀏覽器悄悄不再認那個 endpoint，看起來全都跟「今天剛好沒人記帳」一模一樣。`deliverPush` 一直都回傳 `{sent, pruned, failed}`，而每一個呼叫端都把它丟掉。

**錯誤告警上線之後這件事更重要**：那些告警本身就是推播，所以推播無聲壞掉會順便把告警一起帶走。

現在每一次 fan-out 寫一列 `push_delivery_logs`（一次 fan-out 一列，不是一個裝置一列——一筆支出通知全群組，逐裝置只是把列數乘上群組人數，不會多出訊號）。記錄點放在 `deliverPush` 裡面而不是四個 `notify*`，因為那是唯一的收口，之後新增的通知不可能繞過去。

後台健康卡兩張新卡片，回答兩個不同問題：

- **推播送達（7 日）**：失敗率。超過 20% 是金鑰壞了或推播服務出事，不是運氣不好。**被清掉的失效 endpoint 不算失敗**——重裝過 app 的裝置本來就該被丟掉，算進失敗率會讓健康的一週看起來像壞掉。
- **可通知的管理員**：`subscribed_admins / admins`。**0 是最糟的狀態**，而且會同時進待辦清單：告警找不到人，看起來跟「這週很平靜」一模一樣，比完全沒有告警更糟。

> ⚠️ 跟 `health.jobs` 一樣，`health.push` **沒有這個欄位**（舊 API，什麼都別顯示）與**有欄位但數字是 0**（真的沒有）意思不同。

---

## 7. 循環支出的營運面

`materialise_recurring_expenses` 遇到會拋錯的規則時，會**把那條規則停用**並把原因寫進 `last_error`（最常見的是付款人或分攤者已經離開群組）。規則的擁有者在自己的面板看得到那行錯誤，所以使用者那半邊本來就有；缺的是跨群組的視角——排程心跳只說「2 條規則失敗」就沒了，看不到是哪幾條、在誰的群組、為什麼。

後台總覽的健康卡下面現在會列出這些規則（規則名、群組、原因、最後嘗試時間），點一列直接跳到那個群組。同時進待辦清單。

**沒有做成新分頁、也沒有新端點**：它搭在總覽本來就會抓的 health payload 上，而且**好日子完全不顯示**——跟待辦清單同一條規則。正式庫目前有 **0 條循環支出規則**，替一個還沒有人用的功能蓋一整個 console 介面，是在替想像中的營運者做事。

- `broken` 算的是「有 `last_error` 的規則」，跟「使用者自己暫停的規則」分開——後者不是故障。
- 清單上限 10 條：這是總覽會輪詢的 payload，而且 10 條壞掉已經是系統性問題，不是一張待辦清單。
- 規則所屬群組被硬刪時仍然列得出來（顯示「(群組已刪除)」），不會變成一列空白。

---

## 8. 免費方案額度

後台總覽的健康卡有兩張額度卡片，超過 70% 轉黃、85% 轉紅，資料庫那張同時會進待辦。

**資料庫那張是嚴重的那個**：超過 500 MB 不是多付錢，是**專案轉唯讀、app 不能再記帳**。所以卡片上直接寫「超過會轉唯讀」——單看一個百分比說不出後果。

幾個量測上的細節：

- 用的是 Supabase 文件自己指定的那個查詢（`sum(pg_database_size(datname))` **over `pg_database`**，不是 `pg_database_size(current_database())`），所以後台顯示的數字跟平台實際拿來判定的是同一個。
- 那個 sum **包含 `template0`／`template1`，約 15 MB**，誰都刪不掉——但它算進額度，所以後台也必須算進去。目前 29 MB 裡有一半是這個。
- **刪資料不會馬上讓數字變小**：Postgres 要 vacuum 之後才會回收空間。所以第 2 節那些保留期清理跑完之後別預期立刻掉。

**額度的數字寫在 console（`adminDashboard.ts` 的 `FREE_PLAN_LIMITS`）不寫在 SQL**：那是訂閱方案的性質，不是這個資料庫的性質。Postgres 只負責報「用了多少」，方案負責說「可以用多少」。升級方案時改一個常數。

---

## 9. 自動催繳

**預設關閉。** 這是產品裡唯一不需要有人按下按鈕就會送出通知的功能，開關在 `/admin`「設定」分頁（admin 或 owner 才能改，support 只能看）。

三個設計決定，每個都有一個顯而易見的錯誤答案：

1. **提醒送給欠錢的人，而且不具名。** 跟手動的「提醒還款」同一個方向——「被提醒還款」本來就是發生在欠錢的人身上。差別是沒有人按下任何東西，所以不掛名字：內容是「你還有 NT$1,200 未結清」，不是「Alice 提醒你…」。不會有人的名字被機器拿去施壓。
2. **自動與手動共用同一張冷卻表。** `group_nudges.from_member_id` 改成可為 NULL，NULL 代表自動。這不是省一張表——`send_nudge` 的冷卻判斷是「這個群組這個人最近一次被提醒是什麼時候」，共用表才能讓自動提醒壓下手動的、手動的也壓下自動的。兩張表會讓同一個人被兩套互相看不見的機制在一分鐘內戳兩次。
3. **「欠了幾天」是推導出來的**，因為餘額沒有時間戳：取「這個人在這個群組裡、比他上次清償還新的、最舊的一筆支出」。念出來就是「你從 <某日> 起就有沒結清的支出，而且現在還欠錢」。刻意**不是**「加入群組幾天」——那會為了昨天的一筆帳去煩人。

### 排程與設定

- Vercel Cron，每天 **UTC 02:00 = 台北 10:00**。刻意不掛在每晚 02:30 那個 workflow 上：**在半夜兩點半推播催繳是最快讓人關掉通知的方法**。
- 端點是 `POST /api/v1/internal/run-nudges`，用 `CRON_SECRET` 驗證（`Authorization: Bearer <secret>`，常數時間比對）。**沒設 secret 時端點是關閉的**——一個會送通知的東西，未驗證就能觸發比沒有排程更糟。
- 每次執行寫一筆 `auto_nudge` 心跳，所以「催繳停了」會出現在健康卡上（第 3 節）。

### 要用的話需要做一件事

在 Vercel 專案加一個環境變數 `CRON_SECRET`（隨便一段夠長的隨機字串），重新部署，然後到 `/admin`「設定」把開關打開。在那之前這個功能完全不會動——端點 401，開關是關的。

> ⚠️ `CRON_SECRET` 有走 `cleanEnvValue`，因為用管線餵給 `vercel env add` 的值可能帶 BOM，而差一個看不見的字元的 secret 比對失敗時完全沒有線索。見 [[powershell-pipe-bom-gotcha]] 的同類問題。

---

## 10. 收據與留言

支出可以掛**最多 5 張**收據，也可以被留言。兩件事在營運上各有一個要知道的地方。

### 收據：`image_url` 是衍生欄位

`expenses.image_urls` 是真的清單，`expenses.image_url` 是它的第一張，**唯一的寫入者是 `create_expense`**。列表縮圖、搜尋結果、後台都讀 `image_url`，因為它們只需要一張。要驗證兩者沒有漂移：

```sql
select count(*) from expenses
where deleted_at is null and image_url is distinct from image_urls[1];
```

**上限 5 張是為了儲存空間**，那是免費方案先撞到的牆（見第 8 節），不是為了資料庫。同一個數字在三個地方：`expenses_image_urls_bounded` 這個 CHECK、`create_expense` 的 `TOO_MANY_IMAGES`、以及 `contracts/validation.ts` 的 `MAX_EXPENSE_IMAGES`。

⚠️ **payload 有沒有 `image_urls` 這個鍵，跟它是不是空陣列，是兩件事。** 有鍵＝這份 payload 說了收據有哪些（空陣列＝使用者把收據刪光了）；沒有鍵＝這份 payload 沒在講收據，退回舊的單張 `image_url`。少了這個區分，離線佇列裡凍結的舊 payload 與快取住的舊 bundle 重送時會把收據清成空的。

刪除與編輯時的孤兒清理算的是**集合差集**，不是比較第一張：編輯可以只拿掉第二張而留著第一張。

### 留言：編輯支出會換 id

`replace_expense` 是「軟刪除舊的、建一筆新的」，所以支出被編輯後 **id 會變**。收據沒事（隨 payload 重寫），但留言是掛在 `expense_id` 上的，所以 `replace_expense` 裡有一句 `update expense_comments set expense_id = ...` 把整串搬過去。**改動 `replace_expense` 時不要弄掉它**，否則使用者改一個錯字就會讓討論消失。

其他幾點：

- 每則留言都會**對整個群組推播**（扣掉作者本人），所以它比看起來的一列 INSERT 貴。限流因此有自己的桶子（`comment`，60 次/小時），比一般寫入嚴格。
- 推播文字會**引用留言內容**（截斷到 60 字）。`tag` 是每筆支出一個，所以同一筆的來回討論會互相取代而不是疊成五張卡。
- **重送不會重複推播**：`create_expense_comment` 走 `client_requests` 冪等，命中時回傳的 JSON 不帶 `expense_title`，而路由正是用「有沒有標題」判斷要不要送推播。
- 刪除是軟刪除，由上面的保留規則在 90 天後真的清掉。
- **刪帳號會刪掉這個人寫過的留言**（不是匿名化）。帳目留下來是因為錢是共同的；留言是他自己說的話。

---

## 11. 多語言

繁體中文與 English。**後台（`/admin`）沒有翻譯**，那是給一位讀中文的營運者用的內部工具，翻它只是增加維護面積。

### 語言怎麼決定

順序是「存過的選擇 → 瀏覽器語言 → 繁體中文」。存過的優先於瀏覽器是刻意的：在別人的手機上把語言改成中文的人，是真的想要中文。

**語言在啟動時決定一次，改語言會重新整理頁面。** 大約 30 個模組在 import 時就綁好字串（`const text = UI_TEXT.app`），要即時切換就得把 hook 穿過每一個。這是個真的取捨——重新整理看得見——換來的是不用為了一個幾乎沒人改第二次的設定去動那三十個檔案，而且過程中不會掉東西（離線佇列與群組快取都在 localStorage）。

### 加一個語言要做什麼

1. `i18n/locale.ts` 的 `LOCALES`／`LOCALE_NAMES`／`matchLocale`
2. 複製 `i18n/en.ts` 成新檔——**漏翻一個字串會編譯失敗**，因為型別是從 `zhHant.ts` 推出來的
3. `uiText.ts` 的 `DICTIONARIES`
4. `i18n/format.ts`：月份與星期用 `Intl` 自動處理，只有中文是手寫的（要保住既有輸出格式）
5. 推播另有一份字典 `server/push/pushText.ts`，還要放寬 `push_subscriptions_locale_known` 這個 CHECK
6. 法律文件（見下）

`locale.test.ts` 會檢查兩份字典的鍵完全一致、沒有留白，以及模板的 placeholder 沒被翻掉。

### 推播用「收件裝置」的語言

語言存在 `push_subscriptions.locale`，**不是使用者身上**——一筆訂閱就是一台裝置，同一個人的公司筆電是英文、手機是中文，兩邊都該收到讀得懂的那則。`deliverPush` 依語言分組，每種語言只組一次訊息。

`NULL` = 這台裝置沒回報過（訂閱早於這個功能，或 bundle 太舊），**退回繁體中文而不是英文**：那是它們一直以來收到的，沒被問過就換掉別人手機上的語言更糟。

### 法律文件：中文為準

`i18n/legalZhHant.ts` 是**有效力的版本**；`i18n/legalEn.ts` 是便利翻譯，兩份文件開頭都會顯示一行英文說明「以中文版為準」。

⚠️ **兩個檔案必須一起改。** 只改中文會讓英文讀者看到一個產品已經不再做出的承諾，那比沒有翻譯更糟。原本那條「換 AI 供應商就要回來改」的警告，在這裡要算兩次。

### 測試

`apps/web/vitest.config.ts` 的 setup 檔把測試語言釘在繁體中文。沒有它，測試會用執行環境 jsdom 回報的 `en-US` 來跑，於是所有對照現有中文介面寫的斷言會因為跟受測行為無關的理由開始失敗。

---

## 12. 站台公告與維護模式

後台 →「站台公告與維護」。兩件事放在同一張卡，因為它們幾乎總是一起用：掛公告、做事、兩個一起收掉。

### 公告

顯示在所有人畫面最上方，**包含還沒登入的登入頁**——維護時最需要一句解釋的，正是那些進不來的人。這也是全站唯一一支登入前會打的 API（`GET /api/v1/site-notice`，公開、不帶任何使用者資料）。

- **內容不會被翻譯**：一位營運者寫一句話，機器翻譯只會讓它變差。只有周邊（「維護中」標籤、關閉鈕）跟著讀者的語言。
- **結束時間會自動收起公告**。留空＝一直掛著，但**沒有人會記得回來拿掉**，一則過期三週的「本週六維護」比沒有公告更糟。
- 「現在該不該顯示」由**伺服器**判斷（`site_notice_settings` 的 `active`），不是客戶端——每一台客戶端的時鐘都可能是錯的。
- 關掉的公告記在裝置端，而且**記的是內容不是旗標**：記旗標會讓下一則新公告也被吃掉，也就是最重要的那則沒人看得到。同一句話重貼還是維持關閉。

### 維護模式

**只擋寫入，讀取照常。** 目的是讓帳本在你動資料庫時不要變，不是把網站關掉——想看自己欠多少的人照樣看得到，並看到一行說明為什麼記不了帳。

⚠️ **開關生效最多要 30 秒**（每個 instance 快取設定 30 秒，否則每一次寫入都要多一次資料庫往返）。**先開、等半分鐘、再開始動手**，不要開了就立刻跑 migration。後台自己的儲存會立刻清掉快取，所以你在後台看到的永遠是最新的。

**不受維護模式影響的路徑**，以及為什麼：

| 路徑 | 理由 |
|---|---|
| `/api/v1/admin/*` | **關不掉的維護模式是從裡面反鎖的門。** 這條最重要 |
| `/api/v1/auth/*` | 要進後台的人可能還沒登入 |
| `/api/v1/errors` | 維護中正是最想知道什麼壞了的時候 |
| `/api/v1/site-notice` | 不然沒有人讀得到那句解釋 |

**fail open**：設定讀不到就當作沒有維護。把「資料庫連不上」當成「應該進入維護」，會讓一次查詢抖動變成全站寫入中斷，而且發生在沒有人能用後台反駁它的那一刻。跟限流同一個姿態。

### ⚠️ 使用者在維護中記的帳不會不見

這是整個功能安全與否的關鍵。離線佇列**會丟掉伺服器明確拒絕的寫入**（否則一筆壞資料會永遠卡住後面所有的），而維護回的是 503 `MAINTENANCE`——如果它看起來跟其他拒絕一樣，使用者在維護中重新連線的那一刻，離線記的帳就會被安靜地刪掉。

所以 `MAINTENANCE` 被歸類為**可重試**（`isRetryableError`，等同於「還沒連上線」）：維護中記的帳排進佇列，維護結束後自動送出。`cloudStoreOffline.test.ts` 有一組測試釘住這件事，把 `isRetryableError` 改回 `isNetworkError` 會有三支變紅。

---

## 13. 以使用者身分唯讀檢視（view-as）

後台 → 使用者詳情 →「以他的身分檢視（唯讀）」。用來重現「我的餘額不對」這種只有從那個人的畫面才看得出來的問題。

**它不給新的資料權限。** 管理員本來就能查那個人的群組、帳目，甚至匯出個資。它給的是**另一種視角**——他看到的餘額、他的群組列表、他的未讀數——所以問題變成可重現，而不是用猜的。權限門檻因此跟「匯出個資」一致：**admin 或 owner**，support 不行。

### 怎麼運作的

一句話：**view-as token 的形狀跟 session 一模一樣**，所以 app 裡每一條讀取路徑都會自動解析成目標使用者，沒有任何一條需要知道這個功能存在。

- 存在**自己的 cookie**（`equo_view_as`），不是覆寫 `equo_session`。管理員自己的登入原封不動地留在底下，結束檢視就只是丟掉這一個 cookie——沒有任何一刻會因為手滑而把自己登出，或卡在別人的身分裡。
- `getAuthToken` 在 view-as cookie 存在時優先用它。**整個功能就靠這一行。**
- **15 分鐘到期**（一般 session 是 7 天）。忘記關的分頁不會變成一扇一直開著、看得到別人帳本的窗，不需要任何人記得去關。

### 唯讀是伺服器擋的，不是 UI 藏的

寫入的攔截跟維護模式一樣放在**路由之前**——要每一條寫入路徑自己記得的規則，就是總有一條會忘記的規則。

⚠️ **這道閘門 fail CLOSED**，跟旁邊的維護模式相反。差別在猜錯的代價：維護猜錯是大家都不能做事，所以它開；這個猜錯是用別人的名義寫進別人的帳本，所以它關。**過期或偽造的 cookie 一律拒絕寫入**，不是忽略它。

連**後台自己的寫入也擋**。管理員在 view-as 中拿的是別人的身分，「停用這個使用者」從那裡發出去，就算權限上允許，在稽核記錄裡也是一筆會讓人看不懂的東西。先結束檢視。

⚠️ **唯一的豁免是「結束檢視」本身**（`DELETE /api/v1/admin/view-as`）。它是個 DELETE，而且帶著這道閘門正在反應的那個 cookie——沒有這條豁免，出口就是這個模式唯一鎖住的門。跟「維護模式擋住自己的開關」是同一種錯，只是更難發現，因為其他每件事都正常。

### 看得出來自己在裡面

App 最上方會出現一條**最醒目的橫幅**（比維護還前面），寫明這是唯讀檢視，並帶一個「結束檢視」按鈕。**不可關閉**：底下整個畫面都是別人的東西，而管理員忘記這件事正是這個功能全部的風險。

橫幅狀態是 `GET /api/v1/site-notice` 順便回的，**每次請求現算、不進那份共用快取**——公告是一份給所有人的物件，把單一連線的狀態混進去，等於把某個管理員的 view-as 狀態顯示給全站。

### 稽核

**只記開始，不記結束。** 結束可能是按了按鈕、可能是關掉分頁、可能是到期，後兩者記不到——一份只記錄到三分之一結局的紀錄，比沒有更糟，因為它看起來是完整的。真正的界線是 token 的有效期，它寫在 `admin_audit_logs` 那筆 `user.view_as` 的 `metadata.expires_at` 裡，同時記下當時的目標信箱（使用者刪帳號後 `users` 那列會消失，只留 uuid 等於沒記）。

---

## 14. 世代留存

後台總覽最下方。依註冊時間分組，看每一組在之後每一期還有多少人在記帳。

### ⚠️ 它量不到什麼

**只有寫入有逐筆時間戳。**「活躍」＝那段期間記了一筆帳或留了一則言。開 App 看自己欠多少**不會留下任何可以回溯的痕跡**——`group_members.last_read_at` 只存最後一次、沒有歷史，做不出曲線。

對一個分帳 App 來說這是真的盲點：**那個從不記帳、但每次都準時付錢的人，在這張表上完全不存在**。它說的是「還有沒有在記帳」，不是「還有沒有在用」。

### 為什麼格子裡是人數不是比例

2026-08-26 上線當天的真實資料：**8 位使用者、3 個註冊週、其中 3 位從註冊到現在一筆都沒記過**。這種樣本下比例只是把 1/3 寫成 33.3%，而且那個人做任何事都會讓數字跳 33 個百分點。

所以：格子裡是**人數**，旁邊列出世代大小，**只有世代 ≥ 10 人才額外顯示百分比**。顏色深淺帶比例讓形狀一眼看得出來，但要讀的是數字。

**還沒發生的期間留白，不是 0。** 0 會被讀成「大家都跑光了」，而不是「還沒到那一期」。

`never_active`（註冊後從來沒記過任何一筆）在小樣本下比整張表有用，所以它單獨列在最上面一行。

### 為什麼現在就做

留存只能從你**已經有的歷史**算出來，而歷史只有在測量存在時才會累積。今天這張表是裝飾，但它今天不存在的話，明年也還是算不出來。

已刪除的支出照算——問題是「這個人那週有沒有在用」，記了又刪掉也是用過。

---

## 15. 後台的手機版面

後台是桌機介面，但出事的時候人常常只有手機。2026-08-26 用瀏覽器在 375px 實測後修的。

### 實測到的問題（不是猜的）

**每一頁的整個畫面都會左右滑動**：`scrollWidth` 786px，viewport 375px。原因只有一個，而且三頁相同——上方那條 bar：

- `.admin-nav` 九個項目共 410px，`overflow: visible`，所以它把**整個頁面**推寬。
- 被推出去的是 `.admin-sidebar__footer`（帳號與登出），它的右緣在 **x=785**——在手機上根本按不到。
- 表格本來就沒問題：`.admin-table-wrap` 有 `overflow-x: auto`，640px 的表在 295px 的框裡內部捲動，那是設計。

另外量到：所有文字欄位是 14px（**iOS 會因此在聚焦時放大整個畫面**），以及 chip／action 按鈕只有 31px 高、nav 項目 34px。

### 改法

- **nav 獨佔一整列並自己橫向捲動**，不再推頁面。不換行是刻意的：一條會折成兩三列的 tab 列，每加一個項目就會讓所有目的地換位置。
- **標籤在手機上放回來**。原本藏起來是為了把九個項目擠進共用的一列；現在 nav 有自己的一列，九個沒有標籤的圖示只是九個猜測。
- 欄位一律 16px（跟 App 本身 620px 以下的規則一致），tap target 一律 ≥ 44px。
- 使用者頁的搜尋列允許換行——匯出按鈕原本超出邊緣 9px，足以讓整頁滑動。

**全部包在既有的 `@media (max-width: 760px)` 裡**，桌機實測未受影響（sidebar 仍是 224px 直欄、chip 的 `min-height` 仍是 `auto`）。

### 這一段沒有單元測試

CSS 的 media query 在 jsdom 裡沒有版面引擎可以驗。它是**用瀏覽器量出來的**，數字都記在上面——要重驗就是把後台開在 375px，比對 `document.documentElement.scrollWidth` 跟 viewport。

---

## 16. Uptime 監控

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

## 17. 目前沒做的（要花錢或需要決策）

- Supabase Pro + PITR（完整備份、含 `auth.*`、可還原到任意時間點）
- 自訂網域（目前仍是 `equo-mu.vercel.app`）

---

## 18. LINE 記帳機器人

> **狀態（2026-09-30 啟用）**：官方帳號 `@100ujhjj`（加好友 `https://line.me/R/ti/p/@100ujhjj`），Messaging API channel `2011782046`。Webhook URL `https://equo-mu.vercel.app/api/line/webhook`（Verify 成功）、Use webhook／Webhook redelivery／Error statistics aggregation 皆開；OA Manager 的聊天、加入好友歡迎訊息、自動回應訊息皆關；Allow bot to join group chats 關。隱私權政策第 4 節已於同日上線。

用 LINE 官方帳號傳「早餐 60」，記進**個人帳本**（只記個人帳本，沒有群組 id 的參數：`line_record_entry` 靠 `ensure_personal_ledger` 自己找帳本）。綁定走 LINE 官方的 account-link 流程；日期一律用**台灣時間**、一律記在**傳訊當天**。

也能用文字指令管理個人帳本的**每月預算**：「預算 15000」設定或修改、「預算」查看、「取消預算」取消。`line_set_budget` 跟 `line_record_entry` 一樣沒有群組 id 的參數，只靠 `ensure_personal_ledger` 找帳本；它寫的就是 App「編輯帳本」改的同一個 `groups.monthly_budget_minor`，所以 App 在下一次列表同步就會看到。「預算 0」不會取消（回覆會教你傳「取消預算」）。**行為變更**：以前傳「預算 15000」／「budget 15000」會記成一筆名為「預算」的支出，現在改為設定預算。長得像設定、但文法沒認出來的說法（例如「預算 15000 餐飲」）**不會**被記成支出，而是回問「是要設定每月預算嗎？」；「預算外 300」、「預算書 200」這類真的項目名稱仍照一般記帳處理。

### 環境變數（Vercel Production）

| 變數 | 用途 |
|---|---|
| `LINE_CHANNEL_SECRET` | 驗證 webhook 簽章（HMAC-SHA256，對**原始位元組**） |
| `LINE_CHANNEL_ACCESS_TOKEN` | 回覆訊息、發 link token（長效） |
| `APP_ORIGIN` | 選填，預設 `https://equo-mu.vercel.app`；綁定連結與「開啟帳本」按鈕用 |
| `VITE_LINE_OA_URL` | **建置時**變數（改了要重新部署）：同一個網址驅動三處：個人資料頁「加入好友」連結、個人帳本首頁的 LINE 記帳提示卡、公開落地頁的「加 LINE 好友」連結。只接受 `https://lin.ee/` 或 `https://line.me/`；沒設或格式不符時三處會**靜默一起隱藏**（不會報錯） |
| `LINE_LIFF_ID` / `LINE_LOGIN_CHANNEL_ID` / `LINE_LIFF_LINKS` | 選填，在 LINE 裡開啟 Equo（LIFF）的開關；**預設全關**。說明與兩段式開關見下面「在 LINE 裡開啟（LIFF）」 |

缺少前四個之一時 webhook 回 `503 LINE_NOT_CONFIGURED`，log 只寫變數名稱不寫值。Preview 部署沒有這些變數，所以會回 503，這是預期的。**祕密不要貼進聊天、issue 或 log。**

### 端點與 kill switch

- Webhook：`POST /api/line/webhook`（獨立 function，不在 `/api/v1` 底下，因為簽章要讀原始 body）。
- **Kill switch：LINE Developers console → Messaging API → 關掉 Use webhook。** 關掉之後不會再記任何東西；已綁定的資料留著。
- 只擋寫入的維護模式對它也有效（記帳、復原、設定／取消預算，以及卡片上刪除的「詢問」與「確定刪除」兩步會回維護訊息；「本月」、「預算」（查看）與刪除流程裡的「取消」照常可用，因為取消不寫任何東西），但**解除綁定與 `DELETE /api/v1/me/line` 一律放行**（LINE 要求隨時能解除，且它只刪這個功能自己的資料）。綁定事件（`accountLink`）與發 link token 也不被維護擋住。

### Console 設定清單

- Webhook URL = `https://equo-mu.vercel.app/api/line/webhook` → Update → Verify（應為 Success）
- Use webhook：開；**Webhook redelivery：開**（安全：每筆寫入都以 `webhookEventId` 為冪等鍵）
- Error statistics aggregation：開；第一週看有沒有 `request_timeout`
- Allow bot to join group chats：**關**（程式碼也會在被加進群組時道歉並離開）
- OA Manager → Response settings：Auto-response 關、Greeting message 關（bot 自己會送歡迎訊息）
- 把加好友網址填進 Vercel `VITE_LINE_OA_URL` 並重新部署

### 資料與保留

`line_accounts`（綁定，帳號刪除時 `ON DELETE CASCADE` 帶走）、`line_link_requests`（只存 link token 與 nonce 的**雜湊**，1 天後清）、`line_bot_entries`（事件 id → 帳目，供復原用，90 天）、`line_undo_events`（每次復原嘗試的結果，讓**重送的復原**永遠得到原本的答案，不會刪到之後才記的新帳，只留 2 天，解除綁定時一併刪除）。**卡片上的刪除不用這兩張表**：它靠帳目本身永遠留著的 `expenses.client_request_id = 'line:' || <事件 id>` 找到那一筆，所以不受 90 天限制（見下面「從卡片刪除」）。清理掛在每晚 workflow 的保留步驟（第 2 節）。帳號合併（`admin_console_merge_users`）會**刪掉**被併掉那個帳號的綁定，不搬給目標帳號。

### 回覆卡片（Flex）

記帳（記帳卡加心情卡，兩張）、「本月」、「預算」與「預算 N」（查看與設定，同一張預算卡）、「說明」、加好友／請連結帳號、綁定成功這幾種回覆是 **Flex 卡片**（極光深色，程式在 `apps/web/src/server/line/lineCards.ts`），其餘維持純文字：「復原」、「解除綁定」、取消預算、已連結的人重新加好友（歡迎回來）、已連結還按「綁定」、刪除流程的詢問與結果、各種錯誤與維護訊息，以及沒設預算時的「預算」。**「復原」只出現在 Quick Reply 按鈕上，卡片裡不放；卡片裡唯一會送出 postback 的按鈕是記帳卡的「刪除」，而且它只負責「詢問」。** 每張卡片的 `altText` 就是原本那句純文字（通知列、聊天列表預覽、不支援 Flex 的舊版 LINE 看到的都是它），所以文案的單一來源仍是 `lineText.ts`。

LINE 對不喜歡的 Flex 訊息回 `400`（回應內文我們刻意不讀，所以 log 只看得到狀態碼、看不到哪個欄位被嫌），所以沒辦法事前保證每張卡片都被收。處理方式是**自動退回純文字**：回覆含 Flex 卡片而被 LINE 以 400 拒絕時，`safeReply` 會用同一個 reply token **再送一次**卡片原本取代的純文字（連結卡片退回的是「原本的文字＋按鈕範本」，所以仍然有按鈕可以點）。只有「400」且「至少一張卡片是以 Flex 送出」才會重送；純文字的 400，或 401／429／5xx／逾時都不重送，照舊只記一行 `reply failed`。另外，**組卡片的程式丟例外也不會讓已存好的帳變成錯誤訊息**：該張卡片直接改用純文字（log 見下表第三行）。

Vercel runtime logs（Logs 搜尋框）可 grep 的三種字串：

| 搜尋字串 | 等級 | 意思 | 該怎麼辦 |
|---|---|---|---|
| `flex reply rejected` | error | LINE 回 400 拒絕卡片，括號內是這則回覆以 Flex 送出的卡片名稱（不是 LINE 單獨拒絕的那一張；`record`／`mood`／`month`／`budget`／`help`／`link`／`linked`；一次記帳的回覆有兩張，所以通常寫成 `cards: record, mood`），下一步會重送純文字 | 偶發一兩筆可忽略；**同一個卡片名稱持續出現**就是卡片 JSON 有問題（或 LINE 改了規格），去對 `lineFlexValidator.ts` 的規則。兩張卡的回覆分不出 LINE 拒了哪一張：log 列的是「以 Flex 送出的卡片」，不是被拒的那一張，所以一次記帳一律寫成 `record, mood`；要到手機上看哪一張變成純文字，或對照本月／預算卡有沒有被收 |
| `text fallback` | warn：`text fallback delivered`；error：`text fallback failed: …` | 重送純文字成功（使用者沒察覺，只是看到舊樣式）／連純文字也失敗（回覆整則丟失，帳已寫入；通常是 reply token 逾時，LINE 的 reply token 很短命） | `failed` 比 `delivered` 嚴重，但帳不會因此遺失。**判斷方向**：同一個 token 上 `rejected` 之後接 `delivered`，代表卡片本身有問題；`rejected` 之後接 `failed`，多半是 reply token 已失效或用過，不是卡片的錯 |
| `card build failed` | error | 組卡片時程式丟例外，括號內是卡片名稱；該張卡片已改成純文字送出 | 這是程式 bug，要修；使用者端看起來只是樣式變回純文字 |

這三種 log 只有狀態碼（400）與上面那七個固定的卡片名稱，**不含**標題、金額、reply token、link token、email 或 LINE user id；其中 `failed`／`build failed` 後面接的是已過 `redactForLog` 的錯誤訊息。Hobby 方案的 runtime logs 只保留大約 1 小時，所以不能事後再翻：部署完立刻做手機測試，並同時開著 log（dashboard 或 `vercel logs`）看 `flex reply rejected`；這個手機測試才是卡片的真正關卡，LINE 的自然流量太少，之後不會有人替我們發現問題。

### 記帳回覆：兩則訊息與心情卡

每記一筆，機器人用**同一個 reply token 回兩則訊息**：

1. **記帳卡**：原本那張（標題、金額、分類、本月合計、預算條），底下多一排按鈕：**編輯**（綠底，`uri`，開啟這一筆的編輯畫面）和**刪除**（珊瑚色文字鈕，`postback`，只會「詢問」）。`altText` 仍是原本那句純文字。
2. **心情卡**（`mood`）：一句依情境挑的短語、一句鼓勵語（遇到里程碑時換成里程碑那句，琥珀色），以及連續記帳天數、「本月記帳 N 天 · 今天第 N 筆」和週一到週日的打勾圓圈（有記帳的日子是薄荷綠圓＋勾，沒有的日子一律是空圓，過去漏掉和還沒到的日子長一樣，卡片不指出缺口）。連續天數的里程碑（3、7、14 天…）只在當天第一筆出現，同一天再記不會重複；當天第一筆若是在 App 記的，LINE 這天就不顯示里程碑，但「連續記帳 N 天」那行每張卡都在。`altText` 是短語加連續天數（聊天列表預覽和通知顯示的就是它，所以預覽不再是「已記下支出…」）。

Quick Reply（復原／本月／明細／分析）**只掛在最後一則，也就是心情卡**，因為 LINE 在官方帳號再送出訊息時會把前一則的 Quick Reply 拿掉。退回純文字時同樣是兩則文字，Quick Reply 在第二則。

**短語怎麼挑**（`lineMood.ts`，純函式）：先看是不是收入，再看是不是大額支出（單筆 ≥ 當月預算的 20%，或 TWD ≥ NT$3,000），再看餐飲（**標題裡的字優先**：早餐／午餐／下午茶／咖啡／晚餐／宵夜…，沒有關鍵字才看台灣時間 05:00–10:30 早餐、10:30–14:00 午餐、14:00–17:00 下午茶、17:00–21:00 晚餐、其餘宵夜），最後看分類（交通、購物、娛樂、健康、居家／帳單／住宿、教育），都不是就是通用句。英文關鍵字要成為獨立的字（`tea` 不會中 `steak`）。每個情境三句，用**事件 id 的 FNV-1a** 挑，所以 LINE 重送同一個事件時文字一模一樣；連續天數這類數字則重新查（今天第 N 筆可能不同，這是預期的）。文案只在 `lineMoodText.ts`（繁中＋英文，缺任何一句型別就不過）。

**連續天數**來自 RPC `line_streak(p_line_user_id, p_today)`（`p_today` 是台灣日期）：從今天往回數、每天都有收入或支出記錄的**連續天數**（不含清償轉帳、未來日期與已刪除的帳；以帳目日期 `expense_date` 計，在 App 補記漏掉的那天也會接上）。**它在記帳寫入之後才呼叫，而且失敗不影響記帳**：RPC 丟例外、回 `ok: false`、或回的形狀不對（週不是 7 格、`today_index` 不在 0–6、計數不是非負整數…）時，心情卡照樣送出，只是少了連續天數那一段（只剩短語和鼓勵語），並寫一行 `streak unavailable`。尚未套用 `line_streak` 這支 migration 時也是這個樣子，不會壞。

### 從卡片刪除

記帳卡的**刪除**按鈕分兩步，**沒有時間限制**（跟 30 分鐘的「復原」不同）：

1. 點「刪除」→ 聊天室出現「刪除這筆」，機器人回「確定刪除『早餐 $60』？」，Quick Reply 只有**確定刪除**與**取消**。這一步不寫任何東西。
2. 點「確定刪除」→ 軟刪除這一筆，回「已刪除：早餐 $60」；點「取消」→「好的，沒有刪除。」（不呼叫資料庫）。

怎麼找到那一筆：卡片上的按鈕只帶**事件 id**（postback 資料是封閉格式 `v=1&a=del|delok|delno&k=<id>`，其他一律當作失效按鈕），機器人拿**傳訊者自己**的個人帳本，用 `expenses.client_request_id = 'line:' || <id>` 去找。所以轉傳的卡片、別人的卡片、解除綁定後重綁到別的帳號，都只會得到「找不到這筆記錄…」。

- **在 App 裡改過**：編輯支出的做法是軟刪除舊列、建新列，所以 `expenses.replaced_by_expense_id` 會記下接班的那一列，卡片會跟著換。確認文字顯示的是**現在**的標題和金額，並寫明「這筆在 App 裡改過了，現在是『…』。確定刪除？」。
- **已經刪掉了**（App 或另一次點擊）：「這筆已經刪除了。」LINE 重送同一次「確定刪除」則回原本的「已刪除：…」（以這次點擊的事件 id 當冪等鍵，不會變成「已經刪除」）；同時兩次點擊由資料列鎖序列化。
- **復原不變**：仍是 30 分鐘內、從 LINE 記的最後一筆。卡片刪除不會寫 `line_bot_entries.undone_at`，所以刪掉最新一筆之後再傳「復原」會得到「上一筆已經被修改或刪除了。」（這句文案改過，不再說「在 App 裡」）。
- 維護模式擋詢問與確定（取消不擋）；未綁定回連結卡；帳號停用回停用訊息；群組／room 的 postback 一律忽略；被限流回限流訊息。

### Quick Reply 一覽

| 回覆 | Quick Reply |
|---|---|
| 記帳（心情卡） | 復原（文字）· 本月（文字）· 明細（連結）· 分析（連結） |
| 本月卡 | 明細 · 分析 · 說明 |
| 說明卡 | 本月 · 明細 · 分析 |
| 預算（查看／設定／沒設定）、取消預算 | 本月 · 明細 · 分析 · 說明 |
| 復原的結果（已復原／沒有可復原／已被修改） | 本月 · 明細 · 分析 · 說明 |
| 刪除流程的結果（已刪除／取消／已經刪除／找不到／按鈕失效） | 本月 · 明細 · 分析 · 說明 |
| 重新加好友（歡迎回來）、已連結還按「綁定」、各種輸入錯誤（看不懂、金額不對…） | 本月 · 明細 · 分析 · 說明 |
| 綁定成功卡 | 本月 · 說明（這個事件不知道是哪個帳本，沒有連結） |
| 刪除的詢問 | 確定刪除 · 取消（postback，只有這兩個） |
| 連結卡、未綁定、解除綁定的結果、停用、維護、限流、系統錯誤、非文字訊息、群組 | 無 |

沒有個人帳本時（`context.ledger` 為空）明細與分析兩個連結會被省略。**「開啟帳本」不再出現在 Quick Reply**；本月卡的底部按鈕仍是「開啟帳本」。

### 深層連結（App 端，`lineIntent.ts`）

機器人送出的連結都開個人帳本自己的網址 `/group/<帳本 id>`，帶一個參數，`openExternalBrowser=1` 永遠排在最後（LINE 內建瀏覽器擋 Google 登入，這個參數讓它改用手機瀏覽器）：

| 連結 | 參數 | 效果 |
|---|---|---|
| 編輯（記帳卡） | `?entry=<事件 id>&openExternalBrowser=1`（id 會 URL 編碼，`msg:123` → `msg%3A123`） | 解析這個 id（`GET /api/v1/me/line/entries/:key`，只查登入者自己的個人帳本）→ 開啟編輯畫面；已刪除、找不到、暫時失敗各有一則提示 |
| 明細 | `?view=records&openExternalBrowser=1` | 開啟明細面板 |
| 分析 | `?view=analysis&openExternalBrowser=1` | 開啟分析面板 |

**LIFF 模式**（`LINE_LIFF_ID` 與 `LINE_LIFF_LINKS=1` 同時成立，見下面「在 LINE 裡開啟（LIFF）」）：編輯／明細／分析三種連結改成 `https://liff.line.me/<LIFF ID>` 加同樣的 `?entry=`／`?view=`，**沒有** `openExternalBrowser`；本月卡的「開啟帳本」仍是上表的瀏覽器連結。LIFF 頁面用 `liffBoot.readLiffIntent` 讀同一組參數（也讀登入來回後 LINE 折進 `liff.state` 的那份），一樣只認這三種形狀。

只認這三種形狀，不接受「要去哪個網址」。`entry` 與 `view` 同時出現時 `entry` 優先。讀完就從網址列拿掉 `view`／`entry`（其他參數保留），重新整理不會再開一次。尚未登入時會先存進 localStorage（`equo.clean.pending_line_intent`，15 分鐘有效）撐過 Google 登入的跳轉，登入回來再開。

### 在 LINE 裡開啟（LIFF）

> **狀態**：程式已上線，**預設全關**。LINE Login channel `2011782032`、LIFF app `2011782032-WJwjePnJ`（Full、endpoint `https://equo-mu.vercel.app/liff`、scope 只有 openid、Add friend 關）已建立。兩個 id 都不是祕密（LIFF ID 就在 LIFF 網址裡）。**這一節只描述怎麼開關與怎麼查，從來不需要也不該出現 channel secret。**

記帳卡的「編輯」與 Quick Reply 的「明細」「分析」原本把人丟去手機瀏覽器（LINE 內建瀏覽器擋 Google 登入）。LIFF 讓它們直接在 LINE 裡開：用 LINE 自己的身分登入，不經過 Google。

**怎麼運作**

1. 卡片連結變成 `https://liff.line.me/<LIFF ID>?view=records`（或 `?view=analysis`、`?entry=<事件 id>`，**沒有** `openExternalBrowser`），LINE 開 `/liff`。
2. `/liff` 先問 `GET /api/v1/line/liff` 拿 LIFF ID（`null` = 功能關閉，頁面顯示「用瀏覽器開啟」），載入 `@line/liff`（獨立的 lazy chunk，不在主 bundle），`liff.init`，必要時 `liff.login`。
3. 拿 LINE 的 ID token 去 `POST /api/v1/auth/line` 換一個 **LIFF 專用憑證**（`equoL1.…`，60 分鐘，只放在頁面記憶體裡：不進 localStorage、不進 cookie、不進網址）。這個呼叫**不帶任何 Authorization 或 cookie**，LINE ID token 也只會送到這一個端點。
4. 憑證只能用在**自己的個人帳本**，白名單在 `server/http/liffScope.ts`（`liffAllows`），前面有 `liffGate`、驗證時再問一次；沒列的路徑一律 `403 LIFF_SCOPE`。解除 LINE 綁定後憑證立即失效。
5. 頁面用同一個 App，但套 `appChrome.ts` 的 LIFF 外框：沒有群組導覽、個人資料、通知、掃描收據、登出、安裝提示與 LINE 記帳提示，只開得了明細與分析兩個面板（程式碼層也擋，不只是藏起來）。網址在登入後換成 `/group/<帳本 id>`，query 與 fragment 都拿掉。
6. 憑證過期或被拒（401）時重新換一次；換不到就停在「登入已過期，請從聊天室重新開啟」，**不會**出現 Google 登入頁。LINE ID token 過期最多自動重新登入**一次**（`sessionStorage` 守門），避免無限迴圈。頁面也會在憑證到期前約 5 分鐘安靜地先換一次（`LiffApp` 的計時器，與 401 的重換共用同一次進行中的請求），不讓「儲存」本身撞上過期；這次安靜重換失敗不會結束 session，由下一個 401 決定。
7. **只在 LINE App 裡運作**：`liff.init` 成功後若 `isInClient()` 為假（外部瀏覽器、桌面瀏覽器），直接顯示「用瀏覽器開啟」，不登入也不換憑證。理由：外部瀏覽器裡 SDK 會把 LINE 自己的 token 留在 localStorage，之後用同一個瀏覽器的人可能重新進入帳本。`liff.init` 另有 20 秒逾時，逾時視同失敗。這一頁的所有請求一旦拿到 LIFF 憑證就不再帶 cookie（`credentials: omit`），避免同一瀏覽器裡一般 App 的 `equo_session` 混進來。

**環境變數（Vercel Production，改了要重新部署，沒有 runtime 開關也沒有 DB 旗標）**

| 變數 | 用途 |
|---|---|
| `LINE_LIFF_ID` | `2011782032-WJwjePnJ`。設了之後 `/liff` 與 `POST /auth/line` 才會運作；**但卡片與按鈕的連結還是去瀏覽器**。格式 `^\d{6,20}-[A-Za-z0-9]{4,32}$`，不合格視同沒設（log 只寫變數名稱一次） |
| `LINE_LOGIN_CHANNEL_ID` | 選填。驗證 ID token 的 `client_id`；沒設就用 LIFF ID 的數字前綴（`2011782032`）。只有前綴與實際 channel 不同才需要設 |
| `LINE_LIFF_LINKS` | 只有字串 `1` 有效。前後空白與 BOM 會先被清掉，所以 `" 1"` **算開**；`true`、`0`、`11` 才算關。**必須與 `LINE_LIFF_ID` 同時成立**，編輯／明細／分析連結才改去 LIFF；本月卡的「開啟帳本」與圖文選單不變 |

**兩段式開關**：先只設 `LINE_LIFF_ID`，讓測試者自己貼 `https://liff.line.me/2011782032-WJwjePnJ?view=records` 在手機上開；真機都過了才設 `LINE_LIFF_LINKS=1`。程式只用 `LINE_LIFF_ID` 一個條件是不會把連結換掉的（`liffIdForLinks` 有測試）。

**Kill switch（都不用改程式）**

- 連結退回瀏覽器：**刪掉 `LINE_LIFF_LINKS`** → 重新部署。新送出的卡片立刻是瀏覽器連結（已送出的舊卡片還指向 LIFF，那些仍可用）。
- 整個功能關掉：再刪掉 `LINE_LIFF_ID` → 重新部署。`GET /line/liff` 回 `{"liff_id":null}`，`/liff` 顯示「暫時無法在 LINE 裡開啟，請改用瀏覽器」與開瀏覽器的連結；`POST /auth/line` 回 `503`。**已發出的 LIFF 憑證也立刻失效**：每個帶 LIFF 憑證的請求（不論路徑）都回 `401`，連解除綁定的檢查都不會做，頁面接著顯示「登入已過期」。
- LINE Login channel 取消發佈（Published → Developing）也會讓非管理員登不進去，但這是 LINE 端的開關，上面兩個才是我們自己的。

**事故時的順序（由輕到重）**

1. 只想讓新卡片退回瀏覽器：刪 `LINE_LIFF_LINKS` → 重新部署（已送出的舊卡片仍指向 LIFF）。
2. 整個關掉：刪 `LINE_LIFF_ID` → 重新部署（已發出的憑證立即失效，見上）。
3. 不想重新部署：把 LINE Login channel 取消發佈（只擋新的登入、只影響非管理員）。
4. 只處理一個人：在 LINE 傳「解除綁定」、`DELETE /me/line`，或後台停用該帳號；每個請求都會重查連結，立即生效。
5. 最後手段：輪替 `SESSION_SECRET`。**所有人**（LIFF、一般登入、view-as）都會被登出，只在確定憑證簽章金鑰外洩時用。

**LINE Developers console 還要手動做的**：channel 必須 **Published**，非 channel 管理員的好友才登入得了（Developing 狀態只有管理員可以）。其他欄位見 `docs/line-oa/README.md`。

**CSP**：只加了 `connect-src https://api.line.me`（SDK 登入與取 ID token 用）。SDK 每次 init 也會要 `static.line-scdn.net`（舊版外掛腳本、alert、統計）與 `liffsdk.line-scdn.net`（翻譯檔），**我們刻意讓它們被擋**：讀 SDK 程式碼的結論是在 LINE App 裡失敗都被 catch、不影響登入與開頁（這是讀碼推論，**沒有在真機驗證**）。**例外**：Android 外部瀏覽器的登入流程會載入 `luivendor.js`，載入器只有 `onload` 沒有 `onerror`，被 CSP 擋掉後 `liff.init` 永遠不會結束，而且回報器濾掉整個 `static.line-scdn.net`，log 裡看不到；所以現在 init 有 20 秒逾時（逾時顯示「用瀏覽器開啟」），而且外部瀏覽器本來就不開 LIFF（見上面第 7 點）。`securitypolicyviolation` 回報器（`liff/cspReporter.ts`）會把被擋的來源（只有 origin 與 directive，不含路徑與 query）送進錯誤紀錄，訊息開頭是 `[liff csp] blocked …`；上面兩個預期來源不回報。`X-Frame-Options` 與 `frame-ancestors` 沒動。**注意**：伺服器的錯誤紀錄只存 `web`／`admin` 兩種 source，所以回報的 `source: "liff"` 會被存成 `web`，辨識靠訊息前綴 `[liff csp]`。真機測試時如果 LIFF 無法登入或出現其他 CSP 回報，就是 SDK 還需要別的來源：加進對應的 directive、重新部署、再測一次。

**要看的 log／數字**

| 搜尋字串／現象 | 意思 | 該怎麼辦 |
|---|---|---|
| `[liff] exchange not_linked (<tag>)` | LINE 帳號還沒綁定就開了 LIFF（使用者看到「還沒有連結 Equo 帳號」） | `<tag>` 是 `lineUserTag`，和同一位測試者在 webhook log 的 tag 比對；**對不上代表 Login channel 與 Messaging API channel 不在同一個 provider**（LINE user id 不同），要重建 channel |
| `[liff] scope refused: <METHOD> <path>` | 白名單擋下請求（回 `403 LIFF_SCOPE`） | **正常使用下應該是零**；出現代表 App 在 LIFF 裡打了不在白名單的端點，是 client bug（`App.liff.test.tsx` 的白名單測試應該先擋到） |
| `/api/v1/auth/line` 的 `401`（`LINE_ID_TOKEN_INVALID`／`LINE_ID_TOKEN_EXPIRED`）、`403`（`LINE_NOT_LINKED`／`ACCOUNT_DISABLED`）、`429`、`503`（`LINE_UNAVAILABLE`＝向 LINE 驗證失敗或功能關閉） | 換憑證的各種結果 | 看比例，不是單筆；`LINE_UNAVAILABLE` 持續出現先查 LINE 驗證端點與 `LINE_LOGIN_CHANNEL_ID` |
| `[liff] identity lookup failed`／`link check failed, refusing request`／`per-account limit could not be counted` | 資料庫或限流計數器異常（最後一個 fail open，其餘 fail closed） | 同其他 DB 錯誤 |
| 錯誤紀錄裡 `[liff csp] blocked …` | CSP 擋到 SDK 需要的新來源 | 見上面 CSP 一段 |

**這一輪的已知取捨**

- 登入完成後網址被換成 `/group/<帳本 id>`。在**同一個分頁**重新整理（LIFF 選單的重新整理，或系統把被收掉的 WebView 還原）時，`main.tsx` 看到 `sessionStorage` 的 `equo.liff.booted` 旗標，會先 `location.replace("/liff")` 再重新登入，帳本從憑證重新取得；旗標是分頁範圍，一般瀏覽器分頁不受影響。**需真機確認**重新整理與被系統收掉再還原兩種情況。
- LIFF 只在 LINE App 裡運作（見上面第 7 點）。**LINE 電腦版**的行為必須真機確認：若它不是在 LINE 的 LIFF 瀏覽器裡開（`isInClient()` 為假），電腦版使用者會落到「用瀏覽器開啟」，改用 Google 登入；這個結果決定要不要放寬這條限制。
- LIFF 裡離線時記的帳**只存在頁面記憶體**（為了不去動一般 App 在同一個網站、同一個 localStorage 裡的離線佇列，也不讓 ledger-only 憑證去重送別的群組的寫入）：關掉視窗就沒了。
- 一般 App 與 LIFF 共用同一個網站 origin，但 LIFF **不讀、不寫、不清**一般 App 的 `equo.clean.session`。

**上線順序**（人工步驟，非程式）

1. 套用 migration `20261102090000_line_liff_identity.sql`（純新增、沒人呼叫就沒作用；兩個函式只授權給 `service_role`）。之後查權限（`anon`／`authenticated` 都必須是 false）並跑一次 advisors。順序顛倒也安全：還沒套用時換憑證回 `503 LINE_UNAVAILABLE`，什麼都不會發。
2. 推 main（此時 `LINE_LIFF_ID` 還沒設，等於沒作用）並同步 prod worktree。冒煙：`/api/v1/health` 200；**深層路徑** `GET /api/v1/groups/abc` 回 401 JSON（不是邊緣的 404）；`/liff` 回 200 的 HTML；`GET /api/v1/line/liff` 回 `{"liff_id":null}`；`POST /api/v1/auth/line {"id_token":"a.b.c"}` 回 503；`GET /api/v1/groups` 帶 `Bearer equoL1.e30.AAAA` 回 401；`/privacy` 看得到新的第 1、4 節文字。`npm run smoke:production`、`npm run smoke:production:web` 都含這些（API 冒煙也會打 `GET /api/v1/me/line/entries/abcdefgh12` 確認深層路徑是 JSON 401）。
3. **隱私權政策（第 1 節的登入句、第 4 節的 LINE Login 段落）必須已經上線**，才能設 `LINE_LIFF_ID`（`legalContent.test.ts` 守著文字）。
4. 到 Vercel Production 設 `LINE_LIFF_ID`（`LINE_LOGIN_CHANNEL_ID` 留空）→ 重新部署；冒煙：`GET /api/v1/line/liff` 回該 id、`POST /api/v1/auth/line` 帶亂湊的 token 回 401 `LINE_ID_TOKEN_INVALID`（證明 LINE 連得到、audience 設定對）。這一步起要開著 Vercel runtime logs（Hobby 只留約一小時）。
5. **真機（見下）**。Channel 還在 Developing，只有管理員登入得了，自己的手機沒問題。
6. 到 LINE Developers 把 LINE Login channel `2011782032` **Publish**；沒有這一步，非管理員的好友登不進去。可以找一位非管理員好友測一次。
7. 最後才設 `LINE_LIFF_LINKS=1` → 重新部署；傳「早餐 60」，確認編輯、明細、分析都在 LINE 裡打開，本月卡的「開啟帳本」仍開瀏覽器。

**只有真人用手機才驗得了的**（程式端的單元測試與 jsdom 驗不到 LINE 的 WebView、權限畫面與軟鍵盤），iOS 與 Android 各走一遍，淺色與深色主題各一次：

1. 傳給自己 `https://liff.line.me/2011782032-WJwjePnJ?view=records`（Keep 筆記），在 LINE 裡點開：第一次若出現授權畫面就同意 → 看到明細面板，帳本是自己的個人帳本。
2. 同樣測 `?view=analysis`。
3. `?entry=<事件 id>`（從既有記帳卡的「編輯」連結複製，注意冒號是 `%3A`）→ 打開編輯畫面 → 改一個欄位儲存 → 按返回關掉編輯 → 再按返回關掉 LIFF。
4. Android 實體返回鍵；iOS 左緣滑動返回；返回後不會跳到登入頁，也不會重複登入。
5. 編輯畫面叫出軟鍵盤（iOS）：輸入框不被蓋住、版面沒有爆開。
6. 還沒綁定的 LINE 帳號開同一個連結 → 「還沒有連結 Equo 帳號」→ 「回到聊天室」會關掉視窗。
7. 在 LIFF 裡看畫面：沒有群組導覽、個人資料、通知、掃描收據、登出；底部分頁列只有首頁、紀錄、新增、分析。
8. 一小時之後再開同一個連結：靜默換新憑證、不用再同意一次。另外開著頁面、編輯畫面填一半，放過約 55 分鐘：憑證到期前會安靜重換，草稿還在；若 LINE 自己的 ID token 已過期而被送去重新登入（草稿會丟），記下來。再測**重新整理**（LIFF 選單）與**切去別的 App 久到被系統收掉再回來**：都應該回到帳本，不是 Google 登入頁。
8a. 把 LIFF 網址貼到手機的外部瀏覽器（例如 Android Chrome）：應該直接顯示「用瀏覽器開啟」，不會一直轉圈。
9. LINE 電腦版：開不開得起 LIFF？有沒有被 iframe（我們送 DENY）？`isInClient()` 是不是真？沒開起來時會不會落到「用瀏覽器開啟」？這一項決定要不要放寬「只在 LINE App 裡運作」。
10. 長按分享 LIFF 頁的網址：網址列沒有 token、`code` 或 `access_token`。
11. 上述都過、設了 `LINE_LIFF_LINKS=1` 並部署之後：傳「早餐 60」→ 編輯、明細、分析都在 LINE 裡打開；本月卡底部的「開啟帳本」仍開手機瀏覽器。同時開著 Vercel runtime logs 看上面那張表。

### 新的 log 關鍵字

除了上面三種卡片 log，這一輪新增（都不含標題、金額、事件 id、reply token、LINE user id）：

| 搜尋字串 | 等級 | 意思 | 該怎麼辦 |
|---|---|---|---|
| `streak unavailable` | warn | 連續天數那一段拿不到，後面是原因：`not_linked`／`account_disabled`／`no_ledger`（RPC 回 `ok: false`）、`unexpected stats`（形狀不對）、或已過 `redactForLog` 的例外訊息。心情卡還是送出了，只少一段 | 單筆偶發可忽略；**每一筆都出現**多半是 `line_streak` migration 沒套或 RPC 壞了（`function … does not exist`），去補 migration |
| `postback ignored` | warn | 收到格式不認得的 postback（`postback ignored (unknown data)`）；使用者看到的是「這個按鈕已經失效了」 | 正常情況不會出現（按鈕都是我們發的）；大量出現代表按鈕格式改過而舊訊息還在被點，或有人亂送 |
| `[line] postback failed (<tag>)` | error | 處理 postback 時丟例外（刪除流程的 RPC 失敗等），使用者看到通用錯誤訊息；`<tag>` 是 `lineUserTag` 雜湊前綴 | 去看後面已過 `redactForLog` 的錯誤訊息；刪除是冪等的，但出錯後確認用的 Quick Reply 已經不在了，使用者要回到記帳卡再點一次「刪除」（會重新詢問；若第一次其實已經成功，會回「這筆已經刪除了」） |
| `card build failed (mood)` | error | 心情卡組不出來，已改成純文字（短語＋鼓勵＋連續天數）送出 | 程式 bug，要修；使用者端只是樣式變回純文字 |

**連結卡片的橫幅圖**：`apps/web/public/assets/line/link-hero-v1.jpg`（1024×512，語言中性：品牌符號、字標、一張小儀表板；原稿 `docs/line-oa/link-hero.html`，用 `docs/line-oa/render.mjs` 輸出）。卡片引用的網址是 `${APP_ORIGIN}/assets/line/link-hero-v1.jpg`，**只有 `APP_ORIGIN` 是 https 才會放橫幅**（LINE 只抓 https 圖片；本機 http 開發環境的卡片沒有橫幅，這是預期的）。放在 `/assets/` 底下是刻意的：SPA 的 catch-all rewrite 排除這個前綴，所以打錯檔名是真的 404，不會被回成 200 的 `index.html`。**檔名帶版本號是因為 `vercel.json` 把 `/assets/*` 設成 immutable、快取一年**：想換圖不能覆蓋 `link-hero-v1.jpg`（LINE 與瀏覽器都不會重抓），要存成 `link-hero-v2.jpg`，同步改 `lineCardTheme.ts` 的 `LINK_HERO_PATH`、`render.mjs` 的輸出檔名與 `scripts/smoke-production-web.py` 裡的檢查路徑，再重新部署。正式站冒煙腳本（`scripts/smoke-production-web.py`）會檢查橫幅是 `image/jpeg`、旁邊一個不存在的檔案是 404；橫幅真的 404 時卡片仍會送出，只是 LINE 在那個位置顯示空白。

### 不會出現在 log 的東西

訊息內容、reply token、link token、nonce、email、原始 LINE user id。log 只有 `lineUserTag`（雜湊前綴）、HTTP 狀態碼，以及回覆卡片的固定名稱（見上一節）。

### 上線前

隱私權政策要先寫明 LINE 這條資料流（見計畫 §11），**之後**才開 webhook。真機（iOS／Android × 已登入／未登入 Equo）要走一遍：加好友 → 綁定 → `早餐 60` → `本月` → `預算 15000` → `預算` → `取消預算` → `復原` → `解除綁定` → 再綁定；LINE 內建瀏覽器擋 Google 登入，頁面會給「用瀏覽器開啟」的連結（已帶 token 與 `openExternalBrowser=1`）。

**只有真人用手機才驗得了的（心情卡與卡片刪除這一輪；程式端的 validator 與測試都過，但 LINE 的 Flex 渲染與 postback 顯示沒有離線驗證方法）**，iOS 與 Android、LINE 淺色與深色主題各走一次：

1. 在早餐時段傳「早餐 60」→ 收到**兩則**；Quick Reply 顯示在心情卡下面；週圈圈有畫出來、勾勾看得見（深色勾在薄荷綠圓上）。
2. 聊天列表預覽與通知文字：應是短語加「連續記帳 N 天」。
3. 點「刪除」→ 聊天室出現「刪除這筆」的字樣（`displayText`，實際怎麼顯示未驗證）和確認訊息 → 點「取消」→ 再點「刪除」→「確定刪除」→「已刪除」。快速連點兩次「確定刪除」。
4. 點「編輯」→ 手機瀏覽器打開並進入編輯畫面（已登入與未登入兩種路徑）。
5. 先到 App 把那筆改掉，再用舊卡片的「刪除」→ 應看到「這筆在 App 裡改過了，現在是…」的確認文字。
6. 「明細」、「分析」兩顆 Quick Reply 打得開對的面板。
7. 傳「+52000 薪水」→ 收入的短語；很長的英文標題與英文語系版面不破。
8. 刪掉最新一筆後傳「復原」→ 「上一筆已經被修改或刪除了。」
9. 珊瑚色「刪除」文字鈕在深色卡片上的樣子（連結樣式）和與綠色「編輯」並排的比例。
