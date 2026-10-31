import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_CATALOG } from "../../app/catalog.js";
import { fill } from "../push/pushText.js";
import { categoryDisplay } from "./lineCardTheme.js";
import { type LineFlexMessage, type LineMessage, type LineQuickReply, bubble, flexMessage, text, vbox } from "./lineFlex.js";
import { lineMessageProblems, lineReplyProblems, postbacksOf, uriActionsOf } from "./lineFlexValidator.js";
import { encodeLinePostback, parseLinePostback } from "./linePostback.js";
import {
  type LineCard,
  type LineOutgoing,
  budgetClearedReply,
  budgetReply,
  cardOrFallback,
  deleteConfirmReply,
  deleteResultReply,
  fallbackMessages,
  helpReply,
  isLineCard,
  linkReply,
  linkedReply,
  monthReply,
  recordedReply,
  recordQuickReply,
  standardQuickReply,
  textMessage,
  wireMessages,
  withQuickReply,
} from "./lineMessages.js";
import { lineLinks } from "./lineLinks.js";
import { LINE_TEXT_EN as EN, LINE_TEXT_ZH_HANT as ZH_HANT } from "./lineText.js";

// lineCards.ts is mocked only to be able to make a card builder throw on cue;
// everything else about it is the real module.
const faults = vi.hoisted(() => ({
  helpCard: false,
  recordCard: false,
  monthCard: false,
  budgetCard: false,
  linkCard: false,
  linkedCard: false,
}));
vi.mock("./lineCards.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lineCards.js")>();
  return {
    ...actual,
    helpCard: (...args: Parameters<typeof actual.helpCard>) => {
      if (faults.helpCard) throw new Error("helpCard exploded");
      return actual.helpCard(...args);
    },
    recordCard: (...args: Parameters<typeof actual.recordCard>) => {
      if (faults.recordCard) throw new Error("recordCard exploded");
      return actual.recordCard(...args);
    },
    monthCard: (...args: Parameters<typeof actual.monthCard>) => {
      if (faults.monthCard) throw new Error("monthCard exploded");
      return actual.monthCard(...args);
    },
    budgetCard: (...args: Parameters<typeof actual.budgetCard>) => {
      if (faults.budgetCard) throw new Error("budgetCard exploded");
      return actual.budgetCard(...args);
    },
    linkCard: (...args: Parameters<typeof actual.linkCard>) => {
      if (faults.linkCard) throw new Error("linkCard exploded");
      return actual.linkCard(...args);
    },
    linkedCard: (...args: Parameters<typeof actual.linkedCard>) => {
      if (faults.linkedCard) throw new Error("linkedCard exploded");
      return actual.linkedCard(...args);
    },
  };
});

const QUICK_REPLY: LineQuickReply = {
  items: [{ type: "action", action: { type: "uri", label: "開啟帳本", uri: "https://example.com/group/1" } }],
};

function flex(altText: string, quickReply?: LineQuickReply): LineFlexMessage {
  const body = vbox([text("x", { color: "#EEF1F6" })], { paddingAll: "20px" });
  return flexMessage(altText, bubble({ body, background: "#12151F" }), quickReply);
}

function card(message: LineFlexMessage | null, fallback: LineMessage[]): LineCard {
  return { kind: "card", name: "record", message, fallback };
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  Object.assign(faults, {
    helpCard: false,
    recordCard: false,
    monthCard: false,
    budgetCard: false,
    linkCard: false,
    linkedCard: false,
  });
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  errorSpy.mockRestore();
});

describe("isLineCard", () => {
  test("is true for a card and false for each of the three real message shapes", () => {
    expect(isLineCard(card(flex("a"), []))).toBe(true);
    expect(isLineCard(textMessage("a"))).toBe(false);
    expect(isLineCard(flex("a"))).toBe(false);
    expect(
      isLineCard({
        type: "template",
        altText: "a",
        template: { type: "buttons", text: "a", actions: [{ type: "uri", label: "a", uri: "https://example.com" }] },
      }),
    ).toBe(false);
  });
});

describe("wireMessages", () => {
  test("a plain message goes out as it is", () => {
    const plain = textMessage("hi", QUICK_REPLY);
    const wire = wireMessages([plain]);
    expect(wire).toEqual([plain]);
    expect(wire[0]).toBe(plain);
  });

  test("a card goes out as its Flex message, not its fallback", () => {
    const message = flex("alt", QUICK_REPLY);
    expect(wireMessages([card(message, [textMessage("plain", QUICK_REPLY)])])).toEqual([message]);
  });

  // [MV]: stop checking for a null message in wireMessages and a failed build puts null on the wire.
  test("a card whose build failed (message null) goes out as its fallback straight away", () => {
    const fallback = [textMessage("plain", QUICK_REPLY)];
    expect(wireMessages([card(null, fallback)])).toEqual(fallback);
  });

  test("keeps the order of a mixed reply: plain, card, built-failed card, plain", () => {
    const first = textMessage("one");
    const built = flex("two");
    const fallbackOfFailed = textMessage("three");
    const last = textMessage("four");

    const items: LineOutgoing[] = [first, card(built, [textMessage("unused")]), card(null, [fallbackOfFailed]), last];

    expect(wireMessages(items)).toEqual([first, built, fallbackOfFailed, last]);
  });

  test("a card with a two-message fallback expands to two when its build failed", () => {
    const fallback = [textMessage("greeting"), textMessage("button")];
    expect(wireMessages([card(null, fallback)])).toEqual(fallback);
  });
});

describe("fallbackMessages", () => {
  test("a card becomes its fallback whether or not it built; plain messages pass through", () => {
    const plain = textMessage("keep");
    const fallbackA = textMessage("a", QUICK_REPLY);
    const fallbackB = [textMessage("b1"), textMessage("b2")];

    const result = fallbackMessages([plain, card(flex("built"), [fallbackA]), card(null, fallbackB)]);

    expect(result).toEqual([plain, fallbackA, ...fallbackB]);
    expect(result[0]).toBe(plain);
  });

  // [MV]: drop the quick reply from the fallback and the buttons under the plain reply disappear.
  test("the fallback keeps the quick reply it was given", () => {
    const [message] = fallbackMessages([card(flex("a", QUICK_REPLY), [textMessage("plain", QUICK_REPLY)])]);
    expect(message).toEqual({ type: "text", text: "plain", quickReply: QUICK_REPLY });
  });

  test("never contains a card object: only things LINE accepts", () => {
    const result = fallbackMessages([card(flex("a"), [textMessage("b")]), card(null, [textMessage("c")])]);
    for (const message of result) expect(lineMessageProblems(message)).toEqual([]);
  });
});

describe("cardOrFallback", () => {
  test("a build that works gives the message, keeps the fallback, and logs nothing", () => {
    const message = flex("alt");
    const fallback = [textMessage("plain")];

    const result = cardOrFallback("budget", () => message, fallback);

    expect(result).toEqual({ kind: "card", name: "budget", message, fallback });
    expect(result.message).toBe(message);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  // [MV]: remove the try/catch and the throw escapes here, and out of every handler.
  test("a build that throws gives message null, the fallback on the wire, and a log line", () => {
    const fallback = [textMessage("plain", QUICK_REPLY)];

    const result = cardOrFallback(
      "record",
      () => {
        throw new Error("no such colour");
      },
      fallback,
    );

    expect(result.message).toBeNull();
    expect(result.name).toBe("record");
    expect(wireMessages([result])).toEqual(fallback);
    expect(errorSpy.mock.calls).toEqual([["[line] card build failed (record): no such colour"]]);
  });

  test("a thrown non-Error is logged too, and a LINE user id in the message is redacted", () => {
    cardOrFallback(
      "month",
      () => {
        throw "U0123456789abcdef0123456789abcdef is wrong";
      },
      [textMessage("plain")],
    );

    const logged = errorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain("card build failed (month)");
    expect(logged).not.toContain("U0123456789abcdef0123456789abcdef");
  });
});

describe("helpReply", () => {
  test("is a help card whose altText and text fallback are both today's plain help text", () => {
    for (const dict of [ZH_HANT, EN]) {
      const reply = helpReply(dict, 30);
      expect(isLineCard(reply)).toBe(true);
      if (!isLineCard(reply)) return;

      const plain = fill(dict.help, { minutes: 30 });
      expect(reply.name).toBe("help");
      expect(reply.message?.altText).toBe(plain);
      expect(reply.fallback).toEqual([{ type: "text", text: plain }]);
      expect(reply.message?.quickReply).toBeUndefined();
      expect(lineMessageProblems(reply.message)).toEqual([]);
    }
  });

  test("a quick reply given to it goes under the card and under the fallback, and none by default", () => {
    const qr = standardQuickReply(ZH_HANT, LINKS, ["help"]);
    const reply = helpReply(ZH_HANT, 30, qr);
    expect(isLineCard(reply)).toBe(true);
    if (!isLineCard(reply)) return;

    expect(labelsOf(reply.message?.quickReply)).toEqual(["本月", "明細", "分析"]);
    expect(reply.fallback).toEqual([{ type: "text", text: fill(ZH_HANT.help, { minutes: 30 }), quickReply: qr }]);
    expect(lineMessageProblems(reply.message)).toEqual([]);
    // Nothing on the card itself can be tapped.
    expect(JSON.stringify(reply.message?.contents)).not.toContain('"action"');
  });

  // [MV]: a card builder that throws must cost nothing but the card.
  test("when the card cannot be built the user still gets the help, as plain text", () => {
    faults.helpCard = true;

    const reply = helpReply(ZH_HANT, 30);

    expect(wireMessages([reply])).toEqual([{ type: "text", text: fill(ZH_HANT.help, { minutes: 30 }) }]);
    expect(errorSpy.mock.calls).toEqual([["[line] card build failed (help): helpCard exploded"]]);
  });
});

// ---------------------------------------------------------------------------
// Record, month and budget replies
// ---------------------------------------------------------------------------

const ORIGIN = "https://equo-mu.vercel.app";
const LINKS = lineLinks({ appOrigin: ORIGIN, ledgerId: "ledger_1" });
const LEDGER = `${ORIGIN}/group/ledger_1?openExternalBrowser=1`;
const RECORDS = `${ORIGIN}/group/ledger_1?view=records&openExternalBrowser=1`;
const ANALYSIS = `${ORIGIN}/group/ledger_1?view=analysis&openExternalBrowser=1`;

function asCard(reply: LineOutgoing): LineCard {
  expect(isLineCard(reply)).toBe(true);
  return reply as LineCard;
}

const ENTRY_KEY = "msg:4711000000001";

/** Labels of a quick reply, in order. */
function labelsOf(quickReply: LineQuickReply | undefined): string[] {
  return (quickReply?.items ?? []).map((item) => item.action.label);
}

describe("recordedReply", () => {
  const recordArgs = (
    locale: "zh-Hant" | "en",
    overrides: Partial<Parameters<typeof recordedReply>[1]> = {},
  ): Parameters<typeof recordedReply>[1] => ({
    kind: "expense",
    title: locale === "en" ? "Breakfast" : "早餐",
    amountMinor: 6000,
    category: categoryDisplay("food", DEFAULT_CATALOG.categories, locale),
    currency: "TWD",
    budgetMinor: 1_500_000,
    month: { expense_minor: 606_000, income_minor: 0 },
    dateKey: "2026-09-21",
    entryKey: ENTRY_KEY,
    links: LINKS,
    ...overrides,
  });

  // The reply is a list so the shortcuts have a "last message" to sit on; today it is the card alone.
  const recordCardOf = (dict: typeof ZH_HANT, args: Parameters<typeof recordedReply>[1]): LineCard => {
    const reply = recordedReply(dict, args);
    expect(reply).toHaveLength(1);
    return asCard(reply[0]);
  };

  // [MV]: change any card altText and the literal below goes red.
  test.each([
    [
      "zh expense with budget left",
      ZH_HANT,
      "zh-Hant" as const,
      {},
      "已記下支出：早餐 $60（餐飲）\n本月支出 $6,060，預算剩 $8,940",
    ],
    [
      "zh expense over budget",
      ZH_HANT,
      "zh-Hant" as const,
      { month: { expense_minor: 2_006_000, income_minor: 0 } },
      "已記下支出：早餐 $60（餐飲）\n本月支出 $20,060，已超出預算 $5,060",
    ],
    [
      "zh expense without a budget",
      ZH_HANT,
      "zh-Hant" as const,
      { budgetMinor: null, month: { expense_minor: 6000, income_minor: 0 } },
      "已記下支出：早餐 $60（餐飲）\n本月支出 $60",
    ],
    [
      "zh income",
      ZH_HANT,
      "zh-Hant" as const,
      {
        kind: "income" as const,
        title: "薪水",
        amountMinor: 5_200_000,
        category: categoryDisplay("salary", DEFAULT_CATALOG.categories, "zh-Hant"),
        month: { expense_minor: 0, income_minor: 5_200_000 },
      },
      "已記下收入：薪水 $52,000（薪資）\n本月收入 $52,000",
    ],
    [
      "en expense with budget left",
      EN,
      "en" as const,
      {},
      "Recorded expense: Breakfast $60 (Food)\nSpent this month: $6,060, $8,940 left in budget",
    ],
    [
      "en income",
      EN,
      "en" as const,
      {
        kind: "income" as const,
        title: "Salary",
        amountMinor: 5_200_000,
        category: categoryDisplay("salary", DEFAULT_CATALOG.categories, "en"),
        month: { expense_minor: 0, income_minor: 5_200_000 },
      },
      "Recorded income: Salary $52,000 (Salary)\nIncome this month: $52,000",
    ],
  ])("%s: the card's altText and the text fallback are today's plain text", (_label, dict, locale, overrides, expected) => {
    const reply = recordCardOf(dict, recordArgs(locale, overrides));

    expect(reply.name).toBe("record");
    expect(reply.message?.altText).toBe(expected);
    expect(reply.fallback).toHaveLength(1);
    expect(reply.fallback[0]).toMatchObject({ type: "text", text: expected });
    expect(lineMessageProblems(reply.message)).toEqual([]);
  });

  // [MV]: drop the quick reply from the card, or from the fallback, and this goes red.
  test("the undo, month, records and analysis quick replies sit under the card and under the fallback alike", () => {
    const reply = recordCardOf(ZH_HANT, recordArgs("zh-Hant"));

    expect(labelsOf(reply.message?.quickReply)).toEqual(["復原", "本月", "明細", "分析"]);
    expect(reply.message?.quickReply?.items[0].action).toEqual({ type: "message", label: "復原", text: "復原" });
    expect(reply.message?.quickReply?.items[2].action).toEqual({ type: "uri", label: "明細", uri: RECORDS });
    expect(reply.message?.quickReply?.items[3].action).toEqual({ type: "uri", label: "分析", uri: ANALYSIS });
    expect((reply.fallback[0] as { quickReply?: LineQuickReply }).quickReply).toEqual(reply.message?.quickReply);
  });

  test("the card shows the date the entry was recorded under, in the dictionary's own format", () => {
    expect(JSON.stringify(recordCardOf(ZH_HANT, recordArgs("zh-Hant")).message)).toContain("9月21日");
    expect(JSON.stringify(recordCardOf(EN, recordArgs("en")).message)).toContain("9/21");
  });

  test("a date key that is not a date draws a dash instead of a broken date", () => {
    const reply = recordCardOf(ZH_HANT, recordArgs("zh-Hant", { dateKey: "not a date" }));
    expect(lineMessageProblems(reply.message)).toEqual([]);
    expect(JSON.stringify(reply.message)).not.toContain("NaN");
  });

  // [MV]: remove the try/catch in cardOrFallback and a throwing builder takes the reply down with it.
  test("a card that cannot be built is still a reply: today's text, with the same quick replies", () => {
    faults.recordCard = true;

    const reply = recordCardOf(ZH_HANT, recordArgs("zh-Hant"));
    const [wire] = wireMessages([reply]);

    expect(reply.message).toBeNull();
    expect(wire).toMatchObject({ type: "text", text: "已記下支出：早餐 $60（餐飲）\n本月支出 $6,060，預算剩 $8,940" });
    expect(labelsOf((wire as { quickReply?: LineQuickReply }).quickReply)).toEqual(["復原", "本月", "明細", "分析"]);
    expect(errorSpy.mock.calls).toEqual([["[line] card build failed (record): recordCard exploded"]]);
  });

  describe("the footer buttons and where the shortcuts sit", () => {
    // [MV]: point 編輯 at the ledger home, or at another key, and this goes red.
    test("編輯 opens the entry by its key; 刪除 asks to delete that same key - nothing else is in the card", () => {
      const reply = recordCardOf(ZH_HANT, recordArgs("zh-Hant"));

      expect(uriActionsOf(reply.message as LineFlexMessage)).toEqual([
        { type: "uri", label: "編輯", uri: `${ORIGIN}/group/ledger_1?entry=${encodeURIComponent(ENTRY_KEY)}&openExternalBrowser=1` },
      ]);
      const postbacks = postbacksOf(reply.message as LineFlexMessage);
      expect(postbacks).toHaveLength(1);
      expect(postbacks[0]).toMatchObject({ type: "postback", label: "刪除", displayText: "刪除這筆" });
      expect(parseLinePostback(postbacks[0].data)).toEqual({ action: "delete_ask", entryKey: ENTRY_KEY });
    });

    // [MV]: put a delete_confirm on the card and the user could delete with one tap, no question asked.
    test("the card can only ever ASK: its single postback is delete_ask, never the confirm", () => {
      const reply = recordCardOf(EN, recordArgs("en"));
      for (const postback of postbacksOf(reply.message as LineFlexMessage)) {
        expect(parseLinePostback(postback.data)?.action).toBe("delete_ask");
      }
    });

    // [MV]: a plain-text fallback with a postback in it is a button that cannot be honoured.
    test("the text fallback carries no buttons at all - and so no postback it cannot honour", () => {
      faults.recordCard = true;
      const reply = recordCardOf(ZH_HANT, recordArgs("zh-Hant"));

      expect(reply.message).toBeNull();
      expect(reply.fallback).toHaveLength(1);
      const wire = wireMessages([reply]);
      expect(JSON.stringify(wire)).not.toContain("postback");
      expect(JSON.stringify(wire)).not.toContain("delete_ask");
    });

    // [MV]: leave the quick reply off the last message and LINE removes it as soon as the next message goes out.
    test("the quick reply is on the last message of the reply, and the whole reply passes the reply-level check", () => {
      const reply = recordedReply(ZH_HANT, recordArgs("zh-Hant"));
      expect(lineReplyProblems(wireMessages(reply))).toEqual([]);
      expect(labelsOf((wireMessages(reply).at(-1) as { quickReply?: LineQuickReply }).quickReply)).toEqual([
        "復原",
        "本月",
        "明細",
        "分析",
      ]);
    });
  });
});

describe("withQuickReply", () => {
  const QR: LineQuickReply = {
    items: [{ type: "action", action: { type: "message", label: "好", text: "好" } }],
  };
  const OLD: LineQuickReply = {
    items: [{ type: "action", action: { type: "message", label: "舊", text: "舊" } }],
  };

  test("an empty reply stays empty", () => {
    expect(withQuickReply([], QR)).toEqual([]);
  });

  // [MV]: apply it to every item and LINE drops all but the last.
  test("goes on the last message only; the ones before are left exactly as they were", () => {
    const head = textMessage("one");
    const middle = card(flex("two"), [textMessage("two")]);
    const out = withQuickReply([head, middle, textMessage("three")], QR);

    expect(out).toHaveLength(3);
    expect(out[0]).toEqual(head);
    expect(out[1]).toEqual(middle);
    expect((out[2] as { quickReply?: LineQuickReply }).quickReply).toEqual(QR);
  });

  test("replaces a quick reply the last message already had, and does not mutate its input", () => {
    const last = textMessage("x", OLD);
    const out = withQuickReply([last], QR);

    expect((out[0] as { quickReply?: LineQuickReply }).quickReply).toEqual(QR);
    expect(last.quickReply).toEqual(OLD);
  });

  // [MV]: forget the fallback and a LINE 400 turns the shortcuts into nothing.
  test("a card gets it on its Flex message AND on the last message of its fallback", () => {
    const fallback = [textMessage("a"), textMessage("b")];
    const out = withQuickReply([card(flex("alt"), fallback)], QR);
    const only = out[0] as LineCard;

    expect(only.message?.quickReply).toEqual(QR);
    expect((only.fallback[0] as { quickReply?: unknown }).quickReply).toBeUndefined();
    expect((only.fallback[1] as { quickReply?: LineQuickReply }).quickReply).toEqual(QR);
    expect(fallback.every((m) => (m as { quickReply?: unknown }).quickReply === undefined)).toBe(true);
  });

  test("a card that could not be built (no Flex message) still puts it on its fallback", () => {
    const out = withQuickReply([card(null, [textMessage("only text")])], QR);
    const only = out[0] as LineCard;

    expect(only.message).toBeNull();
    expect((only.fallback[0] as { quickReply?: LineQuickReply }).quickReply).toEqual(QR);
  });
});

describe("deleteConfirmReply", () => {
  const confirmArgs = (overrides: Partial<Parameters<typeof deleteConfirmReply>[1]> = {}) => ({
    title: "早餐",
    amountMinor: 6000,
    currency: "TWD",
    edited: false,
    entryKey: ENTRY_KEY,
    ...overrides,
  });

  test("asks about the entry by name and amount, in the dictionary's words", () => {
    expect(deleteConfirmReply(ZH_HANT, confirmArgs()).text).toBe("確定刪除『早餐 $60』？");
    expect(deleteConfirmReply(EN, confirmArgs({ title: "Breakfast" })).text).toBe('Delete "Breakfast $60"?');
  });

  // [MV]: ignore `edited` and a person is asked about an entry that no longer is what the card showed, without being told.
  test("says so when the entry was edited in the app since the card was made", () => {
    expect(deleteConfirmReply(ZH_HANT, confirmArgs({ edited: true, title: "午餐", amountMinor: 12000 })).text).toBe(
      "這筆在 App 裡改過了，現在是『午餐 $120』。確定刪除？",
    );
    expect(deleteConfirmReply(EN, confirmArgs({ edited: true, title: "Lunch", amountMinor: 12000 })).text).toBe(
      'This entry was edited in the app and is now "Lunch $120". Delete it?',
    );
  });

  // [MV]: send the wrong key in the confirm and the tap would delete something else (or nothing).
  test("offers exactly two answers: 確定刪除 for THIS key, then 取消", () => {
    const reply = deleteConfirmReply(ZH_HANT, confirmArgs());
    const [yes, no] = (reply.quickReply?.items ?? []).map((item) => item.action);

    expect(reply.quickReply?.items).toHaveLength(2);
    expect(yes).toEqual({
      type: "postback",
      label: "確定刪除",
      data: encodeLinePostback({ action: "delete_confirm", entryKey: ENTRY_KEY }),
      displayText: "確定刪除",
    });
    expect(no).toEqual({
      type: "postback",
      label: "取消",
      data: encodeLinePostback({ action: "delete_cancel" }),
      displayText: "取消",
    });
  });

  test("English labels are Delete and Cancel", () => {
    const labels = labelsOf(deleteConfirmReply(EN, confirmArgs()).quickReply);
    expect(labels).toEqual(["Delete", "Cancel"]);
  });

  test("the whole reply passes the validator in both locales", () => {
    for (const dict of [ZH_HANT, EN]) {
      expect(lineReplyProblems(wireMessages([deleteConfirmReply(dict, confirmArgs({ edited: true }))]))).toEqual([]);
    }
  });

  test("a long title still gives a message LINE accepts", () => {
    const reply = deleteConfirmReply(ZH_HANT, confirmArgs({ title: "長".repeat(500) }));
    expect(lineReplyProblems(wireMessages([reply]))).toEqual([]);
  });
});

describe("deleteResultReply", () => {
  test.each([
    ["deleted", ZH_HANT, { kind: "deleted" as const, title: "早餐", amountMinor: 6000, currency: "TWD" }, "已刪除：早餐 $60"],
    ["deleted (en)", EN, { kind: "deleted" as const, title: "Breakfast", amountMinor: 6000, currency: "TWD" }, "Deleted: Breakfast $60"],
    ["cancelled", ZH_HANT, { kind: "cancelled" as const }, "好的，沒有刪除。"],
    ["already_gone", ZH_HANT, { kind: "already_gone" as const }, "這筆已經刪除了。"],
    ["not_found", ZH_HANT, { kind: "not_found" as const }, "找不到這筆記錄，可能是用其他 Equo 帳號記的，或已經不在帳本裡了。"],
    ["expired", ZH_HANT, { kind: "expired" as const }, "這個按鈕已經失效了，請重新操作一次。"],
    ["expired (en)", EN, { kind: "expired" as const }, "That button no longer works. Please try again."],
  ])("%s: the text, with the standard quick reply under it", (_label, dict, outcome, expected) => {
    const reply = deleteResultReply(dict, LINKS, outcome);

    expect(reply.text).toBe(expected);
    expect(labelsOf(reply.quickReply)).toEqual(labelsOf(standardQuickReply(dict, LINKS)));
    expect(lineReplyProblems(wireMessages([reply]))).toEqual([]);
  });

  test("without links (no ledger known) there are still shortcuts, just no links", () => {
    const reply = deleteResultReply(ZH_HANT, null, { kind: "cancelled" });
    expect(reply.quickReply).toEqual(standardQuickReply(ZH_HANT, null));
    expect(JSON.stringify(reply.quickReply)).not.toContain("http");
  });

  test("an answer never carries a postback: nothing here can start another delete", () => {
    for (const kind of ["cancelled", "already_gone", "not_found", "expired"] as const) {
      expect(JSON.stringify(deleteResultReply(ZH_HANT, LINKS, { kind }))).not.toContain("postback");
    }
  });
});

describe("monthReply", () => {
  const monthArgs = (overrides: Partial<Parameters<typeof monthReply>[1]> = {}): Parameters<typeof monthReply>[1] => ({
    year: 2026,
    month: 9,
    currency: "TWD",
    budgetMinor: 1_500_000,
    month_totals: { expense_minor: 606_000, income_minor: 5_200_000 },
    links: LINKS,
    ...overrides,
  });

  test.each([
    [
      "zh with a budget",
      ZH_HANT,
      {},
      "本月（2026 年 9 月）\n支出 $6,060\n收入 $52,000\n結餘 $45,940\n預算剩餘 $8,940",
    ],
    [
      "zh over budget",
      ZH_HANT,
      { budgetMinor: 500_000 },
      "本月（2026 年 9 月）\n支出 $6,060\n收入 $52,000\n結餘 $45,940\n超出預算 $1,060",
    ],
    [
      "zh without a budget",
      ZH_HANT,
      { budgetMinor: null },
      "本月（2026 年 9 月）\n支出 $6,060\n收入 $52,000\n結餘 $45,940",
    ],
    [
      "zh empty month",
      ZH_HANT,
      { budgetMinor: null, month_totals: { expense_minor: 0, income_minor: 0 } },
      "本月（2026 年 9 月）\n支出 $0\n收入 $0\n結餘 $0",
    ],
    [
      "en with a budget",
      EN,
      {},
      "This month (2026-09)\nSpent $6,060\nIncome $52,000\nNet $45,940\nBudget left $8,940",
    ],
  ])("%s: the card's altText and the text fallback are today's plain text", (_label, dict, overrides, expected) => {
    const reply = asCard(monthReply(dict, monthArgs(overrides)));

    expect(reply.name).toBe("month");
    expect(reply.message?.altText).toBe(expected);
    expect(reply.fallback).toEqual([{ type: "text", text: expected, quickReply: reply.message?.quickReply }]);
    expect(lineMessageProblems(reply.message)).toEqual([]);
  });

  // [MV]: put 本月 back and the month card offers the very thing it just answered.
  test("the quick reply is 明細 / 分析 / 說明 (no 本月), under the card and under the fallback", () => {
    const reply = asCard(monthReply(ZH_HANT, monthArgs()));
    expect(reply.message?.quickReply?.items).toEqual([
      { type: "action", action: { type: "uri", label: "明細", uri: RECORDS } },
      { type: "action", action: { type: "uri", label: "分析", uri: ANALYSIS } },
      { type: "action", action: { type: "message", label: "說明", text: "說明" } },
    ]);
    expect((reply.fallback[0] as { quickReply?: LineQuickReply }).quickReply).toEqual(reply.message?.quickReply);
  });

  test("the footer button still opens the ledger", () => {
    expect(JSON.stringify(asCard(monthReply(ZH_HANT, monthArgs())).message?.contents.footer)).toContain(LEDGER);
  });

  test("passes the breakdown through; without one the card has no by-category section", () => {
    const food = { category: categoryDisplay("food", DEFAULT_CATALOG.categories, "zh-Hant"), amountMinor: 300_000 };

    const withRows = JSON.stringify(asCard(monthReply(ZH_HANT, monthArgs({ categories: [food] }))).message);
    const without = JSON.stringify(asCard(monthReply(ZH_HANT, monthArgs())).message);

    expect(withRows).toContain(food.category.label);
    expect(withRows).toContain(ZH_HANT.cardByCategory);
    expect(without).not.toContain(ZH_HANT.cardByCategory);
    expect(without).not.toContain(ZH_HANT.cardNoSpending);
  });

  test("a card that cannot be built is still a reply: today's text with the same quick reply", () => {
    faults.monthCard = true;

    const reply = asCard(monthReply(ZH_HANT, monthArgs()));
    const [wire] = wireMessages([reply]);

    expect(reply.message).toBeNull();
    expect(wire).toMatchObject({ type: "text" });
    expect(labelsOf((wire as { quickReply?: LineQuickReply }).quickReply)).toEqual(["明細", "分析", "說明"]);
    expect(errorSpy.mock.calls).toEqual([["[line] card build failed (month): monthCard exploded"]]);
  });
});

describe("budgetReply", () => {
  const budgetArgs = (overrides: Partial<Parameters<typeof budgetReply>[1]> = {}): Parameters<typeof budgetReply>[1] => ({
    mode: "set",
    currency: "TWD",
    budgetMinor: 1_500_000,
    spentMinor: 600_000,
    links: LINKS,
    ...overrides,
  });

  test.each([
    ["zh set", ZH_HANT, {}, "每月預算已設為 $15,000。\n本月已花 $6,000，還剩 $9,000"],
    ["zh show", ZH_HANT, { mode: "show" as const }, "每月預算 $15,000\n本月已花 $6,000，還剩 $9,000"],
    ["zh over", ZH_HANT, { spentMinor: 2_000_000 }, "每月預算已設為 $15,000。\n本月已花 $20,000，已超出 $5,000"],
    ["en set", EN, {}, "Monthly budget set to $15,000.\nSpent this month: $6,000, $9,000 left"],
    ["en show", EN, { mode: "show" as const }, "Monthly budget: $15,000\nSpent this month: $6,000, $9,000 left"],
  ])("%s: the card's altText and the text fallback are today's plain text", (_label, dict, overrides, expected) => {
    const reply = asCard(budgetReply(dict, budgetArgs(overrides)));

    expect(reply.name).toBe("budget");
    expect(reply.message?.altText).toBe(expected);
    expect(reply.fallback).toEqual([{ type: "text", text: expected, quickReply: reply.message?.quickReply }]);
    expect(lineMessageProblems(reply.message)).toEqual([]);
  });

  test("quick replies are the standard four - no 復原", () => {
    const reply = asCard(budgetReply(ZH_HANT, budgetArgs()));
    expect(labelsOf(reply.message?.quickReply)).toEqual(["本月", "明細", "分析", "說明"]);
  });

  // [MV]: a budget of 0 or none has nothing to draw; it stays the "how to set one" text.
  test.each([null, 0])("a budget of %s is the plain how-to-set-one text, not a card", (budgetMinor) => {
    const reply = budgetReply(ZH_HANT, budgetArgs({ budgetMinor }));

    expect(isLineCard(reply)).toBe(false);
    expect(reply).toMatchObject({ type: "text", text: ZH_HANT.budgetNone });
    expect(labelsOf((reply as { quickReply?: LineQuickReply }).quickReply)).toEqual(["本月", "明細", "分析", "說明"]);
  });

  test("a card that cannot be built is still a reply: today's text with the same quick replies", () => {
    faults.budgetCard = true;

    const [wire] = wireMessages([budgetReply(ZH_HANT, budgetArgs())]);

    expect(wire).toMatchObject({ type: "text", text: "每月預算已設為 $15,000。\n本月已花 $6,000，還剩 $9,000" });
    expect(labelsOf((wire as { quickReply?: LineQuickReply }).quickReply)).toEqual(["本月", "明細", "分析", "說明"]);
  });

  test("「取消預算」 stays a plain text message, with the standard quick reply", () => {
    const reply = budgetClearedReply(ZH_HANT, { links: LINKS });
    expect(isLineCard(reply)).toBe(false);
    expect(reply).toMatchObject({ type: "text", text: ZH_HANT.budgetCleared });
    expect(labelsOf((reply as { quickReply?: LineQuickReply }).quickReply)).toEqual(["本月", "明細", "分析", "說明"]);
  });
});

// ---------------------------------------------------------------------------
// Link and linked replies
// ---------------------------------------------------------------------------

describe("linkReply", () => {
  const URL = "https://equo-mu.vercel.app/line/link?linkToken=abc123&openExternalBrowser=1";
  const linkArgs = (overrides: Partial<Parameters<typeof linkReply>[1]> = {}): Parameters<typeof linkReply>[1] => ({
    url: URL,
    appOrigin: ORIGIN,
    ...overrides,
  });
  /** Exactly what the bot sent before cards: the buttons template, nothing added. */
  const buttons = (dict: typeof ZH_HANT) => ({
    type: "template",
    altText: dict.linkAltText,
    template: { type: "buttons", text: dict.linkPrompt, actions: [{ type: "uri", label: dict.linkButton, uri: URL }] },
  });

  // [MV]: give the link card a plain text(altText) fallback and the link button is gone from it.
  test("without a lead, the fallback is the buttons template and nothing else, and the altText is the link prompt title", () => {
    for (const dict of [ZH_HANT, EN]) {
      const reply = asCard(linkReply(dict, linkArgs()));

      expect(reply.name).toBe("link");
      expect(reply.message?.altText).toBe(dict.linkAltText);
      expect(reply.fallback).toEqual([buttons(dict)]);
      expect(lineMessageProblems(reply.message)).toEqual([]);
      expect(reply.message?.quickReply).toBeUndefined();
    }
  });

  test("with a lead, the altText is the lead and the fallback is the lead as text, then the buttons - today's reply, byte for byte", () => {
    for (const dict of [ZH_HANT, EN]) {
      const reply = asCard(linkReply(dict, linkArgs({ lead: dict.welcome, heading: dict.welcomeCardTitle })));

      expect(reply.message?.altText).toBe(dict.welcome);
      expect(reply.fallback).toEqual([{ type: "text", text: dict.welcome }, buttons(dict)]);
      expect(JSON.stringify(reply.message)).toContain(dict.welcomeCardTitle);
      expect(lineMessageProblems(reply.message)).toEqual([]);
    }
  });

  test("the heading defaults to 'link your account'", () => {
    const text = JSON.stringify(asCard(linkReply(ZH_HANT, linkArgs())).message);
    expect(text).toContain(ZH_HANT.linkCardTitle);
    expect(text).not.toContain(ZH_HANT.welcomeCardTitle);
  });

  test("the card and the fallback open the very same URL", () => {
    const reply = asCard(linkReply(ZH_HANT, linkArgs()));
    const cardUri = JSON.stringify(reply.message).match(/"uri":"([^"]+)"/)?.[1];
    expect(cardUri).toBe(URL);
    expect(JSON.stringify(reply.fallback)).toContain(URL);
  });

  // [MV]: send an http origin's banner and LINE is asked to fetch an image over a scheme it refuses.
  test("the banner is the versioned hero asset for an https origin, and absent for http", () => {
    const https = asCard(linkReply(ZH_HANT, linkArgs()));
    expect(https.message?.contents.hero).toMatchObject({ url: `${ORIGIN}/assets/line/link-hero-v1.jpg` });

    const http = asCard(linkReply(ZH_HANT, linkArgs({ appOrigin: "http://localhost:5173" })));
    expect(http.message?.contents.hero).toBeUndefined();
    expect(lineMessageProblems(http.message)).toEqual([]);
  });

  test("a card that cannot be built still gives the person their link, as today's messages", () => {
    faults.linkCard = true;

    const reply = linkReply(ZH_HANT, linkArgs({ lead: ZH_HANT.welcome }));

    expect(wireMessages([reply])).toEqual([{ type: "text", text: ZH_HANT.welcome }, buttons(ZH_HANT)]);
    expect(errorSpy.mock.calls).toEqual([["[line] card build failed (link): linkCard exploded"]]);
  });
});

describe("linkedReply", () => {
  test("the altText and the fallback are today's one-line text, with the masked address", () => {
    for (const dict of [ZH_HANT, EN]) {
      const reply = asCard(linkedReply(dict, { maskedEmail: "al***@example.com" }));
      const expected = fill(dict.linked, { email: "al***@example.com" });

      expect(reply.name).toBe("linked");
      expect(reply.message?.altText).toBe(expected);
      // No ledger id in an accountLink event: the shortcuts are the two commands, not the two links.
      expect(labelsOf(reply.message?.quickReply)).toEqual([dict.monthButtonLabel, dict.helpLabel]);
      expect(reply.fallback).toEqual([{ type: "text", text: expected, quickReply: reply.message?.quickReply }]);
      expect(lineMessageProblems(reply.message)).toEqual([]);
    }
  });

  test("a card that cannot be built is still a confirmation, as today's text", () => {
    faults.linkedCard = true;

    const [wire] = wireMessages([linkedReply(ZH_HANT, { maskedEmail: "al***@example.com" })]);

    expect(wire).toMatchObject({ type: "text", text: fill(ZH_HANT.linked, { email: "al***@example.com" }) });
    expect(labelsOf((wire as { quickReply?: LineQuickReply }).quickReply)).toEqual(["本月", "說明"]);
  });
});

// ---------------------------------------------------------------------------
// The quick-reply builders
// ---------------------------------------------------------------------------

describe("recordQuickReply", () => {
  test("is 復原 · 本月 · 明細 · 分析 in that order, in both languages", () => {
    expect(recordQuickReply(ZH_HANT, LINKS).items.map((item) => item.action)).toEqual([
      { type: "message", label: "復原", text: "復原" },
      { type: "message", label: "本月", text: "本月" },
      { type: "uri", label: "明細", uri: RECORDS },
      { type: "uri", label: "分析", uri: ANALYSIS },
    ]);
    expect(recordQuickReply(EN, LINKS).items.map((item) => item.action)).toEqual([
      { type: "message", label: "Undo", text: "undo" },
      { type: "message", label: "This month", text: "month" },
      { type: "uri", label: "Records", uri: RECORDS },
      { type: "uri", label: "Insights", uri: ANALYSIS },
    ]);
  });
});

describe("standardQuickReply", () => {
  const items = (qr: LineQuickReply | undefined) => (qr?.items ?? []).map((item) => item.action);

  // [MV]: reorder, drop or rename one and the table in the plan's §4.4 no longer holds.
  test("is 本月 · 明細 · 分析 · 說明, the two links pointing at records and analysis", () => {
    expect(items(standardQuickReply(ZH_HANT, LINKS))).toEqual([
      { type: "message", label: "本月", text: "本月" },
      { type: "uri", label: "明細", uri: RECORDS },
      { type: "uri", label: "分析", uri: ANALYSIS },
      { type: "message", label: "說明", text: "說明" },
    ]);
    expect(items(standardQuickReply(EN, LINKS))).toEqual([
      { type: "message", label: "This month", text: "month" },
      { type: "uri", label: "Records", uri: RECORDS },
      { type: "uri", label: "Insights", uri: ANALYSIS },
      { type: "message", label: "Help", text: "help" },
    ]);
  });

  test("leaves out what it is told to omit - the month card has no 本月, the help card no 說明", () => {
    expect(items(standardQuickReply(ZH_HANT, LINKS, ["month"])).map((action) => action.label)).toEqual(["明細", "分析", "說明"]);
    expect(items(standardQuickReply(ZH_HANT, LINKS, ["help"])).map((action) => action.label)).toEqual(["本月", "明細", "分析"]);
  });

  test("with no ledger the two links are left out, not pointed at nothing", () => {
    expect(items(standardQuickReply(ZH_HANT, null)).map((action) => action.label)).toEqual(["本月", "說明"]);
    expect(items(standardQuickReply(ZH_HANT, null, ["month"])).map((action) => action.label)).toEqual(["說明"]);
  });

  test("is undefined when nothing is left", () => {
    expect(standardQuickReply(ZH_HANT, null, ["month", "help"])).toBeUndefined();
  });

  test("every item is a valid quick reply item in both languages: at most 13, labels at most 20", () => {
    for (const dict of [ZH_HANT, EN]) {
      for (const qr of [standardQuickReply(dict, LINKS), recordQuickReply(dict, LINKS)]) {
        expect(lineMessageProblems({ type: "text", text: "x", quickReply: qr })).toEqual([]);
      }
    }
  });
});
