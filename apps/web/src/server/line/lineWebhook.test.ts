import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_CATALOG } from "../../app/catalog.js";
import { createFakePostgrest, type FakePostgrest } from "../db/fakePostgrest.js";
import { resetSiteNoticeCache } from "../http/maintenance.js";
import type { LineClient, LineMessage } from "./lineClient.js";
import { sha256Hex } from "./lineCrypto.js";
import { LINE_TEXT_ZH_HANT as ZH_HANT } from "./lineText.js";
import { handleLineWebhook, type LineWebhookDeps } from "./lineWebhook.js";

const SECRET = "test_channel_secret";
const APP_ORIGIN = "https://equo-mu.vercel.app";
const LINE_USER_ID = "U0123456789abcdef0123456789abcdef";

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(Buffer.from(body, "utf8")).digest("base64");
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function webhookBody(events: unknown[]): string {
  return JSON.stringify({ destination: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", events });
}

// Byte-identical to lineCrypto.test.ts's BODY_A/BODY_B - the same fixtures
// this bot's signature check was verified against.
const BODY_A = '{"destination":"Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","events":[]}';
const BODY_B =
  '{"destination":"Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","events":[{"type":"message","message":{"type":"text","id":"1","text":"早餐 60"},"webhookEventId":"01J0000000000000000000000A","deliveryContext":{"isRedelivery":false},"timestamp":1790000000000,"source":{"type":"user","userId":"U0123456789abcdef0123456789abcdef"},"replyToken":"rt1","mode":"active"}]}';

function messageEvent(
  opts: {
    text?: string;
    webhookEventId?: string;
    userId?: string;
    timestamp?: number;
    replyToken?: string;
    sourceType?: "user" | "group" | "room";
    mode?: string;
    isRedelivery?: boolean;
    nonText?: boolean;
  } = {},
) {
  return {
    type: "message",
    mode: opts.mode ?? "active",
    timestamp: opts.timestamp ?? 1790000000000,
    webhookEventId: opts.webhookEventId ?? "01J0000000000000000000000X",
    deliveryContext: { isRedelivery: opts.isRedelivery ?? false },
    replyToken: opts.replyToken ?? "rt1",
    source:
      opts.sourceType === "group"
        ? { type: "group", groupId: "G1" }
        : opts.sourceType === "room"
          ? { type: "room", roomId: "R1" }
          : { type: "user", userId: opts.userId ?? LINE_USER_ID },
    message: opts.nonText ? { type: "image", id: "2" } : { type: "text", id: "1", text: opts.text ?? "早餐 60" },
  };
}

function joinEvent(opts: { replyToken?: string; webhookEventId?: string } = {}) {
  return {
    type: "join",
    mode: "active",
    timestamp: 1790000000000,
    webhookEventId: opts.webhookEventId ?? "01J0000000000000000000000J",
    replyToken: opts.replyToken ?? "rt5",
    source: { type: "group", groupId: "G1" },
  };
}

function accountLinkEvent(
  opts: { result?: "ok" | "failed"; nonce?: string; userId?: string; replyToken?: string; webhookEventId?: string } = {},
) {
  const result = opts.result ?? "ok";
  const base: Record<string, unknown> = {
    type: "accountLink",
    mode: "active",
    timestamp: 1790000000000,
    webhookEventId: opts.webhookEventId ?? "01J0000000000000000000000C",
    source: { type: "user", userId: opts.userId ?? LINE_USER_ID },
    link: { result },
  };
  if (result === "ok") {
    base.replyToken = opts.replyToken ?? "rt3";
    (base.link as Record<string, unknown>).nonce = opts.nonce ?? "raw-nonce-value";
  }
  return base;
}

const LINKED_CONTEXT = {
  user_id: "user_1",
  email: "alice@example.com",
  locale: "zh-Hant",
  disabled: false,
  ledger: {
    id: "ledger_1",
    name: "我的帳本",
    currency: "TWD",
    owner_member_id: "member_1",
    cover_image_url: null,
    monthly_budget_minor: 0,
    kind: "personal",
  },
  categories: DEFAULT_CATALOG.categories,
};

type RpcHandler = (args: Record<string, unknown>) => unknown;

function createLineFakeClient(overrides: Partial<Record<string, RpcHandler>> = {}) {
  const state = { recordedEntries: new Map<string, unknown>() };

  const defaults: Record<string, RpcHandler> = {
    site_notice_settings: () => ({
      banner: { message: "", level: "info", ends_at: null, active: false },
      maintenance: { enabled: false, message: "" },
    }),
    consume_rate_limit: () => ({ allowed: true }),
    line_register_link_token: () => ({ ok: true }),
    line_unlink: () => ({ ok: true, unlinked: true }),
    line_month_summary: () => ({
      ok: true,
      ledger_id: "ledger_1",
      currency: "TWD",
      budget_minor: 0,
      month: { expense_minor: 0, income_minor: 0 },
    }),
    line_set_budget: (args) => ({
      ok: true,
      ledger_id: "ledger_1",
      currency: "TWD",
      budget_minor: args.p_budget_minor,
      month: { expense_minor: 600000, income_minor: 0 },
    }),
    line_context: () => null,
    line_consume_link_nonce: () => ({ ok: false, reason: "unknown" }),
    line_record_entry: (args) => {
      const eventId = args.p_event_id as string;
      const replay = state.recordedEntries.has(eventId);
      const expense =
        state.recordedEntries.get(eventId) ??
        {
          id: `exp_${eventId}`,
          title: args.p_title,
          kind: args.p_kind,
          category: args.p_category,
          amount_minor: args.p_amount_minor,
          currency: "TWD",
          expense_date: args.p_expense_date,
        };
      state.recordedEntries.set(eventId, expense);
      const amountMinor = (expense as { amount_minor: number }).amount_minor;
      return {
        ok: true,
        replay,
        expense,
        ledger_id: "ledger_1",
        currency: "TWD",
        budget_minor: 0,
        month: { expense_minor: amountMinor, income_minor: 0 },
      };
    },
    line_undo_last: () => ({
      ok: true,
      replay: false,
      expense: { id: "exp_undo", title: "早餐", amount_minor: 6000, currency: "TWD" },
    }),
  };

  const merged = { ...defaults, ...overrides };

  const client: FakePostgrest = createFakePostgrest({
    rpc: (fn, args) => {
      const handler = merged[fn];
      if (!handler) throw new Error(`unexpected rpc ${fn}`);
      return handler(args);
    },
  });

  return { client, state };
}

function fakeLineClient() {
  const calls: {
    reply: Array<{ replyToken: string; messages: LineMessage[] }>;
    issueLinkToken: string[];
    leave: Array<{ type: "group" | "room"; groupId?: string; roomId?: string }>;
  } = { reply: [], issueLinkToken: [], leave: [] };
  let issuedToken = "faketoken123";

  const client: LineClient = {
    async reply(replyToken, messages) {
      calls.reply.push({ replyToken, messages });
    },
    async issueLinkToken(userId) {
      calls.issueLinkToken.push(userId);
      return issuedToken;
    },
    async leave(target) {
      calls.leave.push(target as { type: "group" | "room"; groupId?: string; roomId?: string });
    },
  };

  return { client, calls, setIssuedToken: (token: string) => (issuedToken = token) };
}

function deps(client: FakePostgrest, line: LineClient): LineWebhookDeps {
  return { client, line, channelSecret: SECRET, appOrigin: APP_ORIGIN };
}

beforeEach(() => {
  resetSiteNoticeCache();
});

describe("handleLineWebhook - signature and framing", () => {
  test("a bad signature returns 401 without touching the database or LINE", async () => {
    const { client } = createLineFakeClient();
    const line = fakeLineClient();

    const result = await handleLineWebhook(deps(client, line.client), {
      rawBody: bytes(BODY_B),
      signature: "not-the-real-signature",
    });

    expect(result.status).toBe(401);
    expect(client.calls).toHaveLength(0);
    expect(line.calls.reply).toHaveLength(0);
  });

  test("LINE's verification payload (empty events) returns 200", async () => {
    const { client } = createLineFakeClient();
    const line = fakeLineClient();

    const result = await handleLineWebhook(deps(client, line.client), { rawBody: bytes(BODY_A), signature: sign(BODY_A) });

    expect(result.status).toBe(200);
  });

  test("a body over 256 KB is rejected with 413 before verifying", async () => {
    const { client } = createLineFakeClient();
    const line = fakeLineClient();
    const huge = webhookBody([]) + " ".repeat(300 * 1024);

    const result = await handleLineWebhook(deps(client, line.client), { rawBody: bytes(huge), signature: sign(huge) });

    expect(result.status).toBe(413);
    expect(client.calls).toHaveLength(0);
  });

  test("standby mode events are ignored entirely", async () => {
    const { client } = createLineFakeClient();
    const line = fakeLineClient();
    const body = webhookBody([messageEvent({ mode: "standby" })]);

    const result = await handleLineWebhook(deps(client, line.client), { rawBody: bytes(body), signature: sign(body) });

    expect(result.status).toBe(200);
    expect(client.calls).toHaveLength(0);
    expect(line.calls.reply).toHaveLength(0);
  });
});

describe("handleLineWebhook - recording", () => {
  test("a linked user's expense calls line_record_entry with exact args and replies with quick replies", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient();

    const result = await handleLineWebhook(deps(client, line.client), { rawBody: bytes(BODY_B), signature: sign(BODY_B) });

    expect(result.status).toBe(200);
    const call = client.rpcCall("line_record_entry");
    expect(call?.args).toEqual({
      p_line_user_id: "U0123456789abcdef0123456789abcdef",
      p_event_id: "01J0000000000000000000000A",
      p_title: "早餐",
      p_kind: "expense",
      p_category: "food",
      p_amount_minor: 6000,
      p_expense_date: "2026-09-21",
      p_month_start: "2026-09-01",
    });

    expect(line.calls.reply).toHaveLength(1);
    expect(line.calls.reply[0].replyToken).toBe("rt1");
    const message = line.calls.reply[0].messages[0] as { quickReply?: { items: unknown[] } };
    expect(message.quickReply?.items.length).toBeGreaterThan(0);
  });

  // [MV]: redelivery must reuse the SAME event id both times. If the
  // implementation ever derives the idempotency key from something that
  // changes per delivery (e.g. Date.now()) instead of the webhook's own
  // event id, this goes red.
  test("redelivery is idempotent: both deliveries carry the same event id and only one entry is stored", async () => {
    const { client, state } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient();
    const d = deps(client, line.client);

    await handleLineWebhook(d, { rawBody: bytes(BODY_B), signature: sign(BODY_B) });
    const redelivered = BODY_B.replace('"isRedelivery":false', '"isRedelivery":true');
    await handleLineWebhook(d, { rawBody: bytes(redelivered), signature: sign(redelivered) });

    const eventIds = client.calls
      .filter((c): c is Extract<typeof c, { op: "rpc" }> => c.op === "rpc" && c.fn === "line_record_entry")
      .map((c) => c.args.p_event_id);

    expect(eventIds).toEqual(["01J0000000000000000000000A", "01J0000000000000000000000A"]);
    expect(state.recordedEntries.size).toBe(1);
  });

  test("undo delivered twice (replay) sends the same event id both times", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient();
    const d = deps(client, line.client);
    const body = webhookBody([messageEvent({ text: "復原", webhookEventId: "01J0000000000000000000000U", replyToken: "rt2" })]);

    await handleLineWebhook(d, { rawBody: bytes(body), signature: sign(body) });
    await handleLineWebhook(d, { rawBody: bytes(body), signature: sign(body) });

    const eventIds = client.calls
      .filter((c): c is Extract<typeof c, { op: "rpc" }> => c.op === "rpc" && c.fn === "line_undo_last")
      .map((c) => c.args.p_event_id);

    expect(eventIds).toEqual(["01J0000000000000000000000U", "01J0000000000000000000000U"]);
  });
});

describe("handleLineWebhook - group chats", () => {
  test("a group text message is ignored silently", async () => {
    const { client } = createLineFakeClient();
    const line = fakeLineClient();
    const body = webhookBody([messageEvent({ sourceType: "group" })]);

    const result = await handleLineWebhook(deps(client, line.client), { rawBody: bytes(body), signature: sign(body) });

    expect(result.status).toBe(200);
    expect(client.calls).toHaveLength(0);
    expect(line.calls.reply).toHaveLength(0);
  });

  test("join replies groupNotSupported, then leaves the group", async () => {
    const { client } = createLineFakeClient();
    const line = fakeLineClient();
    const body = webhookBody([joinEvent()]);

    await handleLineWebhook(deps(client, line.client), { rawBody: bytes(body), signature: sign(body) });

    expect(line.calls.reply).toHaveLength(1);
    expect((line.calls.reply[0].messages[0] as { text: string }).text).toBe(ZH_HANT.groupNotSupported);
    expect(line.calls.leave).toEqual([{ type: "group", groupId: "G1" }]);
  });
});

describe("handleLineWebhook - linking", () => {
  // [MV]: the raw link token must never reach a database call - only its
  // sha256 hash. If a future edit passes the raw token to
  // line_register_link_token, this goes red.
  test("an unlinked user's message issues a link token and shows the link button; the raw token never touches the DB", async () => {
    const { client } = createLineFakeClient();
    const line = fakeLineClient();
    line.setIssuedToken("linktoken123");

    const body = webhookBody([messageEvent({ text: "早餐 60" })]);
    const result = await handleLineWebhook(deps(client, line.client), { rawBody: bytes(body), signature: sign(body) });

    expect(result.status).toBe(200);
    expect(line.calls.issueLinkToken).toEqual([LINE_USER_ID]);

    const registerCall = client.rpcCall("line_register_link_token");
    expect(registerCall?.args.p_link_token_hash).toBe(sha256Hex("linktoken123"));

    for (const call of client.calls) {
      expect(JSON.stringify(call)).not.toContain("linktoken123");
    }

    const lastReply = line.calls.reply.at(-1)!;
    const templateMessage = lastReply.messages.find((m) => (m as { type: string }).type === "template") as {
      template: { actions: Array<{ uri: string }> };
    };
    expect(templateMessage.template.actions[0].uri).toContain("openExternalBrowser=1");
  });

  // [MV]: same guard as above, for the nonce this time.
  test("accountLink ok consumes the nonce's hash, never the raw nonce, and replies", async () => {
    const { client } = createLineFakeClient({
      line_consume_link_nonce: () => ({ ok: true, replay: false, email: "alice@example.com", locale: "zh-Hant" }),
    });
    const line = fakeLineClient();
    const body = webhookBody([accountLinkEvent({ nonce: "raw-nonce-value" })]);

    await handleLineWebhook(deps(client, line.client), { rawBody: bytes(body), signature: sign(body) });

    const call = client.rpcCall("line_consume_link_nonce");
    expect(call?.args.p_nonce_hash).toBe(sha256Hex("raw-nonce-value"));

    for (const c of client.calls) {
      expect(JSON.stringify(c)).not.toContain("raw-nonce-value");
    }
    expect(line.calls.reply).toHaveLength(1);
  });

  test("accountLink failed carries no replyToken and makes no calls at all", async () => {
    const { client } = createLineFakeClient();
    const line = fakeLineClient();
    const body = webhookBody([accountLinkEvent({ result: "failed" })]);

    const result = await handleLineWebhook(deps(client, line.client), { rawBody: bytes(body), signature: sign(body) });

    expect(result.status).toBe(200);
    expect(client.calls).toHaveLength(0);
    expect(line.calls.reply).toHaveLength(0);
  });
});

describe("handleLineWebhook - maintenance", () => {
  test("maintenance blocks recording but still consumes an accountLink nonce", async () => {
    const { client } = createLineFakeClient({
      site_notice_settings: () => ({
        banner: { message: "", level: "info", ends_at: null, active: false },
        maintenance: { enabled: true, message: "維護中" },
      }),
      line_context: () => LINKED_CONTEXT,
      line_consume_link_nonce: () => ({ ok: true, replay: false, email: "alice@example.com", locale: "zh-Hant" }),
    });
    const line = fakeLineClient();
    const d = deps(client, line.client);

    const recordResult = await handleLineWebhook(d, { rawBody: bytes(BODY_B), signature: sign(BODY_B) });
    expect(recordResult.status).toBe(200);
    expect(client.rpcCall("line_record_entry")).toBeUndefined();
    expect((line.calls.reply.at(-1)!.messages[0] as { text: string }).text).toBe(ZH_HANT.maintenance);

    const accountLinkBody = webhookBody([accountLinkEvent()]);
    await handleLineWebhook(d, { rawBody: bytes(accountLinkBody), signature: sign(accountLinkBody) });
    expect(client.rpcCall("line_consume_link_nonce")).toBeDefined();
  });
});

describe("handleLineWebhook - rate limiting", () => {
  test("rate limited: no record is made", async () => {
    const { client } = createLineFakeClient({
      line_context: () => LINKED_CONTEXT,
      consume_rate_limit: () => ({ allowed: false, retry_after: 5 }),
    });
    const line = fakeLineClient();

    await handleLineWebhook(deps(client, line.client), { rawBody: bytes(BODY_B), signature: sign(BODY_B) });

    expect(client.rpcCall("line_record_entry")).toBeUndefined();
    expect((line.calls.reply.at(-1)!.messages[0] as { text: string }).text).toBe(ZH_HANT.rateLimited);
  });

  test("a throwing rate limiter still records (fail-open)", async () => {
    const { client } = createLineFakeClient({
      line_context: () => LINKED_CONTEXT,
      consume_rate_limit: () => {
        throw new Error("counter down");
      },
    });
    const line = fakeLineClient();

    await handleLineWebhook(deps(client, line.client), { rawBody: bytes(BODY_B), signature: sign(BODY_B) });

    expect(client.rpcCall("line_record_entry")).toBeDefined();
  });
});

describe("handleLineWebhook - error handling", () => {
  // [MV]: the log line must never carry the message text, the reply token or
  // a raw LINE user id. Change the log call to interpolate
  // event.message?.text (or event.replyToken, or the raw userId) and this
  // goes red.
  test("a throwing RPC still returns 200 with a generic-error reply, and logs neither the message text, the reply token, nor a raw LINE userId", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const { client } = createLineFakeClient({
        line_context: () => LINKED_CONTEXT,
        line_record_entry: () => {
          throw new Error("boom");
        },
      });
      const line = fakeLineClient();

      const result = await handleLineWebhook(deps(client, line.client), { rawBody: bytes(BODY_B), signature: sign(BODY_B) });

      expect(result.status).toBe(200);
      expect((line.calls.reply.at(-1)!.messages[0] as { text: string }).text).toBe(ZH_HANT.genericError);

      const logged = consoleErrorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(logged).not.toContain("早餐");
      expect(logged).not.toContain("rt1");
      expect(logged).not.toContain(LINE_USER_ID);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});

describe("handleLineWebhook - review fixes", () => {
  const send = (d: LineWebhookDeps, events: unknown[]) => {
    const body = webhookBody(events);
    return handleLineWebhook(d, { rawBody: bytes(body), signature: sign(body) });
  };
  const textOf = (line: ReturnType<typeof fakeLineClient>) =>
    (line.calls.reply.at(-1)!.messages[0] as { text: string }).text;

  // [MV]: the rate limit is the first database call, ahead of the context lookup.
  test("a rate-limited message never reaches line_context, and is answered in zh-Hant", async () => {
    const { client } = createLineFakeClient({
      consume_rate_limit: () => ({ allowed: false, retry_after: 5 }),
      line_context: () => {
        throw new Error("line_context must not be called");
      },
    });
    const line = fakeLineClient();

    const result = await send(deps(client, line.client), [messageEvent({ text: "早餐 60" })]);

    expect(result.status).toBe(200);
    expect(client.rpcCall("line_context")).toBeUndefined();
    expect(textOf(line)).toBe(ZH_HANT.rateLimited);
    expect(client.calls.map((c) => (c.op === "rpc" ? c.fn : c.op))).toEqual(["consume_rate_limit"]);
  });

  test("a linked user sending 綁定 is told they are already linked (masked email) and no link is issued", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient();

    await send(deps(client, line.client), [messageEvent({ text: "綁定" })]);

    expect(line.calls.issueLinkToken).toHaveLength(0);
    expect(client.rpcCall("line_register_link_token")).toBeUndefined();
    expect(textOf(line)).toContain("al***@example.com");
    expect(textOf(line)).not.toContain("alice@example.com");
  });

  // [MV]
  test("解除綁定 still works while maintenance is on", async () => {
    const { client } = createLineFakeClient({
      site_notice_settings: () => ({
        banner: { message: "", level: "info", ends_at: null, active: false },
        maintenance: { enabled: true, message: "" },
      }),
      line_context: () => LINKED_CONTEXT,
    });
    const line = fakeLineClient();

    await send(deps(client, line.client), [messageEvent({ text: "解除綁定" })]);

    expect(client.rpcCall("line_unlink")).toBeDefined();
    expect(textOf(line)).toBe(ZH_HANT.unlinked);
  });

  test("a redelivered undo that found nothing keeps answering the same, even after a new entry exists", async () => {
    // Mirrors line_undo_last's contract: the first outcome for an event id is
    // remembered and echoed, so a later, newer entry is never touched.
    const outcomes = new Map<string, unknown>();
    const entries: string[] = [];
    const { client } = createLineFakeClient({
      line_context: () => LINKED_CONTEXT,
      line_undo_last: (args) => {
        const key = args.p_event_id as string;
        if (outcomes.has(key)) return { ...(outcomes.get(key) as object), replay: true };
        const outcome = entries.length
          ? { ok: true, replay: false, expense: { title: entries.pop(), amount_minor: 6000, currency: "TWD" } }
          : { ok: false, reason: "nothing_to_undo" };
        outcomes.set(key, outcome);
        return outcome;
      },
    });
    const line = fakeLineClient();
    const undo = messageEvent({ text: "復原", webhookEventId: "01J0000000000000000000000U" });

    await send(deps(client, line.client), [undo]);
    const first = textOf(line);
    entries.push("新的一筆");
    await send(deps(client, line.client), [{ ...undo, deliveryContext: { isRedelivery: true } }]);

    expect(first).toContain("沒有可以復原");
    expect(textOf(line)).toBe(first);
    expect(entries).toEqual(["新的一筆"]);
  });

  test("a date in the message is refused with the pointer to the app", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient();

    await send(deps(client, line.client), [messageEvent({ text: "午餐 120 9/30" })]);

    expect(client.rpcCall("line_record_entry")).toBeUndefined();
    expect(textOf(line)).toBe(ZH_HANT.dateNotSupported);
  });

  test("「薪水 50000」 is recorded as income / salary", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient();

    await send(deps(client, line.client), [messageEvent({ text: "薪水 50000" })]);

    expect(client.rpcCall("line_record_entry")?.args).toMatchObject({
      p_kind: "income",
      p_category: "salary",
      p_amount_minor: 5000000,
      p_title: "薪水",
    });
  });
});

describe("handleLineWebhook - budget commands", () => {
  // 2026-09 in Taiwan time, so the month passed to the RPCs is 2026-09-01.
  const budgetDeps = (client: FakePostgrest, line: LineClient): LineWebhookDeps => ({
    ...deps(client, line),
    now: () => 1790000000000,
  });
  const send = (d: LineWebhookDeps, events: unknown[]) => {
    const body = webhookBody(events);
    return handleLineWebhook(d, { rawBody: bytes(body), signature: sign(body) });
  };
  const messageOf = (line: ReturnType<typeof fakeLineClient>) =>
    line.calls.reply.at(-1)!.messages[0] as {
      text: string;
      quickReply?: { items: Array<{ action: { type: string; label: string; uri?: string } }> };
    };
  const rpcCalls = (client: FakePostgrest, fn: string) =>
    client.calls.filter((c): c is Extract<typeof c, { op: "rpc" }> => c.op === "rpc" && c.fn === fn);
  const maintenanceOn = () => ({
    banner: { message: "", level: "info", ends_at: null, active: false },
    maintenance: { enabled: true, message: "" },
  });

  test("「預算 15000」 sets the budget and replies with budget, spent, what is left and the quick replies", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient();

    await send(budgetDeps(client, line.client), [messageEvent({ text: "預算 15000" })]);

    expect(client.rpcCall("line_set_budget")?.args).toEqual({
      p_line_user_id: LINE_USER_ID,
      p_budget_minor: 1500000,
      p_month_start: "2026-09-01",
    });
    const message = messageOf(line);
    expect(message.text).toContain("$15,000");
    expect(message.text).toContain("$6,000");
    expect(message.text).toContain("還剩 $9,000");
    expect(message.quickReply?.items.map((i) => i.action.label)).toEqual(["本月", "開啟帳本"]);
    expect(message.quickReply?.items[1].action.uri).toContain("/group/ledger_1");
  });

  test("over budget says how far over", async () => {
    const { client } = createLineFakeClient({
      line_context: () => LINKED_CONTEXT,
      line_set_budget: (args) => ({
        ok: true,
        ledger_id: "ledger_1",
        currency: "TWD",
        budget_minor: args.p_budget_minor,
        month: { expense_minor: 2000000, income_minor: 0 },
      }),
    });
    const line = fakeLineClient();

    await send(budgetDeps(client, line.client), [messageEvent({ text: "預算 15000" })]);

    expect(messageOf(line).text).toContain("已超出 $5,000");
  });

  // [MV]: pass undefined (or leave the key out) instead of null and this goes
  // red - JSON drops an undefined key and PostgREST then cannot find the function.
  test("「取消預算」 sends an explicit null and replies budgetCleared", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient();

    await send(budgetDeps(client, line.client), [messageEvent({ text: "取消預算" })]);

    expect(client.rpcCall("line_set_budget")?.args).toEqual({
      p_line_user_id: LINE_USER_ID,
      p_budget_minor: null,
      p_month_start: "2026-09-01",
    });
    expect(messageOf(line).text).toBe(ZH_HANT.budgetCleared);
  });

  // [MV]: remove the gate from the write handler, or add one to the show handler, and this goes red.
  test("maintenance blocks setting and clearing, but not viewing", async () => {
    const { client } = createLineFakeClient({
      line_context: () => LINKED_CONTEXT,
      site_notice_settings: maintenanceOn,
    });
    const line = fakeLineClient();
    const d = budgetDeps(client, line.client);

    await send(d, [messageEvent({ text: "預算 15000" })]);
    expect(messageOf(line).text).toBe(ZH_HANT.maintenance);
    await send(d, [messageEvent({ text: "取消預算" })]);
    expect(messageOf(line).text).toBe(ZH_HANT.maintenance);
    expect(client.rpcCall("line_set_budget")).toBeUndefined();

    await send(d, [messageEvent({ text: "預算" })]);
    expect(client.rpcCall("line_month_summary")).toBeDefined();
    expect(messageOf(line).text).not.toBe(ZH_HANT.maintenance);
  });

  test("「預算」 with no budget set explains how to set one; with a budget it shows it", async () => {
    let budget: number | null = null;
    const { client } = createLineFakeClient({
      line_context: () => LINKED_CONTEXT,
      line_month_summary: () => ({
        ok: true,
        ledger_id: "ledger_1",
        currency: "TWD",
        budget_minor: budget,
        month: { expense_minor: 600000, income_minor: 0 },
      }),
    });
    const line = fakeLineClient();
    const d = budgetDeps(client, line.client);

    await send(d, [messageEvent({ text: "預算" })]);
    expect(messageOf(line).text).toBe(ZH_HANT.budgetNone);

    budget = 1500000;
    await send(d, [messageEvent({ text: "預算" })]);
    expect(messageOf(line).text).toContain("每月預算 $15,000");
    expect(rpcCalls(client, "line_month_summary")[1].args.p_month_start).toBe("2026-09-01");
  });

  test("「預算 0」 is refused with budgetInvalid and touches neither RPC", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient();

    await send(budgetDeps(client, line.client), [messageEvent({ text: "預算 0" })]);

    expect(client.rpcCall("line_set_budget")).toBeUndefined();
    expect(client.rpcCall("line_month_summary")).toBeUndefined();
    expect(messageOf(line).text).toBe(ZH_HANT.budgetInvalid);
  });

  test("「預算外 300」 is still recorded as an expense", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient();

    await send(budgetDeps(client, line.client), [messageEvent({ text: "預算外 300" })]);

    expect(client.rpcCall("line_set_budget")).toBeUndefined();
    expect(client.rpcCall("line_record_entry")?.args).toMatchObject({ p_title: "預算外", p_amount_minor: 30000 });
  });

  test("the same delivery twice makes two identical calls and gets an identical reply", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient();
    const d = budgetDeps(client, line.client);
    const event = messageEvent({ text: "預算 15000", webhookEventId: "01J0000000000000000000000B" });

    await send(d, [event]);
    await send(d, [{ ...event, deliveryContext: { isRedelivery: true } }]);

    const calls = rpcCalls(client, "line_set_budget");
    expect(calls).toHaveLength(2);
    expect(calls[1].args).toEqual(calls[0].args);
    expect(line.calls.reply).toHaveLength(2);
    expect(messageOf(line).text).toBe((line.calls.reply[0].messages[0] as { text: string }).text);
  });

  test("a missing ledger answers noLedger", async () => {
    const { client } = createLineFakeClient({
      line_context: () => LINKED_CONTEXT,
      line_set_budget: () => ({ ok: false, reason: "no_ledger" }),
    });
    const line = fakeLineClient();

    await send(budgetDeps(client, line.client), [messageEvent({ text: "預算 15000" })]);

    expect(messageOf(line).text).toBe(ZH_HANT.noLedger);
  });

  test("a too-large budget gets budgetTooLarge, not the 'above 0' text, and touches no RPC", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient();

    await send(budgetDeps(client, line.client), [messageEvent({ text: "預算 99999999999" })]);

    expect(client.rpcCall("line_set_budget")).toBeUndefined();
    expect(messageOf(line).text).toBe(ZH_HANT.budgetTooLarge);
  });

  test("a near-miss like 「預算 15000 餐飲」 asks what was meant and records nothing", async () => {
    const { client } = createLineFakeClient({ line_context: () => LINKED_CONTEXT });
    const line = fakeLineClient();

    await send(budgetDeps(client, line.client), [messageEvent({ text: "預算 15000 餐飲" })]);

    expect(client.rpcCall("line_set_budget")).toBeUndefined();
    expect(client.rpcCall("line_record_entry")).toBeUndefined();
    expect(messageOf(line).text).toBe(ZH_HANT.budgetAmbiguous);
  });

  test("an English-locale user gets the English reply", async () => {
    const { client } = createLineFakeClient({ line_context: () => ({ ...LINKED_CONTEXT, locale: "en" }) });
    const line = fakeLineClient();

    await send(budgetDeps(client, line.client), [messageEvent({ text: "預算 15000" })]);

    expect(messageOf(line).text.startsWith("Monthly budget set to")).toBe(true);
    expect(messageOf(line).text).toContain("$9,000 left");
  });
});
