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

export function lineLinks(args: { appOrigin: string; ledgerId: string }): LineLinks {
  const base = `${args.appOrigin}/group/${encodeURIComponent(args.ledgerId)}`;
  const external = "openExternalBrowser=1";

  return {
    ledger: `${base}?${external}`,
    records: `${base}?view=records&${external}`,
    analysis: `${base}?view=analysis&${external}`,
    entry: (entryKey) => `${base}?entry=${encodeURIComponent(entryKey)}&${external}`,
  };
}
