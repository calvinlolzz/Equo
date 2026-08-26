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

## 12. Uptime 監控

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

## 13. 目前沒做的（要花錢或需要決策）

- Supabase Pro + PITR（完整備份、含 `auth.*`、可還原到任意時間點）
- 自訂網域（目前仍是 `equo-mu.vercel.app`）
