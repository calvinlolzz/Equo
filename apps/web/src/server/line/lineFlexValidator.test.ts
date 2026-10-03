import { describe, expect, test } from "vitest";
import { bubble, flexMessage, hbox, heroImage, progressBar, separator, text, uriButton, vbox } from "./lineFlex.js";
import type { LineFlexMessage, LineMessage } from "./lineFlex.js";
import {
  actionsOf,
  assertValidFlexMessage,
  assertValidLineMessage,
  assertValidLineReply,
  lineMessageProblems,
  lineReplyProblems,
  plainTextOf,
  uriActionsOf,
} from "./lineFlexValidator.js";

const BG = "#12151F";
const INK = "#EEF1F6";
const HAIRLINE = "#262C3F";
const HERO_URL = "https://equo-mu.vercel.app/assets/line/link-hero-v1.jpg";
const LEDGER_URL = "https://equo-mu.vercel.app/group/g1?openExternalBrowser=1";

/**
 * A card that uses every component the validator knows. The body children are
 * numbered because the cases below break them by index:
 *   body.contents[0] title text   [1] separator   [2] row of two texts   [3] progress bar
 */
function validCard(): LineFlexMessage {
  return flexMessage(
    "the alt text of the card",
    bubble({
      hero: heroImage(HERO_URL, "2:1", BG),
      body: vbox(
        [
          text("title", { color: INK, size: "lg", weight: "bold", wrap: true, maxLines: 2 }),
          separator(HAIRLINE, "lg"),
          hbox([text("a", { color: INK, flex: 1 }), text("b", { color: INK, flex: 0, align: "end" })], { margin: "lg" }),
          progressBar(40, { fill: "#4DE3A6", track: HAIRLINE, height: 6, margin: "md" }),
        ],
        { paddingAll: "20px" },
      ),
      footer: vbox([uriButton("開啟帳本", LEDGER_URL, { color: "#0E8460" })], { paddingAll: "12px" }),
      background: BG,
      footerSeparator: HAIRLINE,
    }),
    {
      items: [
        { type: "action", action: { type: "message", label: "復原", text: "復原" } },
        { type: "action", action: { type: "uri", label: "開啟帳本", uri: LEDGER_URL } },
      ],
    },
  );
}

/** The link fallback: a buttons template. */
function validTemplate(): LineMessage {
  return {
    type: "template",
    altText: "連結 Equo 帳號",
    template: { type: "buttons", text: "先連結你的 Equo 帳號才能開始記帳。", actions: [{ type: "uri", label: "連結 Equo 帳號", uri: LEDGER_URL }] },
  };
}

// The cases below deliberately break a message in ways its types forbid, so they work on a loose copy.
type Loose = any;

function problemsAfter(edit: (card: Loose) => void, base: unknown = validCard()): string[] {
  const card: Loose = structuredClone(base);
  edit(card);
  return lineMessageProblems(card);
}

type Case = [name: string, edit: (card: Loose) => void, expected: RegExp];

/** Every case must be reported, and by the rule it is named for - not merely by some other one. */
function expectReported(cases: Case[]): void {
  test.each(cases)("%s", (_name, edit, expected) => {
    const problems = problemsAfter(edit);
    expect(problems.length, "nothing was reported").toBeGreaterThan(0);
    expect(
      problems.some((problem) => expected.test(problem)),
      `no problem matched ${expected}; got:\n${problems.join("\n")}`,
    ).toBe(true);
  });
}

describe("the valid cards", () => {
  test("a card using every component, with a quick reply, has no problems", () => {
    expect(lineMessageProblems(validCard())).toEqual([]);
  });

  test("so does the link template, a text message and a reply made of them", () => {
    expect(lineMessageProblems(validTemplate())).toEqual([]);
    expect(lineMessageProblems({ type: "text", text: "hi" })).toEqual([]);
    expect(lineReplyProblems([{ type: "text", text: "hi" }, validCard(), validTemplate()])).toEqual([]);
  });

  test("an emoji (a valid surrogate pair) is not a lone surrogate", () => {
    expect(problemsAfter((c) => (c.contents.body.contents[0].text = "\u{1F371} lunch"))).toEqual([]);
  });

  test("every bubble size LINE draws everywhere is accepted", () => {
    for (const size of ["nano", "micro", "kilo", "mega", "giga"]) {
      expect(problemsAfter((c) => (c.contents.size = size)), size).toEqual([]);
    }
  });

  test("an empty box is fine when it has a height or a flex (a track, a colour strip)", () => {
    expect(problemsAfter((c) => c.contents.body.contents.push({ type: "box", layout: "vertical", spacing: "none", contents: [], height: "4px" }))).toEqual([]);
    expect(problemsAfter((c) => c.contents.body.contents.push({ type: "box", layout: "vertical", spacing: "none", contents: [], flex: 1 }))).toEqual([]);
  });

  test("boxes may be sized in whole pixels or whole percent from 1 to 100", () => {
    for (const width of ["1px", "100px", "999px", "1%", "50%", "100%"]) {
      expect(problemsAfter((c) => (c.contents.body.contents[2].width = width)), width).toEqual([]);
    }
  });
});

describe("a reply", () => {
  test("holds 1 to 5 messages", () => {
    const message = { type: "text", text: "hi" };
    expect(lineReplyProblems([])).toEqual([expect.stringMatching(/1-5 messages/)]);
    expect(lineReplyProblems(Array.from({ length: 6 }, () => message))).toEqual([expect.stringMatching(/1-5 messages/)]);
    expect(lineReplyProblems(Array.from({ length: 5 }, () => message))).toEqual([]);
    expect(lineReplyProblems([message])).toEqual([]);
  });

  test("is an array", () => {
    expect(lineReplyProblems({ type: "text", text: "hi" })).toEqual([expect.stringMatching(/must be an array/)]);
    expect(lineReplyProblems(undefined)).toEqual([expect.stringMatching(/must be an array/)]);
  });

  test("names the message that is wrong", () => {
    const problems = lineReplyProblems([{ type: "text", text: "ok" }, { type: "text", text: "" }]);
    expect(problems).toEqual([expect.stringContaining("messages[1].text")]);
  });

  // [MV]: this is the guard against a LineCard wrapper reaching the client.
  test("refuses anything that is not a text, flex or template message - including a card wrapper", () => {
    const wrapper = { kind: "card", name: "record", message: validCard(), fallback: [] };
    for (const bad of [wrapper, { type: "image" }, { type: "sticker" }, null, "hi", 7]) {
      expect(lineReplyProblems([bad]).length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
  });
});

describe("text and template messages", () => {
  const textMessage = (value: unknown, extra: object = {}) => ({ type: "text", text: value, ...extra });

  test("a text message is 1 to 5000 UTF-16 units", () => {
    expect(lineMessageProblems(textMessage("a".repeat(5000)))).toEqual([]);
    expect(lineMessageProblems(textMessage(""))).toEqual([expect.stringMatching(/text.*1-5000/)]);
    expect(lineMessageProblems(textMessage("a".repeat(5001)))).toEqual([expect.stringMatching(/text.*1-5000/)]);
    expect(lineMessageProblems(textMessage(5))).toEqual([expect.stringMatching(/text.*must be a string/)]);
  });

  test("a text message with a typo'd or unsupported key is refused", () => {
    expect(lineMessageProblems(textMessage("hi", { quickReplies: [] }))).toEqual([expect.stringMatching(/quickReplies.*not a known property/)]);
  });

  // [MV]: flag an undefined-valued key and every kit-built message with an unset option fails.
  test("a key whose value is undefined is not a property: JSON.stringify drops it", () => {
    expect(lineMessageProblems({ type: "text", text: "hi", quickReply: undefined })).toEqual([]);
  });

  test("a text message with a lone surrogate is refused, one with an emoji is not", () => {
    expect(lineMessageProblems(textMessage("a\uD83D"))).toEqual([expect.stringMatching(/lone surrogate/)]);
    expect(lineMessageProblems(textMessage("\uDC71"))).toEqual([expect.stringMatching(/lone surrogate/)]);
    expect(lineMessageProblems(textMessage("\u{1F371}"))).toEqual([]);
  });

  const templateCases: Case[] = [
    ["a template that is not buttons", (m) => (m.template.type = "carousel"), /only a "buttons" template/],
    ["template text of 161 units", (m) => (m.template.text = "a".repeat(161)), /template\.text.*1-160/],
    ["empty template text", (m) => (m.template.text = ""), /template\.text.*1-160/],
    ["no template actions", (m) => (m.template.actions = []), /actions.*1-4/],
    ["five template actions", (m) => (m.template.actions = Array.from({ length: 5 }, () => m.template.actions[0])), /actions.*1-4/],
    ["a message action in a template", (m) => (m.template.actions = [{ type: "message", label: "x", text: "復原" }]), /message action is not allowed in a template/],
    ["an empty altText on a template", (m) => (m.altText = ""), /altText.*1-400/],
    ["a 401-unit altText on a template", (m) => (m.altText = "a".repeat(401)), /altText.*1-400/],
    ["an unknown template key", (m) => (m.template.title = "x"), /title.*not a known property/],
    ["an unknown key on the template message", (m) => (m.sender = {}), /sender.*not a known property/],
  ];

  test.each(templateCases)("%s", (_name, edit, expected) => {
    const problems = problemsAfter(edit, validTemplate());
    expect(problems.some((problem) => expected.test(problem)), problems.join("\n")).toBe(true);
  });
});

describe("the flex message itself", () => {
  expectReported([
    ["an empty altText", (c) => (c.altText = ""), /altText.*1-400/],
    ["an altText of 401 units", (c) => (c.altText = "a".repeat(401)), /altText.*1-400/],
    ["a missing altText", (c) => delete c.altText, /altText.*must be a string/],
    ["an altText that is not a string", (c) => (c.altText = 7), /altText.*must be a string/],
    ["a typo'd top-level key", (c) => (c.altTxt = "x"), /altTxt.*not a known property/],
    ["an unknown message type", (c) => (c.type = "imagemap"), /must be "text", "flex" or "template"/],
  ]);

  test("an altText of exactly 400 units is fine", () => {
    expect(problemsAfter((c) => (c.altText = "a".repeat(400)))).toEqual([]);
  });

  expectReported([
    ["a lone high surrogate in the altText", (c) => (c.altText = "ab\uD83D"), /altText.*lone surrogate/],
    ["a lone low surrogate in a nested text", (c) => (c.contents.body.contents[0].text = "\uDC71x"), /contents\.body.*lone surrogate/],
    ["a lone surrogate in a quick reply label", (c) => (c.quickReply.items[0].action.label = "x\uD83D"), /quickReply.*lone surrogate/],
    ["a lone surrogate in a key", (c) => (c.contents.body.contents[0]["\uD83D"] = 1), /lone surrogate/],
  ]);
});

describe("the bubble", () => {
  expectReported([
    ["a carousel", (c) => (c.contents.type = "carousel"), /carousel/],
    ["a bubble with no type", (c) => delete c.contents.type, /type.*must be "bubble"/],
    ["size deca", (c) => (c.contents.size = "deca"), /size.*deca.*forbidden/],
    ["size hecto", (c) => (c.contents.size = "hecto"), /size.*hecto.*forbidden/],
    ["an unknown size", (c) => (c.contents.size = "huge"), /size.*one of nano\|micro\|kilo\|mega\|giga/],
    ["a direction", (c) => (c.contents.direction = "rtl"), /direction.*not a known property/],
    ["a header block", (c) => (c.contents.header = c.contents.footer), /header.*not a known property/],
    ["a hero that is a box", (c) => (c.contents.hero = c.contents.body), /hero.*must be an image/],
    ["a hero that is text", (c) => (c.contents.hero = c.contents.body.contents[0]), /hero.*must be an image/],
    ["a body that is text", (c) => (c.contents.body = c.contents.body.contents[0]), /body.*must be a box/],
    ["a missing body", (c) => delete c.contents.body, /body.*must be a box/],
    ["a footer that is an image", (c) => (c.contents.footer = c.contents.hero), /footer.*must be a box/],
    ["a body with no paddingAll", (c) => delete c.contents.body.paddingAll, /body\.paddingAll.*required/],
    ["a footer with no paddingAll", (c) => delete c.contents.footer.paddingAll, /footer\.paddingAll.*required/],
  ]);

  // [MV]: LINE's default block background differs between clients, so each block must carry its own.
  expectReported([
    ["no styles at all", (c) => delete c.contents.styles, /styles.*required/],
    ["no style for the body", (c) => delete c.contents.styles.body, /styles\.body.*missing/],
    ["no style for the hero", (c) => delete c.contents.styles.hero, /styles\.hero.*missing/],
    ["no style for the footer", (c) => delete c.contents.styles.footer, /styles\.footer.*missing/],
    ["a body style with no backgroundColor", (c) => delete c.contents.styles.body.backgroundColor, /styles\.body\.backgroundColor.*required/],
    ["a footer style with a bad backgroundColor", (c) => (c.contents.styles.footer.backgroundColor = "dark"), /styles\.footer\.backgroundColor.*#RRGGBB/],
    ["a style for a block that is not there", (c) => delete c.contents.hero, /styles\.hero.*not there/],
    ["a style for a header", (c) => (c.contents.styles.header = { backgroundColor: BG }), /styles\.header.*not a known property/],
    ["an unknown key in a block style", (c) => (c.contents.styles.body.border = true), /border.*not a known property/],
    ["a separator that is not a boolean", (c) => (c.contents.styles.footer.separator = "yes"), /separator.*boolean/],
    ["a separatorColor that is not a colour", (c) => (c.contents.styles.footer.separatorColor = "grey"), /separatorColor.*#RRGGBB/],
  ]);

  // [MV]: LINE refuses a bubble over 30 KB of JSON.
  test("a bubble over 30,000 bytes of JSON is refused, one just under is not", () => {
    const filler = () => ({ type: "text", text: "x".repeat(60), color: INK });
    const problems = problemsAfter((c) => c.contents.body.contents.push(...Array.from({ length: 500 }, filler)));
    expect(problems).toEqual([expect.stringMatching(/bytes of JSON; LINE accepts at most 30000/)]);

    // Just under: measured from the card itself so the margin does not depend on how big it happens to be.
    // The text node around the filler adds 44 bytes of JSON, so leave 60.
    const base = new TextEncoder().encode(JSON.stringify(validCard().contents)).length;
    const room = 30_000 - base - 60;
    expect(problemsAfter((c) => c.contents.body.contents.push({ type: "text", text: "x".repeat(room), color: INK }))).toEqual([]);
  });

  test("counts bytes, not characters: CJK text is three bytes a character", () => {
    const problems = problemsAfter((c) => c.contents.body.contents.push({ type: "text", text: "測".repeat(9_900), color: INK }));
    expect(problems).toEqual([expect.stringMatching(/bytes of JSON/)]);
  });
});

describe("colours", () => {
  // [MV]: accept anything and "red" or #RGB reaches LINE, which rejects the whole card.
  expectReported([
    ["a named colour on a text", (c) => (c.contents.body.contents[0].color = "red"), /color.*#RRGGBB/],
    ["a 5-digit colour", (c) => (c.contents.body.contents[0].color = "#12345"), /color.*#RRGGBB/],
    ["an 8-digit (alpha) colour", (c) => (c.contents.body.contents[0].color = "#12345678"), /color.*#RRGGBB/],
    ["a 3-digit colour", (c) => (c.contents.body.contents[0].color = "#abc"), /color.*#RRGGBB/],
    ["a colour with no hash", (c) => (c.contents.body.contents[0].color = "EEF1F6"), /color.*#RRGGBB/],
    ["a bad box backgroundColor", (c) => (c.contents.body.contents[3].backgroundColor = "grey"), /backgroundColor.*#RRGGBB/],
    ["a bad separator colour", (c) => (c.contents.body.contents[1].color = "#GGGGGG"), /color.*#RRGGBB/],
    ["a bad button colour", (c) => (c.contents.footer.contents[0].color = "green"), /color.*#RRGGBB/],
    ["a bad image backgroundColor", (c) => (c.contents.hero.backgroundColor = "dark"), /backgroundColor.*#RRGGBB/],
  ]);

  test("upper and lower case hex are both fine", () => {
    expect(problemsAfter((c) => (c.contents.body.contents[0].color = "#eef1f6"))).toEqual([]);
  });
});

describe("a text node", () => {
  // [MV]: let a blank text through and an empty label reaches LINE as an empty node.
  expectReported([
    ["an empty text", (c) => (c.contents.body.contents[0].text = ""), /text.*non-blank/],
    ["a whitespace-only text", (c) => (c.contents.body.contents[0].text = " \n\t "), /text.*non-blank/],
    ["a text that is not a string", (c) => (c.contents.body.contents[0].text = 60), /text.*non-blank/],
    ["a missing text", (c) => delete c.contents.body.contents[0].text, /text.*non-blank/],
    ["no colour (LINE's default differs between clients)", (c) => delete c.contents.body.contents[0].color, /color.*required/],
    ["a size that is not a keyword", (c) => (c.contents.body.contents[0].size = "huge"), /size.*one of xxs\|xs/],
    ["a size in pixels", (c) => (c.contents.body.contents[0].size = "12px"), /size.*one of xxs\|xs/],
    ["maxLines 0", (c) => (c.contents.body.contents[0].maxLines = 0), /maxLines.*integer >= 1/],
    ["maxLines 1.5", (c) => (c.contents.body.contents[0].maxLines = 1.5), /maxLines.*integer >= 1/],
    ["maxLines as a string", (c) => (c.contents.body.contents[0].maxLines = "2"), /maxLines.*integer >= 1/],
    ["an unknown weight", (c) => (c.contents.body.contents[0].weight = "bolder"), /weight.*regular\|bold/],
    ["an unknown align", (c) => (c.contents.body.contents[0].align = "left"), /align.*start\|end\|center/],
    ["wrap as a string", (c) => (c.contents.body.contents[0].wrap = "yes"), /wrap.*boolean/],
    ["a negative flex", (c) => (c.contents.body.contents[0].flex = -1), /flex.*integer >= 0/],
    ["a fractional flex", (c) => (c.contents.body.contents[0].flex = 1.5), /flex.*integer >= 0/],
    ["a margin that is not a length", (c) => (c.contents.body.contents[0].margin = "big"), /margin.*spacing keyword/],
    ["spans", (c) => (c.contents.body.contents[0].contents = [{ type: "span", text: "x" }]), /contents.*spans are forbidden/],
    ["a typo'd key", (c) => (c.contents.body.contents[0].colour = INK), /colour.*not a known property/],
  ]);

  test("every size keyword is accepted", () => {
    for (const size of ["xxs", "xs", "sm", "md", "lg", "xl", "xxl", "3xl", "4xl", "5xl"]) {
      expect(problemsAfter((c) => (c.contents.body.contents[0].size = size)), size).toEqual([]);
    }
  });
});

describe("a separator", () => {
  expectReported([
    ["no colour", (c) => delete c.contents.body.contents[1].color, /color.*required/],
    ["a bad margin", (c) => (c.contents.body.contents[1].margin = "12"), /margin.*spacing keyword/],
    ["a typo'd key", (c) => (c.contents.body.contents[1].colour = HAIRLINE), /colour.*not a known property/],
  ]);
});

describe("a box", () => {
  const row = (c: Loose) => c.contents.body.contents[2];

  expectReported([
    ["layout baseline", (c) => (row(c).layout = "baseline"), /layout.*horizontal\|vertical/],
    ["no layout", (c) => delete row(c).layout, /layout.*horizontal\|vertical/],
    // [MV]: the validator is what stops a box silently inheriting LINE's client-dependent spacing.
    ["no spacing", (c) => delete row(c).spacing, /spacing.*required/],
    ["a spacing keyword that does not exist", (c) => (row(c).spacing = "big"), /spacing.*spacing keyword/],
    ["a spacing with no unit", (c) => (row(c).spacing = "12"), /spacing.*spacing keyword/],
    ["a four-digit pixel spacing", (c) => (row(c).spacing = "1000px"), /spacing.*spacing keyword/],
    ["a fractional pixel spacing", (c) => (row(c).spacing = "12.5px"), /spacing.*spacing keyword/],
    ["a negative padding", (c) => (c.contents.body.paddingAll = "-5px"), /paddingAll.*spacing keyword/],
    ["a bad paddingTop", (c) => (row(c).paddingTop = "big"), /paddingTop.*spacing keyword/],
    ["a bad paddingStart", (c) => (row(c).paddingStart = "5"), /paddingStart.*spacing keyword/],
    ["a percent cornerRadius", (c) => (c.contents.body.contents[3].cornerRadius = "50%"), /cornerRadius.*spacing keyword/],
    ["a bad margin", (c) => (row(c).margin = "huge"), /margin.*spacing keyword/],
    ["a 0% width (not a length LINE accepts)", (c) => (row(c).width = "0%"), /width.*whole pixels or a whole percent/],
    ["a 101% width", (c) => (row(c).width = "101%"), /width.*whole pixels or a whole percent/],
    ["a fractional percent width", (c) => (row(c).width = "50.5%"), /width.*whole pixels or a whole percent/],
    ["a width with no unit", (c) => (row(c).width = "12"), /width.*whole pixels or a whole percent/],
    ["a four-digit pixel width", (c) => (row(c).width = "1000px"), /width.*whole pixels or a whole percent/],
    ["a percent height", (c) => (c.contents.body.contents[3].height = "50%"), /height.*whole pixels/],
    ["a height with no unit", (c) => (c.contents.body.contents[3].height = "6"), /height.*whole pixels/],
    ["a negative flex", (c) => (row(c).flex = -1), /flex.*integer >= 0/],
    ["a fractional flex", (c) => (row(c).flex = 1.5), /flex.*integer >= 0/],
    ["alignItems stretch", (c) => (row(c).alignItems = "stretch"), /alignItems.*center\|flex-start\|flex-end/],
    ["justifyContent baseline", (c) => (row(c).justifyContent = "baseline"), /justifyContent.*one of/],
    ["contents that is not an array", (c) => (row(c).contents = "x"), /contents.*must be an array/],
    ["a typo'd key", (c) => (row(c).paddingAl = "5px"), /paddingAl.*not a known property/],
  ]);

  // [MV]: an empty box with no size collapses to nothing - the track of a bar would vanish.
  expectReported([
    ["empty contents with neither height nor flex", (c) => (row(c).contents = []), /contents.*neither a height nor a flex/],
    [
      "an empty bar track that lost its height",
      (c) => {
        c.contents.body.contents[3].contents = [];
        delete c.contents.body.contents[3].height;
      },
      /neither a height nor a flex/,
    ],
  ]);

  expectReported([
    ["a component of an unknown type", (c) => row(c).contents.push({ type: "carousel" }), /type.*not a known component type/],
    ["a component with no type", (c) => row(c).contents.push({ text: "x" }), /type.*not a known component type/],
    ["a child that is not an object", (c) => row(c).contents.push("x"), /must be an object/],
    ["a nested child that is wrong", (c) => (row(c).contents[0].color = "red"), /contents\[2\]\.contents\[0\]\.color/],
  ]);
});

describe("an image", () => {
  const hero = (c: Loose) => c.contents.hero;

  expectReported([
    ["an http url", (c) => (hero(c).url = "http://equo-mu.vercel.app/h.jpg"), /url.*must be https/],
    ["a url over 2000 characters", (c) => (hero(c).url = `https://equo-mu.vercel.app/${"a".repeat(2000)}.jpg`), /url.*1-2000/],
    ["a gif", (c) => (hero(c).url = "https://equo-mu.vercel.app/h.gif"), /url.*\.jpg, \.jpeg or \.png/],
    ["a webp", (c) => (hero(c).url = "https://equo-mu.vercel.app/h.webp"), /url.*\.jpg, \.jpeg or \.png/],
    ["a url that is not absolute", (c) => (hero(c).url = "/assets/line/link-hero-v1.jpg"), /url.*not a URL/],
    ["a missing url", (c) => delete hero(c).url, /url.*must be a string/],
    ["an aspectRatio with the wrong separator", (c) => (hero(c).aspectRatio = "2-1"), /aspectRatio.*must look like/],
    ["an aspectRatio taller than 3x its width", (c) => (hero(c).aspectRatio = "1:4"), /aspectRatio.*at most 3x/],
    ["an aspectRatio with a zero width", (c) => (hero(c).aspectRatio = "0:1"), /aspectRatio.*at least 1/],
    ["an aspectRatio with a zero height", (c) => (hero(c).aspectRatio = "1:0"), /aspectRatio.*at least 1/],
    ["a size that is not a keyword", (c) => (hero(c).size = "huge"), /size.*one of/],
    ["an unknown aspectMode", (c) => (hero(c).aspectMode = "stretch"), /aspectMode.*fit\|cover/],
    ["a typo'd key", (c) => (hero(c).urls = []), /urls.*not a known property/],
  ]);

  test("png and jpeg urls, an aspect ratio of exactly 3x, and any case of extension are accepted", () => {
    for (const url of ["https://x.test/a.png", "https://x.test/a.jpeg", "https://x.test/a.JPG", "https://x.test/a.jpg?v=2"]) {
      expect(problemsAfter((c) => (hero(c).url = url)), url).toEqual([]);
    }
    expect(problemsAfter((c) => (hero(c).aspectRatio = "1:3"))).toEqual([]);
    expect(problemsAfter((c) => (hero(c).size = "full"))).toEqual([]);
  });
});

describe("actions", () => {
  const button = (c: Loose) => c.contents.footer.contents[0];

  // [MV]: this is what keeps 復原 - or any write - out of reach of a stray tap on a card.
  expectReported([
    ["a message action on a card button", (c) => (button(c).action = { type: "message", label: "復原", text: "復原" }), /message action is not allowed in a card/],
    ["a postback action", (c) => (button(c).action = { type: "postback", label: "x", data: "a=b" }), /unsupported action type "postback"/],
    ["a button with no action", (c) => delete button(c).action, /action.*must be an action object/],
    ["an empty label", (c) => (button(c).action.label = ""), /label.*1-20/],
    ["a 21-unit label", (c) => (button(c).action.label = "a".repeat(21)), /label.*1-20/],
    ["an empty uri", (c) => (button(c).action.uri = ""), /uri.*1-1000/],
    ["a 1001-character uri", (c) => (button(c).action.uri = `https://equo-mu.vercel.app/${"a".repeat(1001)}`), /uri.*1-1000/],
    ["a uri with an unsupported scheme", (c) => (button(c).action.uri = "ftp://example.com/a"), /uri.*http:, https:, line: or tel:/],
    ["a javascript: uri", (c) => (button(c).action.uri = "javascript:alert(1)"), /uri.*http:, https:, line: or tel:/],
    ["a typo'd action key", (c) => (button(c).action.url = "https://x.test"), /url.*not a known property/],
    ["a bad button style", (c) => (button(c).style = "ghost"), /style.*primary\|secondary\|link/],
    ["a bad button height", (c) => (button(c).height = "lg"), /height.*sm\|md/],
  ]);

  test("a 20-unit label, a 1000-character uri and the line:/tel:/http: schemes are accepted", () => {
    expect(problemsAfter((c) => (button(c).action.label = "a".repeat(20)))).toEqual([]);
    expect(problemsAfter((c) => (button(c).action.uri = `https://x.test/${"a".repeat(985)}`))).toEqual([]);
    for (const uri of ["http://x.test/a", "line://nv/chat", "tel:0212345678"]) {
      expect(problemsAfter((c) => (button(c).action.uri = uri)), uri).toEqual([]);
    }
  });
});

describe("a quick reply", () => {
  const first = (c: Loose) => c.quickReply.items[0];

  expectReported([
    ["no items", (c) => (c.quickReply.items = []), /items.*1-13/],
    ["14 items", (c) => (c.quickReply.items = Array.from({ length: 14 }, () => first(c))), /items.*1-13/],
    ["a quickReply that is not an object", (c) => (c.quickReply = []), /quickReply.*must be an object/],
    ["a typo'd key on the quickReply", (c) => (c.quickReply.item = []), /item.*not a known property/],
    ["an item of another type", (c) => (first(c).type = "button"), /items\[0\]\.type.*"action"/],
    ["an item with an imageUrl", (c) => (first(c).imageUrl = "https://x.test/i.png"), /imageUrl.*not a known property/],
    ["a message action with empty text", (c) => (first(c).action.text = ""), /text.*1-300/],
    ["a message action with 301 characters", (c) => (first(c).action.text = "a".repeat(301)), /text.*1-300/],
    ["a message action label over 20", (c) => (first(c).action.label = "a".repeat(21)), /label.*1-20/],
    ["a typo'd key on a message action", (c) => (first(c).action.txt = "x"), /txt.*not a known property/],
    ["a postback in a quick reply", (c) => (first(c).action = { type: "postback", label: "x", data: "a" }), /unsupported action type "postback"/],
  ]);

  test("13 items is the limit", () => {
    expect(problemsAfter((c) => (c.quickReply.items = Array.from({ length: 13 }, () => first(c))))).toEqual([]);
  });

  test("a quick reply may hold a message action (that is where 復原 lives) and a uri action", () => {
    expect(lineMessageProblems(validCard())).toEqual([]);
    expect(validCard().quickReply?.items.map((item) => item.action.type)).toEqual(["message", "uri"]);
  });
});

describe("forbidden features", () => {
  const body = (c: Loose) => c.contents.body;

  // [MV]: each of these is something the cards deliberately do without; the validator is what keeps it that way.
  expectReported([
    ["a filler", (c) => body(c).contents.push({ type: "filler" }), /"filler" is forbidden/],
    ["a span", (c) => body(c).contents.push({ type: "span", text: "x" }), /"span" is forbidden/],
    ["an icon", (c) => body(c).contents.push({ type: "icon", url: "https://x.test/i.png" }), /"icon" is forbidden/],
    ["a video", (c) => body(c).contents.push({ type: "video" }), /"video" is forbidden/],
    ["a linear-gradient background", (c) => (body(c).background = { type: "linearGradient" }), /background.*forbidden property/],
    ["absolute positioning", (c) => (body(c).position = "absolute"), /position.*forbidden property/],
    ["offsetTop", (c) => (body(c).offsetTop = "4px"), /offsetTop.*forbidden property/],
    ["offsetBottom", (c) => (body(c).offsetBottom = "4px"), /offsetBottom.*forbidden property/],
    ["offsetStart", (c) => (body(c).offsetStart = "4px"), /offsetStart.*forbidden property/],
    ["offsetEnd", (c) => (body(c).offsetEnd = "4px"), /offsetEnd.*forbidden property/],
    ["a text position", (c) => (body(c).contents[0].position = "absolute"), /position.*forbidden property/],
    ["adjustMode", (c) => (body(c).contents[0].adjustMode = "shrink-to-fit"), /adjustMode.*forbidden property/],
    ["scaling", (c) => (body(c).contents[0].scaling = true), /scaling.*forbidden property/],
    ["lineSpacing", (c) => (body(c).contents[0].lineSpacing = "4px"), /lineSpacing.*forbidden property/],
    ["an animated image", (c) => (c.contents.hero.animated = true), /animated.*forbidden property/],
    ["a button scaling", (c) => (c.contents.footer.contents[0].scaling = true), /scaling.*forbidden property/],
  ]);
});

describe("the assert helpers", () => {
  test("assertValidLineMessage passes a good message and throws every problem of a bad one", () => {
    expect(() => assertValidLineMessage(validCard())).not.toThrow();

    const bad: Loose = structuredClone(validCard());
    bad.altText = "";
    bad.contents.body.contents[0].color = "red";
    expect(() => assertValidLineMessage(bad)).toThrow(/altText[^]*color/);
  });

  test("assertValidFlexMessage also insists on a flex message", () => {
    expect(() => assertValidFlexMessage(validCard())).not.toThrow();
    expect(() => assertValidFlexMessage({ type: "text", text: "hi" })).toThrow(/Expected a flex message, got a text message/);
    expect(() => assertValidFlexMessage(validTemplate())).toThrow(/Expected a flex message, got a template message/);
    expect(() => assertValidFlexMessage({ type: "flex" })).toThrow(/not valid for LINE/);
  });

  test("assertValidLineReply checks the count and each message", () => {
    expect(() => assertValidLineReply([validCard(), validTemplate()])).not.toThrow();
    expect(() => assertValidLineReply([])).toThrow(/1-5 messages/);
    expect(() => assertValidLineReply([{ type: "text", text: "" }])).toThrow(/messages\[0\]\.text/);
  });

  test("they narrow the type, so a test can use the message without a cast", () => {
    const message: unknown = validCard();
    assertValidFlexMessage(message);
    expect(message.contents.type).toBe("bubble");
  });
});

describe("plainTextOf, actionsOf and uriActionsOf", () => {
  test("plainTextOf is a text message's text and a card's or template's altText", () => {
    expect(plainTextOf({ type: "text", text: "hello" })).toBe("hello");
    expect(plainTextOf(validCard())).toBe("the alt text of the card");
    expect(plainTextOf(validTemplate())).toBe("連結 Equo 帳號");
  });

  test("actionsOf finds the card's button action and leaves the quick reply out", () => {
    expect(actionsOf(validCard())).toEqual([{ type: "uri", label: "開啟帳本", uri: LEDGER_URL }]);
  });

  // [MV]: if the quick reply leaked in, "no card action may write" would trip over 復原.
  test("so a message action in the quick reply is not an action of the card", () => {
    expect(actionsOf(validCard()).some((action) => action.type === "message")).toBe(false);
    expect(validCard().quickReply?.items.some((item) => item.action.type === "message")).toBe(true);
  });

  test("actionsOf finds actions on any node, however deep, and on a template", () => {
    const card: Loose = structuredClone(validCard());
    card.contents.body.contents[2].contents[0].action = { type: "message", label: "x", text: "復原" };
    card.contents.body.action = { type: "uri", label: "y", uri: "https://x.test/y" };
    expect(actionsOf(card).map((action) => action.label).sort()).toEqual(["x", "y", "開啟帳本"]);
    expect(actionsOf(validTemplate())).toEqual([{ type: "uri", label: "連結 Equo 帳號", uri: LEDGER_URL }]);
  });

  test("actionsOf is empty for a text message", () => {
    expect(actionsOf({ type: "text", text: "hi" })).toEqual([]);
  });

  test("uriActionsOf keeps only the uri actions", () => {
    const card: Loose = structuredClone(validCard());
    card.contents.body.contents[0].action = { type: "message", label: "x", text: "復原" };
    expect(uriActionsOf(card)).toEqual([{ type: "uri", label: "開啟帳本", uri: LEDGER_URL }]);
    expect(uriActionsOf(validTemplate())).toHaveLength(1);
  });
});
