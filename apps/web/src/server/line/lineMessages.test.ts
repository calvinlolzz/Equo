import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_CATALOG } from "../../app/catalog.js";
import { fill } from "../push/pushText.js";
import { categoryDisplay } from "./lineCardTheme.js";
import { type LineFlexMessage, type LineMessage, type LineQuickReply, bubble, flexMessage, text, vbox } from "./lineFlex.js";
import { lineMessageProblems } from "./lineFlexValidator.js";
import {
  type LineCard,
  type LineOutgoing,
  budgetClearedReply,
  budgetReply,
  cardOrFallback,
  fallbackMessages,
  helpReply,
  isLineCard,
  linkReply,
  linkedReply,
  monthReply,
  recordedReply,
  textMessage,
  wireMessages,
} from "./lineMessages.js";
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
const LEDGER = `${ORIGIN}/group/ledger_1?openExternalBrowser=1`;

function asCard(reply: LineOutgoing): LineCard {
  expect(isLineCard(reply)).toBe(true);
  return reply as LineCard;
}

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
    ledgerId: "ledger_1",
    appOrigin: ORIGIN,
    ...overrides,
  });

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
    const reply = asCard(recordedReply(dict, recordArgs(locale, overrides)));

    expect(reply.name).toBe("record");
    expect(reply.message?.altText).toBe(expected);
    expect(reply.fallback).toHaveLength(1);
    expect(reply.fallback[0]).toMatchObject({ type: "text", text: expected });
    expect(lineMessageProblems(reply.message)).toEqual([]);
  });

  // [MV]: drop the quick reply from the card, or from the fallback, and this goes red.
  test("the undo, month and open-ledger quick replies sit under the card and under the fallback alike", () => {
    const reply = asCard(recordedReply(ZH_HANT, recordArgs("zh-Hant")));

    expect(labelsOf(reply.message?.quickReply)).toEqual(["復原", "本月", "開啟帳本"]);
    expect(reply.message?.quickReply?.items[0].action).toEqual({ type: "message", label: "復原", text: "復原" });
    expect(reply.message?.quickReply?.items[2].action).toEqual({ type: "uri", label: "開啟帳本", uri: LEDGER });
    expect((reply.fallback[0] as { quickReply?: LineQuickReply }).quickReply).toEqual(reply.message?.quickReply);
  });

  test("the card shows the date the entry was recorded under, in the dictionary's own format", () => {
    expect(JSON.stringify(asCard(recordedReply(ZH_HANT, recordArgs("zh-Hant"))).message)).toContain("9月21日");
    expect(JSON.stringify(asCard(recordedReply(EN, recordArgs("en"))).message)).toContain("9/21");
  });

  test("a date key that is not a date draws a dash instead of a broken date", () => {
    const reply = asCard(recordedReply(ZH_HANT, recordArgs("zh-Hant", { dateKey: "not a date" })));
    expect(lineMessageProblems(reply.message)).toEqual([]);
    expect(JSON.stringify(reply.message)).not.toContain("NaN");
  });

  // [MV]: remove the try/catch in cardOrFallback and a throwing builder takes the reply down with it.
  test("a card that cannot be built is still a reply: today's text, with the same quick replies", () => {
    faults.recordCard = true;

    const reply = asCard(recordedReply(ZH_HANT, recordArgs("zh-Hant")));
    const [wire] = wireMessages([reply]);

    expect(reply.message).toBeNull();
    expect(wire).toMatchObject({ type: "text", text: "已記下支出：早餐 $60（餐飲）\n本月支出 $6,060，預算剩 $8,940" });
    expect(labelsOf((wire as { quickReply?: LineQuickReply }).quickReply)).toEqual(["復原", "本月", "開啟帳本"]);
    expect(errorSpy.mock.calls).toEqual([["[line] card build failed (record): recordCard exploded"]]);
  });
});

describe("monthReply", () => {
  const monthArgs = (overrides: Partial<Parameters<typeof monthReply>[1]> = {}): Parameters<typeof monthReply>[1] => ({
    year: 2026,
    month: 9,
    currency: "TWD",
    budgetMinor: 1_500_000,
    month_totals: { expense_minor: 606_000, income_minor: 5_200_000 },
    ledgerId: "ledger_1",
    appOrigin: ORIGIN,
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

  test("the only quick reply is 開啟帳本, under the card and under the fallback", () => {
    const reply = asCard(monthReply(ZH_HANT, monthArgs()));
    expect(reply.message?.quickReply?.items).toEqual([
      { type: "action", action: { type: "uri", label: "開啟帳本", uri: LEDGER } },
    ]);
    expect((reply.fallback[0] as { quickReply?: LineQuickReply }).quickReply).toEqual(reply.message?.quickReply);
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

  test("a card that cannot be built is still a reply: today's text with 開啟帳本", () => {
    faults.monthCard = true;

    const reply = asCard(monthReply(ZH_HANT, monthArgs()));
    const [wire] = wireMessages([reply]);

    expect(reply.message).toBeNull();
    expect(wire).toMatchObject({ type: "text" });
    expect(labelsOf((wire as { quickReply?: LineQuickReply }).quickReply)).toEqual(["開啟帳本"]);
    expect(errorSpy.mock.calls).toEqual([["[line] card build failed (month): monthCard exploded"]]);
  });
});

describe("budgetReply", () => {
  const budgetArgs = (overrides: Partial<Parameters<typeof budgetReply>[1]> = {}): Parameters<typeof budgetReply>[1] => ({
    mode: "set",
    currency: "TWD",
    budgetMinor: 1_500_000,
    spentMinor: 600_000,
    ledgerId: "ledger_1",
    appOrigin: ORIGIN,
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

  test("quick replies are 本月 and 開啟帳本 - no 復原", () => {
    const reply = asCard(budgetReply(ZH_HANT, budgetArgs()));
    expect(labelsOf(reply.message?.quickReply)).toEqual(["本月", "開啟帳本"]);
  });

  // [MV]: a budget of 0 or none has nothing to draw; it stays the "how to set one" text.
  test.each([null, 0])("a budget of %s is the plain how-to-set-one text, not a card", (budgetMinor) => {
    const reply = budgetReply(ZH_HANT, budgetArgs({ budgetMinor }));

    expect(isLineCard(reply)).toBe(false);
    expect(reply).toMatchObject({ type: "text", text: ZH_HANT.budgetNone });
    expect(labelsOf((reply as { quickReply?: LineQuickReply }).quickReply)).toEqual(["本月", "開啟帳本"]);
  });

  test("a card that cannot be built is still a reply: today's text with the same quick replies", () => {
    faults.budgetCard = true;

    const [wire] = wireMessages([budgetReply(ZH_HANT, budgetArgs())]);

    expect(wire).toMatchObject({ type: "text", text: "每月預算已設為 $15,000。\n本月已花 $6,000，還剩 $9,000" });
    expect(labelsOf((wire as { quickReply?: LineQuickReply }).quickReply)).toEqual(["本月", "開啟帳本"]);
  });

  test("「取消預算」 stays a plain text message", () => {
    const reply = budgetClearedReply(ZH_HANT, { ledgerId: "ledger_1", appOrigin: ORIGIN });
    expect(isLineCard(reply)).toBe(false);
    expect(reply).toMatchObject({ type: "text", text: ZH_HANT.budgetCleared });
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
      expect(reply.fallback).toEqual([{ type: "text", text: expected }]);
      expect(lineMessageProblems(reply.message)).toEqual([]);
    }
  });

  test("a card that cannot be built is still a confirmation, as today's text", () => {
    faults.linkedCard = true;

    const [wire] = wireMessages([linkedReply(ZH_HANT, { maskedEmail: "al***@example.com" })]);

    expect(wire).toEqual({ type: "text", text: fill(ZH_HANT.linked, { email: "al***@example.com" }) });
  });
});
