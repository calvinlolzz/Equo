import { formatAmount } from "../../app/formatAmount.js";
import { EN } from "../../app/i18n/en.js";
import type { PostgrestClient } from "../db/postgrestClient.js";
import { loadSiteNotice } from "../http/maintenance.js";
import { fill } from "../push/pushText.js";
import type { LineClient, LineMessage } from "./lineClient.js";
import { lineUserTag, redactForLog, sha256Hex, verifyLineSignature } from "./lineCrypto.js";
import { type LineCommandErrorReason, parseLineCommand } from "./lineCommand.js";
import { lineDateKey, lineMonthStart } from "./lineDates.js";
import { helpReply, linkButtonsMessage, linkPageUrl, maskEmail, monthReply, recordedReply, textMessage } from "./lineMessages.js";
import {
  type LineContext,
  consumeLineRateLimit,
  consumeLinkNonce,
  getLineContext,
  lineMonthSummary,
  recordLineEntry,
  registerLinkToken,
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
    default:
      return;
  }
}

async function safeReply(deps: LineWebhookDeps, replyToken: string | undefined, messages: LineMessage[]): Promise<void> {
  if (!replyToken) return;
  try {
    await deps.line.reply(replyToken, messages);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[line] reply failed: ${redactForLog(message)}`);
  }
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

/** Sends `leading` plus a link-buttons template (or, on failure to issue one, `linkUnavailable`). */
async function replyWithLink(
  deps: LineWebhookDeps,
  event: LineEvent,
  dict: LineDictionary,
  leading: LineMessage[],
): Promise<void> {
  const lineUserId = event.source?.userId;
  if (!lineUserId) return;

  const url = await issueLink(deps, lineUserId);
  if (!url) {
    await safeReply(deps, event.replyToken, [...leading, textMessage(dict.linkUnavailable)]);
    return;
  }

  await safeReply(deps, event.replyToken, [...leading, linkButtonsMessage(dict, url)]);
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
    await safeReply(deps, event.replyToken, [textMessage(dict.welcomeBack)]);
    return;
  }

  const greeting = event.follow?.isUnblocked ? dict.welcomeBack : dict.welcome;
  await replyWithLink(deps, event, dict, [textMessage(greeting)]);
}

async function onAccountLink(deps: LineWebhookDeps, event: LineEvent): Promise<void> {
  // A "failed" link result carries no replyToken per LINE's reference, so
  // there is nothing to reply to and nothing worth recording - only "ok"
  // deliveries reach the nonce consumption below.
  if (event.link?.result !== "ok" || !event.link.nonce || !event.source?.userId) return;

  const result = await consumeLinkNonce(deps.client, sha256Hex(event.link.nonce), event.source.userId);
  const dict = lineText(result.ok ? result.locale : null);

  if (!result.ok) {
    await replyWithLink(deps, event, dict, [textMessage(dict.linkFailed)]);
    return;
  }

  await safeReply(deps, event.replyToken, [textMessage(fill(dict.linked, { email: maskEmail(result.email) }))]);
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
  const allowed = await consumeLineRateLimit(deps.client, lineUserId);
  const context = await getLineContext(deps.client, lineUserId);
  const dict = lineText(context?.locale ?? null);

  if (!allowed) {
    await safeReply(deps, event.replyToken, [textMessage(dict.rateLimited)]);
    return;
  }

  if (!context) {
    const command = parseLineCommand(text, { currency: "TWD", categories: [] });
    const leading = command.type === "help" ? [helpReply(dict, LINE_UNDO_WINDOW_MINUTES)] : [];
    await replyWithLink(deps, event, dict, leading);
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
      await safeReply(deps, event.replyToken, [helpReply(dict, LINE_UNDO_WINDOW_MINUTES)]);
      return;
    case "month":
      await handleMonth(deps, event, dict, lineUserId);
      return;
    case "undo":
      await handleUndo(deps, event, dict, lineUserId);
      return;
    case "unlink":
      await handleUnlink(deps, event, dict, lineUserId);
      return;
    case "link":
      // "或「綁定」" is one of the flow's own triggers (§2 step 1) - LINE's
      // official flow re-verifies the user regardless of current state, so
      // this always re-issues a link rather than special-casing "already
      // linked" here (that case is handled by line_attach_link_request /
      // line_consume_link_nonce on the DB side - see the plan's §2 edge
      // cases "Already linked, same pair" and "Re-link").
      await replyWithLink(deps, event, dict, []);
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
      await safeReply(deps, event.replyToken, [textMessage(errorText(dict, command.reason, currency))]);
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
  }
}

/** The category label in replies: the live catalog's label for zh, or EN's own label (falling back to the catalog one) for en. */
function categoryLabelFor(key: string, context: LineContext, locale: string): string {
  const catalogLabel = context.categories.find((c) => c.key === key)?.label ?? key;
  if (locale === "en") {
    return (EN.categories as Record<string, string>)[key] ?? catalogLabel;
  }
  return catalogLabel;
}

async function isMaintenanceOn(deps: LineWebhookDeps): Promise<boolean> {
  const notice = await loadSiteNotice(deps.client, deps.now?.() ?? Date.now());
  return notice.maintenance.enabled;
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

  const message = recordedReply(dict, {
    kind: command.kind,
    title: command.title,
    amountMinor: command.amountMinor,
    categoryLabel: categoryLabelFor(command.category, context, context.locale),
    currency: result.currency,
    budgetMinor: result.budget_minor,
    month: result.month,
    ledgerId: result.ledger_id,
    appOrigin: deps.appOrigin,
  });
  await safeReply(deps, event.replyToken, [message]);
}

async function handleMonth(deps: LineWebhookDeps, event: LineEvent, dict: LineDictionary, lineUserId: string): Promise<void> {
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
    ledgerId: result.ledger_id,
    appOrigin: deps.appOrigin,
  });
  await safeReply(deps, event.replyToken, [message]);
}

async function handleUndo(deps: LineWebhookDeps, event: LineEvent, dict: LineDictionary, lineUserId: string): Promise<void> {
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
    await safeReply(deps, event.replyToken, [textMessage(text)]);
    return;
  }

  const expense = result.expense as { title?: string; amount_minor?: number; currency?: string };
  const text = fill(dict.undone, {
    title: expense.title ?? "",
    amount: formatAmount(expense.amount_minor ?? 0, expense.currency ?? "TWD"),
  });
  await safeReply(deps, event.replyToken, [textMessage(text)]);
}

async function handleUnlink(deps: LineWebhookDeps, event: LineEvent, dict: LineDictionary, lineUserId: string): Promise<void> {
  if (await isMaintenanceOn(deps)) {
    await safeReply(deps, event.replyToken, [textMessage(dict.maintenance)]);
    return;
  }

  const result = await unlinkLineUser(deps.client, lineUserId);
  await safeReply(deps, event.replyToken, [textMessage(result.unlinked ? dict.unlinked : dict.notLinked)]);
}
