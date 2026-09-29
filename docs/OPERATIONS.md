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

缺少前四個之一時 webhook 回 `503 LINE_NOT_CONFIGURED`，log 只寫變數名稱不寫值。Preview 部署沒有這些變數，所以會回 503，這是預期的。**祕密不要貼進聊天、issue 或 log。**

### 端點與 kill switch

- Webhook：`POST /api/line/webhook`（獨立 function，不在 `/api/v1` 底下，因為簽章要讀原始 body）。
- **Kill switch：LINE Developers console → Messaging API → 關掉 Use webhook。** 關掉之後不會再記任何東西；已綁定的資料留著。
- 只擋寫入的維護模式對它也有效（記帳、復原、設定／取消預算會回維護訊息；「本月」與「預算」（查看）照常可用），但**解除綁定與 `DELETE /api/v1/me/line` 一律放行**（LINE 要求隨時能解除，且它只刪這個功能自己的資料）。綁定事件（`accountLink`）與發 link token 也不被維護擋住。

### Console 設定清單

- Webhook URL = `https://equo-mu.vercel.app/api/line/webhook` → Update → Verify（應為 Success）
- Use webhook：開；**Webhook redelivery：開**（安全：每筆寫入都以 `webhookEventId` 為冪等鍵）
- Error statistics aggregation：開；第一週看有沒有 `request_timeout`
- Allow bot to join group chats：**關**（程式碼也會在被加進群組時道歉並離開）
- OA Manager → Response settings：Auto-response 關、Greeting message 關（bot 自己會送歡迎訊息）
- 把加好友網址填進 Vercel `VITE_LINE_OA_URL` 並重新部署

### 資料與保留

`line_accounts`（綁定，帳號刪除時 `ON DELETE CASCADE` 帶走）、`line_link_requests`（只存 link token 與 nonce 的**雜湊**，1 天後清）、`line_bot_entries`（事件 id → 帳目，供復原用，90 天）、`line_undo_events`（每次復原嘗試的結果，讓**重送的復原**永遠得到原本的答案，不會刪到之後才記的新帳，只留 2 天，解除綁定時一併刪除）。清理掛在每晚 workflow 的保留步驟（第 2 節）。帳號合併（`admin_console_merge_users`）會**刪掉**被併掉那個帳號的綁定，不搬給目標帳號。

### 不會出現在 log 的東西

訊息內容、reply token、link token、nonce、email、原始 LINE user id。log 只有 `lineUserTag`（雜湊前綴）與 HTTP 狀態碼。

### 上線前

隱私權政策要先寫明 LINE 這條資料流（見計畫 §11），**之後**才開 webhook。真機（iOS／Android × 已登入／未登入 Equo）要走一遍：加好友 → 綁定 → `早餐 60` → `本月` → `預算 15000` → `預算` → `取消預算` → `復原` → `解除綁定` → 再綁定；LINE 內建瀏覽器擋 Google 登入，頁面會給「用瀏覽器開啟」的連結（已帶 token 與 `openExternalBrowser=1`）。
