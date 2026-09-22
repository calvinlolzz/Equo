import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  type AdminAutoNudgeSettings,
  type AdminCatalogCategoryRow,
  type AdminCatalogCurrencyRow,
  type AdminCatalogPayload,
  type AdminReceiptScanSettings,
  type AdminRetention,
  type AdminScanUsage,
  type ApiClientError,
  type EquoApiClient,
  type SiteNoticeResponse,
} from "./apiClient";
import { formatDate, formatDateTime, formatLatency, formatUsdMicros, scanUsageTiles } from "./adminDashboard";
import { TREND_WINDOWS } from "./adminRoute";
import { useAdminConfirm } from "./AdminConfirm";
import { hydrateCatalog } from "./catalog";

/**
 * Runtime settings an admin can change without a deploy.
 *
 * Only receipt recognition so far, and it is here rather than in an env var for
 * one reason: it is the only feature that costs money per call, so "stop it
 * now" has to be a thing somebody can do in seconds. Choosing the model is the
 * same switch and comes along for free.
 */
export function SettingsPanel({ client, canEdit }: { client: EquoApiClient; canEdit: boolean }) {
  const [settings, setSettings] = useState<AdminReceiptScanSettings | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [model, setModel] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError("");
    client
      .adminGetReceiptScanSettings()
      .then((result) => {
        if (cancelled) return;
        setSettings(result);
        setEnabled(result.enabled);
        setModel(result.model);
      })
      .catch(() => {
        if (!cancelled) setError("設定載入失敗，可能是資料庫尚未套用 app_settings migration。");
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  // The saved state is the baseline, so re-selecting the original value clears
  // the dirty flag instead of leaving a Save button that would write nothing.
  const dirty = Boolean(settings) && (enabled !== settings?.enabled || model !== settings?.model);
  const selected = settings?.models.find((entry) => entry.id === model);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!dirty || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await client.adminSetReceiptScanSettings(enabled, model);
      setSettings(saved);
      setEnabled(saved.enabled);
      setModel(saved.model);
      setNotice(saved.enabled ? `已儲存，目前使用 ${saved.model}。` : "已關閉收據辨識，使用者仍可附上照片。");
    } catch (err) {
      const code = (err as ApiClientError).code;
      setError(code === "ADMIN_FORBIDDEN" ? "只有管理員或擁有者能變更設定。" : "儲存失敗，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="設定">
      {error && <p className="admin-error" role="alert">{error}</p>}
      {notice && <p className="admin-notice" aria-live="polite">{notice}</p>}
      {!settings && !error && <p className="admin-loading" role="status">載入中…</p>}

      {settings && (
        <form className="admin-settings-card" onSubmit={save}>
          <div className="admin-settings-head">
            <h2>收據辨識</h2>
            <p>
              使用者拍下收據後自動填入金額與店名。關閉後仍會把照片附在支出上，只是需要手動輸入金額。
            </p>
          </div>

          {/* A provider without a key makes every control below cosmetic, so
              say so rather than letting someone "turn on" a model that cannot
              run. Named per provider, because the env var to add differs. */}
          {!selected?.available && (
            <p className="admin-error" role="alert">
              這個部署沒有設定 {selected?.provider === "google" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY"}
              ，選定的模型無法運作。請先在 Vercel 環境變數加入後重新部署。
            </p>
          )}

          <label className="admin-settings-row">
            <input
              type="checkbox"
              checked={enabled}
              disabled={!canEdit || busy}
              aria-label="啟用收據辨識"
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span>
              <strong>啟用收據辨識</strong>
              <small>成本異常時可立即關閉，不需重新部署。</small>
            </span>
          </label>

          <label className="admin-field">
            <span>辨識模型</span>
            <select
              value={model}
              disabled={!canEdit || busy}
              aria-label="辨識模型"
              onChange={(event) => setModel(event.target.value)}
            >
              {settings.models.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.id}
                  {option.available ? "" : "（未設定金鑰）"}
                </option>
              ))}
            </select>
            <small>{selected?.note ?? "換模型後下一次掃描立即生效。"}</small>
          </label>

          {selected?.provider === "google" && (
            <p className="admin-warning">
              <strong>Gemini 免費層會用你送出的內容訓練 Google 的模型，且真人可能閱讀。</strong>
              Google 條款明文寫著「請勿向免費服務提交敏感、機密或個人資訊」，而收據上有消費地點、時間、品項與卡號末四碼——那是使用者的個資，不是你的測試資料。
              換成別家或改用付費方案時，有<strong>兩個</strong>地方寫死了「Google Gemini 免費方案」，都要改，
              否則說法會與實際不符：隱私權政策第 3 節（<code>legalContent.ts</code>），
              以及掃描前的同意對話框（<code>uiText.ts</code> 的 <code>scanConsentBody</code>）。
            </p>
          )}

          <div className="admin-settings-foot">
            <span className="admin-muted">
              {settings.updated_at
                ? `最後變更：${formatDateTime(settings.updated_at)}${settings.updated_by_email ? `（${settings.updated_by_email}）` : ""}`
                : "尚未變更過，目前為預設值"}
            </span>
            {canEdit && (
              <button type="submit" className="admin-action admin-action--primary" disabled={!dirty || busy}>
                {busy ? "儲存中…" : "儲存"}
              </button>
            )}
          </div>
        </form>
      )}

      <SiteNoticeSection client={client} canEdit={canEdit} />

      <AutoNudgeSection client={client} canEdit={canEdit} />

      <ScanUsageSection client={client} />

      <CatalogSection client={client} canEdit={canEdit} />
    </section>
  );
}


/**
 * 站台公告與維護模式.
 *
 * The two live together because they are used together: you post the notice,
 * you do the work, you take both down. Maintenance is the only switch in this
 * console that stops everybody recording expenses, so it is the loudest control
 * on the page and every change is written to the audit log.
 */
/**
 * 世代留存.
 *
 * ⚠️ Two things about this chart are more important than the chart.
 *
 * It measures RECORDING, not use. Only writes carry a per-event timestamp, so
 * somebody who opens the app every week to check what they owe does not appear
 * here at all - which for a split-bill app is a real category of user, the one
 * who never records and always pays.
 *
 * And at a small sample a percentage is a lie with a decimal point: one person
 * out of three is 33.3%, and it moves 33 points when that person does anything.
 * So the cells show COUNTS, with the cohort size next to the row, and the
 * percentage only appears where the cohort is big enough for it to mean
 * something. The point of building it now is that retention can only ever be
 * computed from history you already have, and the history only accumulates if
 * the measurement exists.
 */
const RETENTION_MIN_COHORT_FOR_PERCENT = 10;

export function RetentionCard({ client }: { client: EquoApiClient }) {
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [data, setData] = useState<AdminRetention | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    setData(null);
    client
      .adminRetention(period, 12)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setError("留存資料載入失敗，可能是資料庫尚未套用 admin_retention migration。");
      });
    return () => {
      cancelled = true;
    };
  }, [client, period]);

  const width = data ? Math.max(0, ...data.cohorts.map((cohort) => cohort.retained.length)) : 0;

  return (
    <div className="admin-settings-card">
      <div className="admin-settings-head">
        <h2>世代留存</h2>
        <p>
          {"依註冊時間分組，看每一組在之後每一期還有多少人在記帳。格子裡是人數不是比例——樣本小的時候，比例只是把 1/3 寫成 33.3%。"}
        </p>
      </div>

      <div className="admin-chips">
        {(["week", "month"] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={period === value ? "admin-chip admin-chip--active" : "admin-chip"}
            aria-pressed={period === value}
            onClick={() => setPeriod(value)}
          >
            {value === "week" ? "每週" : "每月"}
          </button>
        ))}
      </div>

      {error && <p className="admin-error" role="alert">{error}</p>}
      {!data && !error && <p className="admin-loading" role="status">載入中…</p>}

      {data && (
        <>
          <p className="admin-retention-summary">
            {`共 ${data.total_users} 位使用者，其中 `}
            <strong>{`${data.never_active} 位註冊後從來沒記過任何一筆`}</strong>
            {"。"}
          </p>

          {data.cohorts.length === 0 ? (
            <p className="admin-loading">還沒有足夠的資料。</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table admin-retention-table">
                <thead>
                  <tr>
                    <th>{period === "week" ? "註冊週" : "註冊月"}</th>
                    <th>人數</th>
                    {Array.from({ length: width }, (_, index) => (
                      <th key={index}>{`+${index}`}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.cohorts.map((cohort) => (
                    <tr key={cohort.start}>
                      <td>{cohort.start}</td>
                      <td className="admin-table__num">{cohort.size}</td>
                      {Array.from({ length: width }, (_, index) => {
                        const value = cohort.retained[index];
                        if (value === undefined) {
                          // Not a zero: this period has not happened yet for
                          // this cohort. Showing 0 would read as everybody
                          // leaving rather than as no data.
                          return <td key={index} className="admin-retention-cell admin-retention-cell--future" />;
                        }
                        const share = cohort.size > 0 ? value / cohort.size : 0;
                        return (
                          <td
                            key={index}
                            className={value > 0 ? "admin-retention-cell admin-retention-cell--live" : "admin-retention-cell"}
                            // Opacity carries the proportion so the shape is
                            // readable at a glance, while the number stays the
                            // thing you actually read.
                            style={value > 0 ? { opacity: 0.35 + share * 0.65 } : undefined}
                          >
                            {value}
                            {cohort.size >= RETENTION_MIN_COHORT_FOR_PERCENT && (
                              <small>{`${Math.round(share * 100)}%`}</small>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="admin-retention-caveat">
            {"⚠️ 這裡的「活躍」是記了一筆帳或留了一則言。只開 App 看自己欠多少不會留下可回溯的紀錄，所以那個從不記帳、但每次都準時付錢的人，在這張表上完全不存在。"}
          </p>
        </>
      )}
    </div>
  );
}

function SiteNoticeSection({ client, canEdit }: { client: EquoApiClient; canEdit: boolean }) {
  const [saved, setSaved] = useState<SiteNoticeResponse | null>(null);
  const [message, setMessage] = useState("");
  const [level, setLevel] = useState<"info" | "warning">("info");
  const [endsAt, setEndsAt] = useState("");
  const [maintenance, setMaintenance] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  function apply(next: SiteNoticeResponse) {
    setSaved(next);
    setMessage(next.banner.message);
    setLevel(next.banner.level);
    // <input type="datetime-local"> wants a local "YYYY-MM-DDTHH:mm" with no
    // zone; the API speaks ISO UTC. Slice off the seconds and the Z after
    // shifting into local time, or the operator sees a time that is not the one
    // they set.
    setEndsAt(next.banner.ends_at ? toLocalInputValue(next.banner.ends_at) : "");
    setMaintenance(next.maintenance.enabled);
    setMaintenanceMessage(next.maintenance.message);
  }

  useEffect(() => {
    let cancelled = false;
    setError("");
    client
      .adminGetSiteNotice()
      .then((result) => {
        if (!cancelled) apply(result);
      })
      .catch(() => {
        if (!cancelled) setError("設定載入失敗，可能是資料庫尚未套用 site_notice migration。");
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const dirty =
    Boolean(saved) &&
    (message !== saved?.banner.message ||
      level !== saved?.banner.level ||
      maintenance !== saved?.maintenance.enabled ||
      maintenanceMessage !== saved?.maintenance.message ||
      endsAt !== (saved?.banner.ends_at ? toLocalInputValue(saved.banner.ends_at) : ""));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!dirty || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await client.adminSetSiteNotice({
        banner_message: message,
        banner_level: level,
        banner_ends_at: endsAt ? new Date(endsAt).toISOString() : null,
        maintenance_enabled: maintenance,
        maintenance_message: maintenanceMessage,
      });
      apply(next);
      setNotice(
        next.maintenance.enabled
          ? "維護模式已開啟：所有人都還能看，但沒有人能記帳。最多 30 秒後全面生效。"
          : next.banner.active
            ? "公告已上架。"
            : "已收起公告，維護模式關閉。",
      );
    } catch (err) {
      const code = (err as ApiClientError).code;
      setError(code === "ADMIN_FORBIDDEN" ? "只有管理員或擁有者能變更設定。" : "儲存失敗，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-settings-card">
      <div className="admin-settings-head">
        <h2>站台公告與維護</h2>
        <p>
          {"公告會顯示在所有人的畫面最上方（包含還沒登入的登入頁）。維護模式只擋寫入：大家還是看得到自己的帳，只是暫時記不了帳——後台本身不受影響，否則就關不掉了。"}
        </p>
      </div>

      {error && <p className="admin-error" role="alert">{error}</p>}
      {notice && <p className="admin-notice" aria-live="polite">{notice}</p>}
      {!saved && !error && <p className="admin-loading" role="status">載入中…</p>}

      {saved && (
        <form onSubmit={save}>
          <label className="admin-field">
            <span>公告內容</span>
            <input
              type="text"
              maxLength={500}
              value={message}
              disabled={!canEdit || busy}
              placeholder="例：8/30 22:00-23:00 會短暫維護"
              aria-label="公告內容"
              onChange={(event) => setMessage(event.target.value)}
            />
            <small>留空就是沒有公告。這句話不會被翻譯，使用者看到的就是你寫的。</small>
          </label>

          {/* Style and expiry are both short answers about the same banner, so
              they share a line instead of each taking a full-width row. */}
          <div className="admin-field-pair">
            <label className="admin-field">
              <span>公告樣式</span>
              <select
                value={level}
                disabled={!canEdit || busy}
                aria-label="公告樣式"
                onChange={(event) => setLevel(event.target.value === "warning" ? "warning" : "info")}
              >
                <option value="info">一般</option>
                <option value="warning">警告</option>
              </select>
              <small>只影響顏色，不影響是否顯示。</small>
            </label>

            <label className="admin-field">
              <span>公告結束時間</span>
              <input
                type="datetime-local"
                value={endsAt}
                disabled={!canEdit || busy}
                aria-label="公告結束時間"
                onChange={(event) => setEndsAt(event.target.value)}
              />
              <small>時間到就自動收起來。留空＝一直掛著——但沒有人會記得回來拿掉。</small>
            </label>
          </div>

          {/* Everything above is the banner; everything below stops people
              recording expenses. One card, because you post the notice and do
              the work in one sitting - but not one undifferentiated list. */}
          <hr className="admin-settings-rule" />

          <label className="admin-settings-row">
            <input
              type="checkbox"
              checked={maintenance}
              disabled={!canEdit || busy}
              aria-label="啟用維護模式"
              onChange={(event) => setMaintenance(event.target.checked)}
            />
            <span>
              <strong>啟用維護模式</strong>
              <small>
                {"擋掉所有寫入（讀取照常）。使用者這時記的帳會排進離線佇列，維護結束後自動送出，不會不見。開關生效最多要 30 秒。"}
              </small>
            </span>
          </label>

          <label className="admin-field">
            <span>維護說明</span>
            <input
              type="text"
              maxLength={500}
              value={maintenanceMessage}
              disabled={!canEdit || busy}
              placeholder="例：資料庫升級中，約 20 分鐘"
              aria-label="維護說明"
              onChange={(event) => setMaintenanceMessage(event.target.value)}
            />
            <small>留空的話會用預設句子。</small>
          </label>

          <div className="admin-settings-foot admin-settings-foot--end">
            {canEdit && (
              <button className="admin-action admin-action--primary" type="submit" disabled={!dirty || busy}>
                {busy ? "儲存中…" : "儲存"}
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

/** ISO UTC -> the local "YYYY-MM-DDTHH:mm" a datetime-local input expects. */
function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 自動催繳 — the only thing in the product that messages somebody without a
 * person deciding to, which is why it ships off and lives behind a switch an
 * admin can reach in seconds.
 *
 * The reminder goes to the person who OWES, and carries no sender: it reads as
 * "你還有 X 未結清", not as somebody chasing them.
 */
function AutoNudgeSection({ client, canEdit }: { client: EquoApiClient; canEdit: boolean }) {
  const [saved, setSaved] = useState<AdminAutoNudgeSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [overdueDays, setOverdueDays] = useState(14);
  const [cooldownDays, setCooldownDays] = useState(7);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError("");
    client
      .adminGetAutoNudge()
      .then((result) => {
        if (cancelled) return;
        setSaved(result);
        setEnabled(result.enabled);
        setOverdueDays(result.overdue_days);
        setCooldownDays(result.cooldown_days);
      })
      .catch(() => {
        if (!cancelled) setError("設定載入失敗，可能是資料庫尚未套用 auto_nudge migration。");
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const dirty =
    Boolean(saved) &&
    (enabled !== saved?.enabled ||
      overdueDays !== saved?.overdue_days ||
      cooldownDays !== saved?.cooldown_days);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!dirty || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await client.adminSetAutoNudge({
        enabled,
        overdue_days: overdueDays,
        cooldown_days: cooldownDays,
      });
      setSaved(next);
      setEnabled(next.enabled);
      setOverdueDays(next.overdue_days);
      setCooldownDays(next.cooldown_days);
      setNotice(
        next.enabled
          ? `已開啟：欠款超過 ${next.overdue_days} 天會自動提醒，每 ${next.cooldown_days} 天最多一次。`
          : "已關閉自動催繳。",
      );
    } catch (err) {
      const code = (err as ApiClientError).code;
      setError(code === "ADMIN_FORBIDDEN" ? "只有管理員或擁有者能變更設定。" : "儲存失敗，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-settings-card">
      <div className="admin-settings-head">
        <h2>自動催繳</h2>
        <p>
          {"欠款超過一段時間就自動推播提醒。提醒送給「欠錢的人」，而且不具名——內容是「你還有 X 未結清」，不會寫成某個人在催你。"}
        </p>
      </div>

      {error && <p className="admin-error" role="alert">{error}</p>}
      {notice && <p className="admin-notice" aria-live="polite">{notice}</p>}
      {!saved && !error && <p className="admin-loading" role="status">載入中…</p>}

      {saved && (
        <form onSubmit={save}>
          <label className="admin-settings-row">
            <input
              type="checkbox"
              checked={enabled}
              disabled={!canEdit || busy}
              aria-label="啟用自動催繳"
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span>
              <strong>啟用自動催繳</strong>
              <small>這是產品裡唯一不需要有人按下按鈕就會送出通知的功能，預設關閉。</small>
            </span>
          </label>

          {/* Two numbers of days, which is one thought about pacing. Side by
              side they can be compared; stacked they read as two features. */}
          <div className="admin-field-pair">
            <label className="admin-field">
              <span>欠款幾天後提醒</span>
              <input
                type="number"
                min={1}
                max={365}
                value={overdueDays}
                disabled={!canEdit || busy}
                aria-label="欠款幾天後提醒"
                onChange={(event) => setOverdueDays(Number(event.target.value))}
              />
              <small>從「最舊一筆還沒結清的支出」算起。</small>
            </label>

            <label className="admin-field">
              <span>同一個人幾天內最多提醒一次</span>
              <input
                type="number"
                min={1}
                max={365}
                value={cooldownDays}
                disabled={!canEdit || busy}
                aria-label="同一個人幾天內最多提醒一次"
                onChange={(event) => setCooldownDays(Number(event.target.value))}
              />
              <small>手動的「提醒還款」也算進這個間隔，不會兩邊各送一次。</small>
            </label>
          </div>

          <div className="admin-settings-foot">
            <span className="admin-muted">
              {saved.updated_at
                ? `最後變更：${formatDateTime(saved.updated_at)}${saved.updated_by_email ? `（${saved.updated_by_email}）` : ""}`
                : "尚未變更過，目前為預設值（關閉）"}
            </span>
            {canEdit && (
              <button
                type="submit"
                className="admin-action admin-action--primary"
                disabled={!dirty || busy}
                aria-label="儲存自動催繳設定"
              >
                {busy ? "儲存中…" : "儲存"}
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * What receipt recognition actually did, and what it cost.
 *
 * Directly under the switch that controls it, because the two are one thought:
 * the reason the kill switch exists is per-call spend, and until now the switch
 * was here while every number about it was in Vercel's log drain — ageing out,
 * un-aggregatable, and invisible to whoever had to decide whether to flip it.
 *
 * The rate limit (30/hour/user) had the same blind spot: enforced, with no way
 * to see whether anybody was hitting it. That is what 掃描最多的使用者 answers.
 */
function ScanUsageSection({ client }: { client: EquoApiClient }) {
  const [days, setDays] = useState(30);
  const [usage, setUsage] = useState<AdminScanUsage | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    setUsage(null);
    client
      .adminScanUsage(days)
      .then((result) => {
        if (!cancelled) setUsage(result);
      })
      .catch(() => {
        if (!cancelled) setError("用量載入失敗，可能是資料庫尚未套用 receipt_scan_logs migration。");
      });
    return () => {
      cancelled = true;
    };
  }, [client, days]);

  return (
    <div className="admin-settings-card">
      <div className="admin-subheading-row">
        <h3 className="admin-subheading">辨識用量</h3>
        <div className="admin-chips">
          {TREND_WINDOWS.map((option) => (
            <button
              key={option}
              type="button"
              className={option === days ? "admin-chip admin-chip--active" : "admin-chip"}
              onClick={() => setDays(option)}
            >
              {`${option} 日`}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="admin-error" role="alert">{error}</p>}
      {!usage && !error && <p className="admin-loading" role="status">載入中…</p>}

      {usage && (
        <>
          <div className="admin-tiles">
            {scanUsageTiles(usage).map((tile) => (
              <article key={tile.key} className={tile.danger ? "admin-tile admin-tile--danger" : "admin-tile"}>
                <p className="admin-tile__label">{tile.label}</p>
                <p className="admin-tile__value">{tile.value}</p>
                {tile.hint && <p className="admin-tile__hint">{tile.hint}</p>}
              </article>
            ))}
          </div>

          {usage.summary.scans === 0 ? (
            <p className="admin-muted">{`近 ${usage.days} 天沒有任何掃描。`}</p>
          ) : (
            <>
              {/* Per model, because switching model is the one lever this panel
                  informs — and the only way to see what the last switch did. */}
              <h4 className="admin-subheading admin-subheading--spaced">依模型</h4>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>模型</th>
                      <th className="admin-table__num">次數</th>
                      <th className="admin-table__num">失敗</th>
                      <th className="admin-table__num">中位耗時</th>
                      <th className="admin-table__num">花費</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.by_model.map((row) => (
                      <tr key={row.model}>
                        <td>{row.model}</td>
                        <td className="admin-table__num">{row.scans}</td>
                        <td className="admin-table__num">{row.failed}</td>
                        <td className="admin-table__num">{formatLatency(row.p50_ms)}</td>
                        <td className="admin-table__num">{formatUsdMicros(row.cost_micros)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h4 className="admin-subheading admin-subheading--spaced">掃描最多的使用者</h4>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>使用者</th>
                      <th className="admin-table__num">次數</th>
                      <th className="admin-table__num">失敗</th>
                      <th className="admin-table__num">花費</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.top_users.map((row) => (
                      <tr key={row.user_id ?? row.email}>
                        <td>{row.email}</td>
                        <td className="admin-table__num">{row.scans}</td>
                        <td className="admin-table__num">{row.failed}</td>
                        <td className="admin-table__num">{formatUsdMicros(row.cost_micros)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* "12% 失敗" is where the question starts; the upstream's own
                  message is usually where it ends. */}
              {usage.recent_failures.length > 0 && (
                <>
                  <h4 className="admin-subheading admin-subheading--spaced">最近的失敗</h4>
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>時間</th>
                          <th>模型</th>
                          <th>使用者</th>
                          <th>原因</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usage.recent_failures.map((row) => (
                          <tr key={`${row.created_at}_${row.email}`}>
                            <td>{formatDateTime(row.created_at)}</td>
                            <td>{row.model}</td>
                            <td>{row.email}</td>
                            <td>{row.failure_reason || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Master data: the category list, the currency list, and manual exchange rates.
 *
 * All three used to be constants in the app bundle, so adding 醫療 or turning on
 * SGD was a deploy. Editing is inline rather than behind a modal because the
 * rows are three fields each and the common change is a single label.
 *
 * A category is never deleted, only switched off: expenses.category holds the
 * key as text, so a removed row would leave live expenses pointing at a label
 * nothing can render. The row shows how many expenses it carries so that
 * decision is made with the number in view.
 */
/**
 * Read-only for stage 1 - see the personal ledger plan's §4g/§9: editing scope
 * from the console is deferred, so this is display only, not another input on
 * the edit row. Admin text is never translated (see the i18n plan note), so
 * these three labels are plain 中文 rather than UI_TEXT keys.
 */
const CATEGORY_SCOPE_LABEL: Record<"shared" | "personal" | "income", string> = {
  shared: "群組",
  personal: "個人",
  income: "收入",
};

function CatalogSection({ client, canEdit }: { client: EquoApiClient; canEdit: boolean }) {
  const [catalog, setCatalog] = useState<AdminCatalogPayload | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  /** The row being edited, as a draft; null means nothing is open. */
  const [categoryDraft, setCategoryDraft] = useState<AdminCatalogCategoryRow | null>(null);
  const [currencyDraft, setCurrencyDraft] = useState<AdminCatalogCurrencyRow | null>(null);
  const [ratePair, setRatePair] = useState({ base: "TWD", quote: "JPY", rate: "", note: "" });

  useEffect(() => {
    let cancelled = false;
    client
      .adminGetCatalog()
      .then((result) => {
        if (cancelled) return;
        setCatalog(result);
        // The console renders expense categories from the same module the app
        // does, so hydrating here keeps the expense-edit picker in step with
        // what this panel just showed.
        hydrateCatalog({
          categories: result.categories.filter((row) => row.enabled),
          currencies: result.currencies.filter((row) => row.enabled),
        });
      })
      .catch(() => {
        if (!cancelled) setError("主資料載入失敗，可能是資料庫尚未套用 app_catalog migration。");
      });
    return () => {
      cancelled = true;
    };
  }, [client, reloadKey]);

  async function run(key: string, action: () => Promise<string>) {
    setBusyKey(key);
    setError("");
    setNotice("");
    try {
      setNotice(await action());
      setReloadKey((current) => current + 1);
    } catch (caught) {
      setError((caught as ApiClientError).message || "儲存失敗，請稍後再試。");
    } finally {
      setBusyKey("");
    }
  }

  const blankCategory: AdminCatalogCategoryRow = {
    key: "",
    label: "",
    color: "#93a0b5",
    sort_order: 100,
    enabled: true,
  };

  const blankCurrency: AdminCatalogCurrencyRow = { code: "", label: "", sort_order: 100, enabled: true };

  return (
    <>
      <h3 className="admin-subheading admin-subheading--spaced">支出分類</h3>
      <p className="admin-modal__hint">
        分類只能停用不能刪除：已經記過帳的分類鍵值還留在支出上，刪掉會讓那些帳目顯示不出名稱。
      </p>

      {error && <p className="admin-error" role="alert">{error}</p>}
      {notice && <p className="admin-notice" aria-live="polite">{notice}</p>}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>鍵值</th>
              <th>名稱</th>
              <th>顏色</th>
              <th>適用</th>
              <th className="admin-table__num">排序</th>
              <th className="admin-table__num">使用中帳目</th>
              <th>狀態</th>
              <th>最後變更</th>
              {canEdit && <th>操作</th>}
            </tr>
          </thead>
          <tbody>
            {(catalog?.categories ?? []).map((row) => (
              <tr key={row.key} className={row.enabled ? undefined : "admin-table__row--deleted"}>
                <td><code>{row.key}</code></td>
                <td>{row.label}</td>
                <td>
                  <span className="admin-swatch" style={{ background: row.color }} aria-hidden="true" />
                  <code>{row.color}</code>
                </td>
                <td>{CATEGORY_SCOPE_LABEL[row.scope ?? "shared"]}</td>
                <td className="admin-table__num">{row.sort_order}</td>
                <td className="admin-table__num">{(row.expense_count ?? 0).toLocaleString("zh-TW")}</td>
                <td>{row.enabled ? "使用中" : <span className="admin-badge">已停用</span>}</td>
                <td>
                  {row.updated_at ? formatDate(row.updated_at) : "—"}
                  {row.updated_by_email ? <span className="admin-muted">（{row.updated_by_email}）</span> : null}
                </td>
                {canEdit && (
                  <td className="admin-table__actions">
                    <button type="button" className="admin-action" onClick={() => setCategoryDraft(row)}>
                      編輯
                    </button>
                    <button
                      type="button"
                      className="admin-action"
                      disabled={busyKey === row.key}
                      onClick={() =>
                        run(row.key, async () => {
                          await client.adminSaveCategory(row.key, {
                            label: row.label,
                            color: row.color,
                            sort_order: row.sort_order,
                            enabled: !row.enabled,
                          });
                          return row.enabled ? `已停用「${row.label}」，現有帳目不受影響。` : `已重新啟用「${row.label}」。`;
                        })
                      }
                    >
                      {row.enabled ? "停用" : "啟用"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {catalog?.categories.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 8 : 7} className="admin-table__empty">
                  沒有分類
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canEdit && !categoryDraft && (
        <button type="button" className="admin-action" onClick={() => setCategoryDraft(blankCategory)}>
          新增分類
        </button>
      )}

      {canEdit && categoryDraft && (
        <form
          className="admin-notify-form"
          onSubmit={(event) => {
            event.preventDefault();
            const draft = categoryDraft;
            void run(draft.key || "new-category", async () => {
              await client.adminSaveCategory(draft.key, {
                label: draft.label,
                color: draft.color,
                sort_order: draft.sort_order,
                enabled: draft.enabled,
              });
              setCategoryDraft(null);
              return `已儲存分類「${draft.label}」。`;
            });
          }}
        >
          <label className="admin-field">
            <span>鍵值（存進帳目裡的值，建立後不能改）</span>
            <input
              value={categoryDraft.key}
              onChange={(event) => setCategoryDraft({ ...categoryDraft, key: event.target.value })}
              placeholder="medical"
              pattern="[a-z][a-z0-9_]*"
              maxLength={31}
              required
              disabled={Boolean(catalog?.categories.some((row) => row.key === categoryDraft.key))}
            />
          </label>
          <label className="admin-field">
            <span>顯示名稱</span>
            <input
              value={categoryDraft.label}
              onChange={(event) => setCategoryDraft({ ...categoryDraft, label: event.target.value })}
              maxLength={20}
              required
            />
          </label>
          <label className="admin-field">
            <span>顏色（分析圓餅圖用）</span>
            <input
              type="color"
              value={categoryDraft.color}
              onChange={(event) => setCategoryDraft({ ...categoryDraft, color: event.target.value })}
            />
          </label>
          <label className="admin-field">
            <span>排序（小的排前面）</span>
            <input
              type="number"
              value={categoryDraft.sort_order}
              min={0}
              max={9999}
              onChange={(event) =>
                setCategoryDraft({ ...categoryDraft, sort_order: Number(event.target.value) || 0 })
              }
            />
          </label>
          <div className="admin-modal__actions">
            <button type="submit" className="admin-action admin-action--primary" disabled={busyKey !== ""}>
              儲存
            </button>
            <button type="button" className="admin-action" onClick={() => setCategoryDraft(null)}>
              取消
            </button>
          </div>
        </form>
      )}

      <h3 className="admin-subheading admin-subheading--spaced">幣別</h3>
      <p className="admin-modal__hint">還有帳目用這個幣別記錄時無法停用——那些金額仍然是這個幣別，app 會找不到名稱可以顯示。</p>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>代碼</th>
              <th>名稱</th>
              <th className="admin-table__num">排序</th>
              <th className="admin-table__num">使用中帳目</th>
              <th>狀態</th>
              {canEdit && <th>操作</th>}
            </tr>
          </thead>
          <tbody>
            {(catalog?.currencies ?? []).map((row) => (
              <tr key={row.code} className={row.enabled ? undefined : "admin-table__row--deleted"}>
                <td><code>{row.code}</code></td>
                <td>{row.label}</td>
                <td className="admin-table__num">{row.sort_order}</td>
                <td className="admin-table__num">{(row.expense_count ?? 0).toLocaleString("zh-TW")}</td>
                <td>{row.enabled ? "使用中" : <span className="admin-badge">已停用</span>}</td>
                {canEdit && (
                  <td className="admin-table__actions">
                    <button type="button" className="admin-action" onClick={() => setCurrencyDraft(row)}>
                      編輯
                    </button>
                    <button
                      type="button"
                      className="admin-action"
                      disabled={busyKey === row.code}
                      onClick={() =>
                        run(row.code, async () => {
                          await client.adminSaveCurrency(row.code, {
                            label: row.label,
                            sort_order: row.sort_order,
                            enabled: !row.enabled,
                          });
                          return row.enabled ? `已停用 ${row.code}。` : `已啟用 ${row.code}。`;
                        })
                      }
                    >
                      {row.enabled ? "停用" : "啟用"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && !currencyDraft && (
        <button type="button" className="admin-action" onClick={() => setCurrencyDraft(blankCurrency)}>
          新增幣別
        </button>
      )}

      {canEdit && currencyDraft && (
        <form
          className="admin-notify-form"
          onSubmit={(event) => {
            event.preventDefault();
            const draft = currencyDraft;
            void run(draft.code || "new-currency", async () => {
              await client.adminSaveCurrency(draft.code, {
                label: draft.label,
                sort_order: draft.sort_order,
                enabled: draft.enabled,
              });
              setCurrencyDraft(null);
              return `已儲存幣別 ${draft.code.toUpperCase()}。`;
            });
          }}
        >
          <label className="admin-field">
            <span>ISO 代碼</span>
            <input
              value={currencyDraft.code}
              onChange={(event) => setCurrencyDraft({ ...currencyDraft, code: event.target.value.toUpperCase() })}
              placeholder="SGD"
              pattern="[A-Za-z]{3}"
              maxLength={3}
              required
              disabled={Boolean(catalog?.currencies.some((row) => row.code === currencyDraft.code))}
            />
          </label>
          <label className="admin-field">
            <span>顯示名稱</span>
            <input
              value={currencyDraft.label}
              onChange={(event) => setCurrencyDraft({ ...currencyDraft, label: event.target.value })}
              maxLength={20}
              required
            />
          </label>
          <label className="admin-field">
            <span>排序</span>
            <input
              type="number"
              value={currencyDraft.sort_order}
              min={0}
              max={9999}
              onChange={(event) =>
                setCurrencyDraft({ ...currencyDraft, sort_order: Number(event.target.value) || 0 })
              }
            />
          </label>
          <div className="admin-modal__actions">
            <button type="submit" className="admin-action admin-action--primary" disabled={busyKey !== ""}>
              儲存
            </button>
            <button type="button" className="admin-action" onClick={() => setCurrencyDraft(null)}>
              取消
            </button>
          </div>
        </form>
      )}

      <h3 className="admin-subheading admin-subheading--spaced">匯率覆寫</h3>
      <p className="admin-modal__hint">
        設定後這組幣別會改用你填的數字，上游報價會被蓋掉，而且立刻生效（不等 6 小時快取）。留空並儲存即可清除，讓它回去跟隨上游。
      </p>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>幣別對</th>
              <th className="admin-table__num">匯率</th>
              <th>說明</th>
              <th>最後變更</th>
              {canEdit && <th>操作</th>}
            </tr>
          </thead>
          <tbody>
            {(catalog?.rate_overrides ?? []).map((row) => (
              <tr key={`${row.base}-${row.quote}`}>
                <td>
                  1 {row.base} → {row.quote}
                </td>
                <td className="admin-table__num">{row.rate}</td>
                <td>{row.note ?? "—"}</td>
                <td>
                  {formatDate(row.updated_at)}
                  {row.updated_by_email ? <span className="admin-muted">（{row.updated_by_email}）</span> : null}
                </td>
                {canEdit && (
                  <td className="admin-table__actions">
                    <button
                      type="button"
                      className="admin-action admin-action--danger"
                      disabled={busyKey === `${row.base}-${row.quote}`}
                      onClick={() =>
                        run(`${row.base}-${row.quote}`, async () => {
                          await client.adminSetRateOverride({ base: row.base, quote: row.quote, rate: null });
                          return `已清除 ${row.base}→${row.quote} 的覆寫，恢復跟隨上游。`;
                        })
                      }
                    >
                      清除
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {catalog?.rate_overrides.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 5 : 4} className="admin-table__empty">
                  沒有覆寫，全部跟隨上游報價
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <form
          className="admin-notify-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(`${ratePair.base}-${ratePair.quote}`, async () => {
              await client.adminSetRateOverride({
                base: ratePair.base.toUpperCase(),
                quote: ratePair.quote.toUpperCase(),
                rate: ratePair.rate.trim() ? Number(ratePair.rate) : null,
                note: ratePair.note.trim() || undefined,
              });
              const cleared = !ratePair.rate.trim();
              setRatePair({ ...ratePair, rate: "", note: "" });
              return cleared
                ? `已清除 ${ratePair.base}→${ratePair.quote} 的覆寫。`
                : `已設定 1 ${ratePair.base} = ${ratePair.rate} ${ratePair.quote}。`;
            });
          }}
        >
          <div className="admin-inline-form">
            <label className="admin-field">
              <span>基準幣別</span>
              <input
                value={ratePair.base}
                onChange={(event) => setRatePair({ ...ratePair, base: event.target.value.toUpperCase() })}
                pattern="[A-Za-z]{3}"
                maxLength={3}
                required
              />
            </label>
            <label className="admin-field">
              <span>報價幣別</span>
              <input
                value={ratePair.quote}
                onChange={(event) => setRatePair({ ...ratePair, quote: event.target.value.toUpperCase() })}
                pattern="[A-Za-z]{3}"
                maxLength={3}
                required
              />
            </label>
          </div>
          <label className="admin-field">
            <span>1 {ratePair.base || "???"} 等於多少 {ratePair.quote || "???"}（留空＝清除覆寫）</span>
            <input
              type="number"
              step="0.00000001"
              min="0"
              value={ratePair.rate}
              onChange={(event) => setRatePair({ ...ratePair, rate: event.target.value })}
              placeholder="4.7"
            />
          </label>
          <label className="admin-field">
            <span>說明（為什麼要手動設定）</span>
            <input
              value={ratePair.note}
              onChange={(event) => setRatePair({ ...ratePair, note: event.target.value })}
              maxLength={200}
              placeholder="上游沒有這組報價"
            />
          </label>
          <div className="admin-modal__actions">
            <button type="submit" className="admin-action admin-action--primary" disabled={busyKey !== ""}>
              儲存匯率
            </button>
          </div>
        </form>
      )}
    </>
  );
}
