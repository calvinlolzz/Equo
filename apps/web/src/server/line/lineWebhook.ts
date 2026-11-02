import { formatAmount } from "../../app/formatAmount.js";
import type { PostgrestClient } from "../db/postgrestClient.js";
import { loadSiteNotice } from "../http/maintenance.js";
import { fill } from "../push/pushText.js";
import { LineApiError, type LineClient } from "./lineClient.js";
import { categoryDisplay } from "./lineCardTheme.js";
import type { MonthCategory } from "./lineCards.js";
import { lineUserTag, redactForLog, sha256Hex, verifyLineSignature } from "./lineCrypto.js";
import { type LineCommandErrorReason, parseLineCommand } from "./lineCommand.js";
import { lineDateKey, lineMonthStart, lineTaiwanMinuteOfDay } from "./lineDates.js";
import { type LineLinks, lineLinks } from "./lineLinks.js";
import {
  type LineOutgoing,
  budgetClearedReply,
  budgetReply,
  deleteConfirmReply,
  deleteResultReply,
  fallbackMessages,
  helpReply,
  isLineCard,
  linkPageUrl,
  linkReply,
  linkedReply,
  maskEmail,
  monthReply,
  recordedReply,
  standardQuickReply,
  textMessage,
  wireMessages,
} from "./lineMessages.js";
import { type LineStreakStats, moodBucket, parseStreakStats, pickMood } from "./lineMood.js";
import { lineMoodText } from "./lineMoodText.js";
import { parseLinePostback } from "./linePostback.js";
import {
  type LineContext,
  type LineEntrySnapshot,
  consumeLineRateLimit,
  consumeLinkNonce,
  deleteLineEntry,
  getLineContext,
  lineEntryStatus,
  lineMonthSummary,
  lineStreak,
  recordLineEntry,
  registerLinkToken,
  setLineBudget,
  undoLastLineEntry,
  unlinkLineUser,
} from "./lineRepository.js";
import { lineText, type LineDictionary } from "./lineText.js";
import { type LineEvent, lineEventKey, parseWebhookEvents } from "./lineTypes.js";

/**
 * The webhook's own dispatch loop: verify -> parse -> handle each event in
 * order and inline, one try/catch per event so a bad event in a redelivered
 * batch never sinks the others. See the plan's §1 for the full status-code
 * and gate contract this implements.
 *
 * Never logs: event objects, message text, replyToken, linkToken, nonce,
 * email, or a raw LINE user id. lineUserTag (a hash prefix) and HTTP statuses
 * are the only things that reach a log line.
 */

const MAX_BODY_BYTES = 256 * 1024;
export const LINE_UNDO_WINDOW_MINUTES = 30;

export type LineWebhookDeps = {
  client: PostgrestClient;
  line: LineClient;
  channelSecret: string;
  appOrigin: string;
  /**
   * Set (to a valid LIFF ID) only when the bot's links should open inside LINE
   * - i.e. LINE_LIFF_ID is set AND LINE_LIFF_LINKS is "1" (liffIdForLinks).
   * Unset: every link is the browser link, exactly as before.
   */
  liffId?: string;
  now?: () => number;
};

export async function handleLineWebhook(
  deps: LineWebhookDeps,
  input: { rawBody: Uint8Array; signature: string | null },
): Promise<{ status: number; body: unknown }> {
  if (input.rawBody.byteLength > MAX_BODY_BYTES) {
    return { status: 413, body: { error: "PAYLOAD_TOO_LARGE" } };
  }

  if (!verifyLineSignature(input.rawBody, input.signature, deps.channelSecret)) {
    return { status: 401, body: { error: "INVALID_SIGNATURE" } };
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(input.rawBody);
  } catch {
    return { status: 400, body: { error: "INVALID_BODY" } };
  }

  const events = parseWebhookEvents(text);
  if (events === null) {
    return { status: 400, body: { error: "INVALID_BODY" } };
  }

  for (const event of events) {
    try {
      await dispatch(deps, event);
    } catch (error) {
      const tag = event.source?.userId ? lineUserTag(event.source.userId) : "unknown";
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[line] ${event.type} failed (${tag}): ${redactForLog(message)}`);
      await safeReply(deps, event.replyToken, [textMessage(lineText(null).genericError)]);
    }
  }

  return { status: 200, body: { ok: true } };
}

async function dispatch(deps: LineWebhookDeps, event: LineEvent): Promise<void> {
  if (event.mode === "standby") return;

  switch (event.type) {
    case "follow":
      return onFollow(deps, event);
    case "join":
      return onJoin(deps, event);
    case "accountLink":
      return onAccountLink(deps, event);
    case "message":
      return onMessage(deps, event);
    case "postback":
      return onPostback(deps, event);
    default:
      return;
  }
}

/**
 * Sends a reply and never throws - a failed reply must not undo the work the
 * event already did (an entry saved is saved whatever LINE says next).
 *
 * Cards are the one place a reply can fail for a reason that is ours: LINE
 * answers a Flex message it dislikes with a 400 (the reason is in a body we
 * deliberately do not read). When that happens and at
 * least one card went out as a Flex message, the same reply is sent once more
 * as the plain text the cards replaced. A 400 on text alone, or any other
 * status (LINE down, a timeout, 401/429/5xx), is not a card problem and is
 * not retried: a second call would only add latency to a reply that is
 * failing anyway.
 *
 * The log lines carry the status and the closed set of card names, never the
 * reply token, the message text, a title or a user id.
 */
async function safeReply(deps: LineWebhookDeps, replyToken: string | undefined, items: readonly LineOutgoing[]): Promise<void> {
  if (!replyToken) return;

  try {
    await deps.line.reply(replyToken, wireMessages(items));
    return;
  } catch (error) {
    const sentCards = items.filter(isLineCard).filter((item) => item.message !== null);
    if (!(error instanceof LineApiError && error.status === 400 && sentCards.length > 0)) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[line] reply failed: ${redactForLog(message)}`);
      return;
    }

    const names = sentCards.map((item) => item.name).join(", ");
    console.error(`[line] flex reply rejected (status 400; cards: ${names}), resending as text`);

    try {
      await deps.line.reply(replyToken, fallbackMessages(items));
      console.warn(`[line] text fallback delivered (cards: ${names})`);
    } catch (fallbackError) {
      const message = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      console.error(`[line] text fallback failed: ${redactForLog(message)}`);
    }
  }
}

/** The links for a ledger, or null when the user has none yet. */
function linksFor(deps: LineWebhookDeps, ledgerId: string | null | undefined): LineLinks | null {
  return ledgerId ? linksForLedger(deps, ledgerId) : null;
}

/** lineLinks with this deployment's LIFF setting applied - the one place a webhook reply builds links. */
function linksForLedger(deps: LineWebhookDeps, ledgerId: string): LineLinks {
  return lineLinks({ appOrigin: deps.appOrigin, ledgerId, liff: deps.liffId ? { liffId: deps.liffId } : null });
}

/** The quick reply most replies to a linked user carry (本月 · 明細 · 分析 · 說明); see standardQuickReply. */
function standardFor(
  deps: LineWebhookDeps,
  dict: LineDictionary,
  context: LineContext,
  omit?: ReadonlyArray<"month" | "help">,
) {
  return standardQuickReply(dict, linksFor(deps, context.ledger?.id), omit);
}

/** Issues a fresh link token and registers its hash, or null on any failure (LINE API error, RPC failure). */
async function issueLink(deps: LineWebhookDeps, lineUserId: string): Promise<string | null> {
  try {
    const token = await deps.line.issueLinkToken(lineUserId);
    const result = await registerLinkToken(deps.client, sha256Hex(token), lineUserId);
    if (!result?.ok) return null;
    return linkPageUrl(deps.appOrigin, token);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[line] issueLinkToken failed (${lineUserTag(lineUserId)}): ${redactForLog(message)}`);
    return null;
  }
}

/**
 * Replies with the link card: `before` first (the help card, for an unlinked
 * user who asked for help), then a card with the button to the link page - its
 * `heading` and a `lead` sentence of context are the caller's. When no link
 * could be issued there is no button to draw, so it is `lead` (if any) and
 * `linkUnavailable` as plain text, as it always was.
 */
async function replyWithLink(
  deps: LineWebhookDeps,
  event: LineEvent,
  dict: LineDictionary,
  options: { heading?: string; lead?: string; before?: LineOutgoing[] } = {},
): Promise<void> {
  const lineUserId = event.source?.userId;
  if (!lineUserId) return;

  const before = options.before ?? [];
  const url = await issueLink(deps, lineUserId);
  if (!url) {
    const lead = options.lead ? [textMessage(options.lead)] : [];
    await safeReply(deps, event.replyToken, [...before, ...lead, textMessage(dict.linkUnavailable)]);
    return;
  }

  await safeReply(deps, event.replyToken, [
    ...before,
    linkReply(dict, { url, appOrigin: deps.appOrigin, heading: options.heading, lead: options.lead }),
  ]);
}

async function onJoin(deps: LineWebhookDeps, event: LineEvent): Promise<void> {
  const dict = lineText(null);
  await safeReply(deps, event.replyToken, [textMessage(dict.groupNotSupported)]);

  if (event.source?.type === "group" && event.source.groupId) {
    await deps.line.leave({ type: "group", groupId: event.source.groupId });
  } else if (event.source?.type === "room" && event.source.roomId) {
    await deps.line.leave({ type: "room", roomId: event.source.roomId });
  }
}

async function onFollow(deps: LineWebhookDeps, event: LineEvent): Promise<void> {
  const lineUserId = event.source?.userId;
  if (!lineUserId) return;

  const context = await getLineContext(deps.client, lineUserId);
  const dict = lineText(context?.locale ?? null);

  if (context && !context.disabled) {
    // Already linked - most likely a re-follow after unblocking, whose link
    // is kept (see the plan's §2 edge cases). No link button needed.
    await safeReply(deps, event.replyToken, [textMessage(dict.welcomeBack, standardFor(deps, dict, context))]);
    return;
  }

  const greeting = event.follow?.isUnblocked ? dict.welcomeBack : dict.welcome;
  await replyWithLink(deps, event, dict, { heading: dict.welcomeCardTitle, lead: greeting });
}

async function onAccountLink(deps: LineWebhookDeps, event: LineEvent): Promise<void> {
  // A "failed" link result carries no replyToken per LINE's reference, so
  // there is nothing to reply to and nothing worth recording - only "ok"
  // deliveries reach the nonce consumption below.
  if (event.link?.result !== "ok" || !event.link.nonce || !event.source?.userId) return;

  const result = await consumeLinkNonce(deps.client, sha256Hex(event.link.nonce), event.source.userId);
  const dict = lineText(result.ok ? result.locale : null);

  if (!result.ok) {
    await replyWithLink(deps, event, dict, { lead: dict.linkFailed });
    return;
  }

  await safeReply(deps, event.replyToken, [linkedReply(dict, { maskedEmail: maskEmail(result.email) })]);
}

async function onMessage(deps: LineWebhookDeps, event: LineEvent): Promise<void> {
  // Group/room messages are ignored silently - see the plan's §3 "Group
  // chats": the console setting plus the join-time leave are the real guard,
  // this is only a fallback for messages sent before either takes effect.
  if (event.source?.type !== "user" || !event.source.userId) return;

  if (event.message?.type !== "text" || typeof event.message.text !== "string") {
    await safeReply(deps, event.replyToken, [textMessage(lineText(null).nonText)]);
    return;
  }

  await onText(deps, event, event.source.userId, event.message.text);
}

async function onText(deps: LineWebhookDeps, event: LineEvent, lineUserId: string, text: string): Promise<void> {
  // Before anything else touches the database: a flooding user must cost one
  // counter call, not a context lookup per message. The reply is zh-Hant
  // because the language lives in the context we deliberately did not fetch.
  if (!(await consumeLineRateLimit(deps.client, lineUserId))) {
    await safeReply(deps, event.replyToken, [textMessage(lineText(null).rateLimited)]);
    return;
  }

  const context = await getLineContext(deps.client, lineUserId);
  const dict = lineText(context?.locale ?? null);

  if (!context) {
    const command = parseLineCommand(text, { currency: "TWD", categories: [] });
    // No quick reply on the help card here: the link card follows it, and a quick reply belongs on the last message.
    const before = command.type === "help" ? [helpReply(dict, LINE_UNDO_WINDOW_MINUTES)] : [];
    await replyWithLink(deps, event, dict, { before });
    return;
  }

  if (context.disabled) {
    await safeReply(deps, event.replyToken, [textMessage(dict.accountDisabled)]);
    return;
  }

  const currency = context.ledger?.currency ?? "TWD";
  const command = parseLineCommand(text, { currency, categories: context.categories });

  switch (command.type) {
    case "help":
      await safeReply(deps, event.replyToken, [
        helpReply(dict, LINE_UNDO_WINDOW_MINUTES, standardFor(deps, dict, context, ["help"])),
      ]);
      return;
    case "month":
      await handleMonth(deps, event, dict, lineUserId, context);
      return;
    case "budget_show":
      await handleBudgetShow(deps, event, dict, lineUserId);
      return;
    case "budget_set":
      await handleBudgetWrite(deps, event, dict, lineUserId, command.amountMinor);
      return;
    case "budget_clear":
      await handleBudgetWrite(deps, event, dict, lineUserId, null);
      return;
    case "undo":
      await handleUndo(deps, event, dict, lineUserId, context);
      return;
    case "unlink":
      await handleUnlink(deps, event, dict, lineUserId);
      return;
    case "link":
      // A context exists only for a LINE id that is already linked, so this
      // is somebody asking to link something they have already linked. Say so
      // (switching accounts goes through 解除綁定 first) instead of minting
      // another link token.
      await safeReply(deps, event.replyToken, [
        textMessage(fill(dict.alreadyLinked, { email: maskEmail(context.email) }), standardFor(deps, dict, context)),
      ]);
      return;
    case "record":
      await handleRecord(deps, event, dict, lineUserId, context, {
        kind: command.kind,
        title: command.title,
        amountMinor: command.amountMinor,
        category: command.category,
      });
      return;
    case "error":
      await safeReply(deps, event.replyToken, [
        textMessage(errorText(dict, command.reason, currency), standardFor(deps, dict, context)),
      ]);
      return;
  }
}

function errorText(dict: LineDictionary, reason: LineCommandErrorReason, currency: string): string {
  switch (reason) {
    case "not_understood":
      return dict.notUnderstood;
    case "invalid_amount":
      return dict.invalidAmount;
    case "no_decimals":
      return fill(dict.noDecimals, { currency });
    case "too_large":
      return dict.amountTooLarge;
    case "missing_title":
      return dict.missingTitle;
    case "multiple_amounts":
      return dict.multipleAmounts;
    case "title_too_long":
      return dict.titleTooLong;
    case "date_not_supported":
      return dict.dateNotSupported;
    case "budget_invalid":
      return dict.budgetInvalid;
    case "budget_too_large":
      return dict.budgetTooLarge;
    case "budget_ambiguous":
      return dict.budgetAmbiguous;
  }
}

async function isMaintenanceOn(deps: LineWebhookDeps): Promise<boolean> {
  const notice = await loadSiteNotice(deps.client, deps.now?.() ?? Date.now());
  return notice.maintenance.enabled;
}

/**
 * The streak numbers for the mood card, or null - and null is fine: the card
 * is sent without its streak section. Fail-soft in every way the call can go
 * wrong (the RPC throws, answers "not ok", or answers something that is not the
 * promised shape), because it runs AFTER the entry was written and must never
 * turn a saved entry into an error message. One log line, with the reason from
 * a closed list or the redacted error message - never text from the user.
 */
async function readStreak(deps: LineWebhookDeps, lineUserId: string, today: string): Promise<LineStreakStats | null> {
  try {
    const result = await lineStreak(deps.client, lineUserId, today);
    if (!result.ok) {
      console.warn(`[line] streak unavailable: ${result.reason}`);
      return null;
    }

    const stats = parseStreakStats(result.stats);
    if (stats === null) console.warn("[line] streak unavailable: unexpected stats");
    return stats;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[line] streak unavailable: ${redactForLog(message)}`);
    return null;
  }
}

async function handleRecord(
  deps: LineWebhookDeps,
  event: LineEvent,
  dict: LineDictionary,
  lineUserId: string,
  context: LineContext,
  command: { kind: "expense" | "income"; title: string; amountMinor: number; category: string },
): Promise<void> {
  if (await isMaintenanceOn(deps)) {
    await safeReply(deps, event.replyToken, [textMessage(dict.maintenance)]);
    return;
  }

  const eventKey = lineEventKey(event);
  if (!eventKey) {
    await safeReply(deps, event.replyToken, [textMessage(dict.genericError)]);
    return;
  }

  const dateKey = lineDateKey(event.timestamp);
  const monthStart = lineMonthStart(dateKey);

  const result = await recordLineEntry(deps.client, {
    lineUserId,
    eventId: eventKey,
    title: command.title,
    kind: command.kind,
    category: command.category,
    amountMinor: command.amountMinor,
    expenseDate: dateKey,
    monthStart,
  });

  if (!result.ok) {
    const text =
      result.reason === "no_ledger" ? dict.noLedger : result.reason === "account_disabled" ? dict.accountDisabled : dict.genericError;
    await safeReply(deps, event.replyToken, [textMessage(text)]);
    return;
  }

  // After the write, never before: the entry is saved whatever the streak says.
  const stats = await readStreak(deps, lineUserId, dateKey);
  const bucket = moodBucket({
    kind: command.kind,
    category: command.category,
    title: command.title,
    amountMinor: command.amountMinor,
    currency: result.currency,
    budgetMinor: result.budget_minor,
    taiwanMinuteOfDay: lineTaiwanMinuteOfDay(event.timestamp),
  });
  // The words are a function of the event key alone, so a redelivery says the same; the streak numbers are read again.
  const mood = lineMoodText(context.locale);
  const pick = pickMood(mood, { seed: eventKey, bucket, stats });

  const messages = recordedReply(dict, mood, {
    kind: command.kind,
    title: command.title,
    amountMinor: command.amountMinor,
    category: categoryDisplay(command.category, context.categories, context.locale),
    currency: result.currency,
    budgetMinor: result.budget_minor,
    month: result.month,
    dateKey,
    entryKey: eventKey,
    links: linksForLedger(deps, result.ledger_id),
    pick,
    stats,
  });
  await safeReply(deps, event.replyToken, messages);
}

/**
 * line_month_summary's per-category totals as the month card wants them:
 * labelled the way the plain replies always labelled a category. Undefined -
 * not an empty list - when the database sent no breakdown at all (it predates
 * the column), because the card must not mistake "unknown" for "no spending".
 * An entry that is not a category total is skipped rather than trusted.
 */
function monthCategoriesFor(raw: unknown, context: LineContext): MonthCategory[] | undefined {
  if (!Array.isArray(raw)) return undefined;

  return raw.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { category, expense_minor: amountMinor } = entry as { category?: unknown; expense_minor?: unknown };
    if (typeof category !== "string" || typeof amountMinor !== "number") return [];
    return [{ category: categoryDisplay(category, context.categories, context.locale), amountMinor }];
  });
}

async function handleMonth(
  deps: LineWebhookDeps,
  event: LineEvent,
  dict: LineDictionary,
  lineUserId: string,
  context: LineContext,
): Promise<void> {
  const now = deps.now?.() ?? Date.now();
  const monthStart = lineMonthStart(lineDateKey(now));

  const result = await lineMonthSummary(deps.client, lineUserId, monthStart);
  if (!result.ok) {
    const text =
      result.reason === "no_ledger" ? dict.noLedger : result.reason === "account_disabled" ? dict.accountDisabled : dict.genericError;
    await safeReply(deps, event.replyToken, [textMessage(text)]);
    return;
  }

  const [year, month] = monthStart.split("-").map(Number);
  const message = monthReply(dict, {
    year,
    month,
    currency: result.currency,
    budgetMinor: result.budget_minor,
    month_totals: result.month,
    categories: monthCategoriesFor(result.categories, context),
    links: linksForLedger(deps, result.ledger_id),
  });
  await safeReply(deps, event.replyToken, [message]);
}

/** Viewing the budget is a read like 「本月」, so it is deliberately not behind the maintenance gate. */
async function handleBudgetShow(deps: LineWebhookDeps, event: LineEvent, dict: LineDictionary, lineUserId: string): Promise<void> {
  const now = deps.now?.() ?? Date.now();
  const monthStart = lineMonthStart(lineDateKey(now));

  const result = await lineMonthSummary(deps.client, lineUserId, monthStart);
  if (!result.ok) {
    const text =
      result.reason === "no_ledger" ? dict.noLedger : result.reason === "account_disabled" ? dict.accountDisabled : dict.genericError;
    await safeReply(deps, event.replyToken, [textMessage(text)]);
    return;
  }

  const message = budgetReply(dict, {
    mode: "show",
    currency: result.currency,
    budgetMinor: result.budget_minor,
    spentMinor: result.month.expense_minor,
    links: linksForLedger(deps, result.ledger_id),
  });
  await safeReply(deps, event.replyToken, [message]);
}

/**
 * Set / change (`budgetMinor` = amount) or clear (`null`) the monthly budget.
 * Behind the maintenance gate like every other write.
 *
 * No lineEventKey / event-id table on purpose: setting a value is idempotent
 * by value (line_set_budget only writes when the value differs), and the
 * clear reply is the same text every time, so a redelivered event gets the
 * same answer without bookkeeping.
 */
async function handleBudgetWrite(
  deps: LineWebhookDeps,
  event: LineEvent,
  dict: LineDictionary,
  lineUserId: string,
  budgetMinor: number | null,
): Promise<void> {
  if (await isMaintenanceOn(deps)) {
    await safeReply(deps, event.replyToken, [textMessage(dict.maintenance)]);
    return;
  }

  const now = deps.now?.() ?? Date.now();
  const monthStart = lineMonthStart(lineDateKey(now));

  const result = await setLineBudget(deps.client, lineUserId, budgetMinor, monthStart);
  if (!result.ok) {
    const text =
      result.reason === "no_ledger" ? dict.noLedger : result.reason === "account_disabled" ? dict.accountDisabled : dict.genericError;
    await safeReply(deps, event.replyToken, [textMessage(text)]);
    return;
  }

  const links = linksForLedger(deps, result.ledger_id);
  const message =
    budgetMinor === null
      ? budgetClearedReply(dict, { links })
      : budgetReply(dict, {
          mode: "set",
          currency: result.currency,
          budgetMinor: result.budget_minor,
          spentMinor: result.month.expense_minor,
          links,
        });
  await safeReply(deps, event.replyToken, [message]);
}

async function handleUndo(
  deps: LineWebhookDeps,
  event: LineEvent,
  dict: LineDictionary,
  lineUserId: string,
  context: LineContext,
): Promise<void> {
  if (await isMaintenanceOn(deps)) {
    await safeReply(deps, event.replyToken, [textMessage(dict.maintenance)]);
    return;
  }

  const eventKey = lineEventKey(event);
  if (!eventKey) {
    await safeReply(deps, event.replyToken, [textMessage(dict.genericError)]);
    return;
  }

  const result = await undoLastLineEntry(deps.client, lineUserId, eventKey, LINE_UNDO_WINDOW_MINUTES);
  if (!result.ok) {
    const text =
      result.reason === "nothing_to_undo"
        ? fill(dict.undoNothing, { minutes: LINE_UNDO_WINDOW_MINUTES })
        : result.reason === "already_gone"
          ? dict.undoAlreadyGone
          : dict.genericError;
    // genericError is a failure, not an answer: no shortcuts under it.
    const quickReply = result.reason === "nothing_to_undo" || result.reason === "already_gone" ? standardFor(deps, dict, context) : undefined;
    await safeReply(deps, event.replyToken, [textMessage(text, quickReply)]);
    return;
  }

  const expense = result.expense as { title?: string; amount_minor?: number; currency?: string };
  const text = fill(dict.undone, {
    title: expense.title ?? "",
    amount: formatAmount(expense.amount_minor ?? 0, expense.currency ?? "TWD"),
  });
  await safeReply(deps, event.replyToken, [textMessage(text, standardFor(deps, dict, context))]);
}

/**
 * A tapped postback: the record card's 刪除 (which only asks), and the 確定刪除
 * / 取消 quick replies that answer the question. Everything about who is
 * asking is decided exactly as for a message - a user chat, under the same
 * per-user rate limit, linked and not disabled - and what the data asks for is
 * decided by linePostback.ts's closed grammar. The data carries an entry key
 * and nothing else: which ledger it is looked up in is always the sender's own.
 */
async function onPostback(deps: LineWebhookDeps, event: LineEvent): Promise<void> {
  if (event.source?.type !== "user" || !event.source.userId) return;
  const lineUserId = event.source.userId;

  if (!(await consumeLineRateLimit(deps.client, lineUserId))) {
    await safeReply(deps, event.replyToken, [textMessage(lineText(null).rateLimited)]);
    return;
  }

  const context = await getLineContext(deps.client, lineUserId);
  const dict = lineText(context?.locale ?? null);

  if (!context) {
    await replyWithLink(deps, event, dict);
    return;
  }

  if (context.disabled) {
    await safeReply(deps, event.replyToken, [textMessage(dict.accountDisabled)]);
    return;
  }

  const links = linksFor(deps, context.ledger?.id);
  const postback = parseLinePostback(event.postback?.data);
  if (!postback) {
    // Nothing of the data in the log: it is not ours to trust, and a key in it is an identifier.
    console.warn("[line] postback ignored (unknown data)");
    await safeReply(deps, event.replyToken, [deleteResultReply(dict, links, { kind: "expired" })]);
    return;
  }

  switch (postback.action) {
    case "delete_ask":
      await handleDeleteAsk(deps, event, dict, lineUserId, links, postback.entryKey);
      return;
    case "delete_confirm":
      await handleDeleteConfirm(deps, event, dict, lineUserId, links, postback.entryKey);
      return;
    case "delete_cancel":
      // No gate and no database: taking back a question changes nothing, so it works in maintenance too.
      await safeReply(deps, event.replyToken, [deleteResultReply(dict, links, { kind: "cancelled" })]);
      return;
  }
}

/** The title and amount of an entry as the confirm and result texts show them; whatever the database did not say is blank / zero. */
function entryFacts(expense: Partial<LineEntrySnapshot>): { title: string; amountMinor: number; currency: string } {
  return {
    title: typeof expense.title === "string" ? expense.title : "",
    amountMinor: typeof expense.amount_minor === "number" ? expense.amount_minor : 0,
    currency: typeof expense.currency === "string" ? expense.currency : "TWD",
  };
}

/** A delete RPC answered "this is not your account any more": say what the reply to any other message would say. */
async function replyToUnusableAccount(
  deps: LineWebhookDeps,
  event: LineEvent,
  dict: LineDictionary,
  reason: "not_linked" | "account_disabled",
): Promise<void> {
  if (reason === "account_disabled") {
    await safeReply(deps, event.replyToken, [textMessage(dict.accountDisabled)]);
    return;
  }
  await replyWithLink(deps, event, dict);
}

/**
 * Step one of deleting from a card: look at what the key names right now and
 * ASK. Nothing is written. Behind the maintenance gate like every write step,
 * so a person in maintenance is not led to a confirm they cannot use.
 */
async function handleDeleteAsk(
  deps: LineWebhookDeps,
  event: LineEvent,
  dict: LineDictionary,
  lineUserId: string,
  links: LineLinks | null,
  entryKey: string,
): Promise<void> {
  if (await isMaintenanceOn(deps)) {
    await safeReply(deps, event.replyToken, [textMessage(dict.maintenance)]);
    return;
  }

  const status = await lineEntryStatus(deps.client, lineUserId, entryKey);
  if (!status.ok) {
    await replyToUnusableAccount(deps, event, dict, status.reason);
    return;
  }

  if (status.status !== "live") {
    await safeReply(deps, event.replyToken, [
      deleteResultReply(dict, links, { kind: status.status === "gone" ? "already_gone" : "not_found" }),
    ]);
    return;
  }

  await safeReply(deps, event.replyToken, [
    deleteConfirmReply(dict, { ...entryFacts(status.expense), edited: status.edited === true, entryKey }),
  ]);
}

/**
 * Step two: 確定刪除. The write is keyed on THIS event's key, so LINE delivering
 * the same tap twice gets the same answer (line_delete_entry's replay branch)
 * instead of "already deleted". Gated by maintenance; if the event has no
 * usable key nothing is written, as for a record.
 */
async function handleDeleteConfirm(
  deps: LineWebhookDeps,
  event: LineEvent,
  dict: LineDictionary,
  lineUserId: string,
  links: LineLinks | null,
  entryKey: string,
): Promise<void> {
  if (await isMaintenanceOn(deps)) {
    await safeReply(deps, event.replyToken, [textMessage(dict.maintenance)]);
    return;
  }

  const eventKey = lineEventKey(event);
  if (!eventKey) {
    await safeReply(deps, event.replyToken, [textMessage(dict.genericError)]);
    return;
  }

  const result = await deleteLineEntry(deps.client, { lineUserId, entryKey, eventId: eventKey });
  if (!result.ok) {
    if (result.reason === "not_linked" || result.reason === "account_disabled") {
      await replyToUnusableAccount(deps, event, dict, result.reason);
      return;
    }
    await safeReply(deps, event.replyToken, [deleteResultReply(dict, links, { kind: result.reason })]);
    return;
  }

  await safeReply(deps, event.replyToken, [deleteResultReply(dict, links, { kind: "deleted", ...entryFacts(result.expense) })]);
}

/**
 * Deliberately NOT behind the maintenance gate: disconnecting is something a
 * person must always be able to do (LINE requires it), and it only removes
 * this feature's own rows - it cannot change the ledger under a migration.
 * DELETE /api/v1/me/line is exempt for the same reason (see maintenance.ts).
 */
async function handleUnlink(deps: LineWebhookDeps, event: LineEvent, dict: LineDictionary, lineUserId: string): Promise<void> {
  const result = await unlinkLineUser(deps.client, lineUserId);
  await safeReply(deps, event.replyToken, [textMessage(result.unlinked ? dict.unlinked : dict.notLinked)]);
}
