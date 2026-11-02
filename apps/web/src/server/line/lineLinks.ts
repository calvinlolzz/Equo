/**
 * Every link the bot puts in front of a linked user, built in ONE place so the
 * paths and parameters the web app has to understand are written down once.
 *
 * All of them open the personal ledger's own page, /group/<ledger id> (the
 * link the bot has always used for 開啟帳本), with a query the web app reads in
 * app/lineIntent.ts:
 *
 *   ledger    /group/<id>?openExternalBrowser=1
 *   records   /group/<id>?view=records&openExternalBrowser=1    (明細)
 *   analysis  /group/<id>?view=analysis&openExternalBrowser=1   (分析)
 *   entry     /group/<id>?entry=<key>&openExternalBrowser=1     (編輯)
 *
 * `openExternalBrowser=1` is always LAST: LINE's in-app browser cannot do
 * Google sign-in, and the parameter makes LINE hand the URL to the phone's own
 * browser. The ledger id and the entry key are both encoded - a key made from a
 * message id contains ":" (msg:123...).
 *
 * LIFF mode (switched on with LINE_LIFF_LINKS=1 on top of LINE_LIFF_ID - see
 * liffIdForLinks): records, analysis and entry open inside LINE instead, at
 * https://liff.line.me/<liffId> with the same query and WITHOUT
 * openExternalBrowser (it would pull the page out of LINE again). The ledger
 * link stays the browser one: it is the "open the full ledger" footer of the
 * month card, which needs the whole app and Google sign-in.
 *
 *   records   https://liff.line.me/<liffId>?view=records
 *   analysis  https://liff.line.me/<liffId>?view=analysis
 *   entry     https://liff.line.me/<liffId>?entry=<key>
 */

export type LineLinks = {
  /** The ledger's home page. */
  ledger: string;
  /** Opens the 明細 (records) panel. */
  records: string;
  /** Opens the 分析 (analysis) panel. */
  analysis: string;
  /** Opens one entry for editing; `entryKey` is the LINE event key it was recorded under. */
  entry: (entryKey: string) => string;
};

/** A LIFF ID, the same shape runtimeEnv accepts: "<channel id>-<suffix>". Checked again here so a bad value can only ever fall back to browser links. */
const LIFF_ID_PATTERN = /^\d{6,20}-[A-Za-z0-9]{4,32}$/;

/**
 * The LIFF ID the bot's links should use, or undefined for browser links.
 *
 * Both variables are needed. LINE_LIFF_ID alone turns /liff on (a tester can
 * open it by hand); only LINE_LIFF_LINKS=1 as well moves the cards and quick
 * replies there. That is the two-step switch, and unsetting LINE_LIFF_LINKS is
 * the kill switch for the links.
 */
export function liffIdForLinks(env: { LINE_LIFF_ID?: string; LINE_LIFF_LINKS?: string }): string | undefined {
  return env.LINE_LIFF_LINKS === "1" && env.LINE_LIFF_ID ? env.LINE_LIFF_ID : undefined;
}

export function lineLinks(args: {
  appOrigin: string;
  ledgerId: string;
  /** Present = LIFF mode. */
  liff?: { liffId: string } | null;
}): LineLinks {
  const base = `${args.appOrigin}/group/${encodeURIComponent(args.ledgerId)}`;
  const external = "openExternalBrowser=1";
  const ledger = `${base}?${external}`;

  const liffId = args.liff?.liffId;
  if (liffId && LIFF_ID_PATTERN.test(liffId)) {
    const liff = `https://liff.line.me/${liffId}`;
    return {
      ledger,
      records: `${liff}?view=records`,
      analysis: `${liff}?view=analysis`,
      entry: (entryKey) => `${liff}?entry=${encodeURIComponent(entryKey)}`,
    };
  }

  return {
    ledger,
    records: `${base}?view=records&${external}`,
    analysis: `${base}?view=analysis&${external}`,
    entry: (entryKey) => `${base}?entry=${encodeURIComponent(entryKey)}&${external}`,
  };
}
