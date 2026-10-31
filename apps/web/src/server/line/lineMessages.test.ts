import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fill } from "../push/pushText.js";
import { type LineFlexMessage, type LineMessage, type LineQuickReply, bubble, flexMessage, text, vbox } from "./lineFlex.js";
import { lineMessageProblems } from "./lineFlexValidator.js";
import {
  type LineCard,
  type LineOutgoing,
  cardOrFallback,
  fallbackMessages,
  helpReply,
  isLineCard,
  textMessage,
  wireMessages,
} from "./lineMessages.js";
import { LINE_TEXT_EN as EN, LINE_TEXT_ZH_HANT as ZH_HANT } from "./lineText.js";

// lineCards.ts is mocked only to be able to make a card builder throw on cue;
// everything else about it is the real module.
const faults = vi.hoisted(() => ({ helpCard: false }));
vi.mock("./lineCards.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lineCards.js")>();
  return {
    ...actual,
    helpCard: (...args: Parameters<typeof actual.helpCard>) => {
      if (faults.helpCard) throw new Error("helpCard exploded");
      return actual.helpCard(...args);
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
  faults.helpCard = false;
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
