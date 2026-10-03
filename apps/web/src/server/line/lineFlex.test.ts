import { describe, expect, test } from "vitest";
import {
  bubble,
  clampLabel,
  flexMessage,
  hbox,
  heroImage,
  lineAltText,
  progressBar,
  separator,
  text,
  uriButton,
  vbox,
} from "./lineFlex.js";
import { assertValidFlexMessage } from "./lineFlexValidator.js";

const EMOJI = "\u{1F371}"; // one code point, two UTF-16 units

/** encodeURIComponent throws on a lone surrogate, so this is "the string is well formed" without leaning on a newer engine. */
function isWellFormed(value: string): boolean {
  try {
    encodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}

describe("lineAltText", () => {
  test("leaves anything up to 400 UTF-16 units alone", () => {
    expect(lineAltText("a".repeat(400))).toBe("a".repeat(400));
    // 398 + a two-unit emoji is exactly 400: it fits and must not be touched.
    expect(lineAltText("a".repeat(398) + EMOJI)).toBe("a".repeat(398) + EMOJI);
    expect(lineAltText("已記下支出：早餐 $60")).toBe("已記下支出：早餐 $60");
  });

  // [MV]: drop the truncation, or change either 400/399 and this goes red.
  test("cuts 401 units to 399 and an ellipsis, 400 in all", () => {
    const cut = lineAltText("a".repeat(401));
    expect(cut).toBe(`${"a".repeat(399)}…`);
    expect(cut).toHaveLength(400);
  });

  // [MV]: slice by index instead of by code point and the emoji is split in half.
  test("never leaves half an emoji at the cut", () => {
    const cut = lineAltText(`${"a".repeat(399)}${EMOJI}`);
    expect(cut).toBe(`${"a".repeat(399)}…`);
    expect(isWellFormed(cut)).toBe(true);
  });

  test("300 emoji come back as 199 and an ellipsis: whole emoji only, 399 units", () => {
    const cut = lineAltText(EMOJI.repeat(300));
    expect(cut).toBe(`${EMOJI.repeat(199)}…`);
    expect(cut.length).toBeLessThanOrEqual(400);
    expect(isWellFormed(cut)).toBe(true);
  });

  // [MV]: measure in code points instead of UTF-16 units and 250 emoji (500 units) slips through uncut.
  test("counts UTF-16 units, so an emoji costs two", () => {
    expect(lineAltText(EMOJI.repeat(250)).length).toBeLessThanOrEqual(400);
    expect(lineAltText(EMOJI.repeat(250))).not.toBe(EMOJI.repeat(250));
  });

  test("a blank altText becomes a dash instead of reaching LINE empty", () => {
    expect(lineAltText("")).toBe("—");
    expect(lineAltText("   ")).toBe("—");
  });
});

describe("clampLabel", () => {
  test("leaves up to 20 units alone and cuts the rest to 19 and an ellipsis", () => {
    expect(clampLabel("開啟帳本")).toBe("開啟帳本");
    expect(clampLabel("a".repeat(20))).toBe("a".repeat(20));
    expect(clampLabel("a".repeat(21))).toBe(`${"a".repeat(19)}…`);
  });

  test("cuts between emoji, not inside one", () => {
    const cut = clampLabel(EMOJI.repeat(12));
    expect(cut).toBe(`${EMOJI.repeat(9)}…`);
    expect(isWellFormed(cut)).toBe(true);
  });

  test("a blank label becomes a dash: LINE refuses an empty one", () => {
    expect(clampLabel("")).toBe("—");
  });
});

describe("text", () => {
  // [MV]: remove the blank guard and an empty category label becomes an empty text node, which LINE rejects.
  test.each(["", " ", "   ", "\n\t "])("blank text %j becomes a dash", (value) => {
    expect(text(value, { color: "#EEF1F6" }).text).toBe("—");
  });

  test("non-blank text is kept exactly, spaces included", () => {
    expect(text(" 早餐 ", { color: "#EEF1F6" }).text).toBe(" 早餐 ");
  });

  test("carries the style and no key that was not given", () => {
    const node = text("hi", { color: "#EEF1F6", size: "xs", weight: "bold", wrap: true, margin: undefined });
    expect(node).toEqual({ type: "text", text: "hi", color: "#EEF1F6", size: "xs", weight: "bold", wrap: true });
    expect("margin" in node).toBe(false);
  });
});

describe("vbox and hbox", () => {
  const label = text("x", { color: "#EEF1F6" });

  // [MV]: drop the default and a box without spacing inherits LINE's client-dependent one.
  test("always state a spacing, none unless given", () => {
    expect(vbox([label])).toEqual({ type: "box", layout: "vertical", contents: [label], spacing: "none" });
    expect(hbox([label])).toEqual({ type: "box", layout: "horizontal", contents: [label], spacing: "none" });
    expect(vbox([label], { spacing: "md" }).spacing).toBe("md");
    expect(vbox([label], { spacing: undefined }).spacing).toBe("none");
  });

  test("pass the other properties through and drop the ones that are undefined", () => {
    const box = hbox([label], { margin: "lg", paddingAll: "20px", alignItems: "center", flex: undefined, width: undefined });
    expect(box).toEqual({
      type: "box",
      layout: "horizontal",
      contents: [label],
      spacing: "none",
      margin: "lg",
      paddingAll: "20px",
      alignItems: "center",
    });
    expect("flex" in box).toBe(false);
    expect("width" in box).toBe(false);
  });
});

describe("separator, uriButton and heroImage", () => {
  test("separator carries its colour, and a margin only when given", () => {
    expect(separator("#262C3F")).toEqual({ type: "separator", color: "#262C3F" });
    expect(separator("#262C3F", "lg")).toEqual({ type: "separator", color: "#262C3F", margin: "lg" });
  });

  test("uriButton is a primary, small button by default and always a uri action", () => {
    expect(uriButton("開啟帳本", "https://example.com/a", { color: "#0E8460" })).toEqual({
      type: "button",
      style: "primary",
      color: "#0E8460",
      height: "sm",
      action: { type: "uri", label: "開啟帳本", uri: "https://example.com/a" },
    });
    const link = uriButton("x", "https://example.com/a", { color: "#0E8460", style: "link", height: "md" });
    expect(link).toMatchObject({ style: "link", height: "md" });
  });

  test("uriButton clamps its label to LINE's 20", () => {
    expect(uriButton("a".repeat(30), "https://example.com/a", { color: "#0E8460" }).action.label).toBe(`${"a".repeat(19)}…`);
    expect(uriButton("", "https://example.com/a", { color: "#0E8460" }).action.label).toBe("—");
  });

  test("heroImage fills the width and crops to the aspect ratio", () => {
    expect(heroImage("https://example.com/h.jpg", "2:1", "#12151F")).toEqual({
      type: "image",
      url: "https://example.com/h.jpg",
      size: "full",
      aspectRatio: "2:1",
      aspectMode: "cover",
      backgroundColor: "#12151F",
    });
  });
});

describe("progressBar", () => {
  const options = { fill: "#4DE3A6", track: "#262C3F", height: 6 };
  const fillOf = (percent: number) => progressBar(percent, options).contents;

  // [MV]: emit a fill at 0% and the rows without a fill fail: a "0%" width is not a length LINE accepts.
  test.each([
    [0, undefined],
    [0.4, undefined],
    [-5, undefined],
    [Number.NaN, undefined],
    [Number.NEGATIVE_INFINITY, undefined],
    [1, "1%"],
    [55.9, "55%"],
    [99.9, "99%"],
    [100, "100%"],
    [150, "100%"],
    [Number.POSITIVE_INFINITY, "100%"],
  ])("%s%% gives a fill of %s", (percent, width) => {
    const contents = fillOf(percent);
    if (width === undefined) {
      expect(contents).toEqual([]);
    } else {
      expect(contents).toHaveLength(1);
      expect(contents[0]).toMatchObject({ width });
    }
  });

  test("is a rounded track with an empty-contents fill inside it", () => {
    const bar = progressBar(40, { ...options, margin: "md" });
    expect(bar).toEqual({
      type: "box",
      layout: "vertical",
      spacing: "none",
      height: "6px",
      cornerRadius: "3px",
      backgroundColor: "#262C3F",
      margin: "md",
      contents: [
        {
          type: "box",
          layout: "vertical",
          spacing: "none",
          width: "40%",
          height: "6px",
          cornerRadius: "3px",
          backgroundColor: "#4DE3A6",
          contents: [],
        },
      ],
    });
  });

  test("an empty bar is still a track with a height, so it does not collapse", () => {
    expect(progressBar(0, options)).toMatchObject({ height: "6px", backgroundColor: "#262C3F", contents: [] });
  });

  test("the height may be given as pixels in a string, with the same result", () => {
    expect(progressBar(40, { ...options, height: "6px" })).toEqual(progressBar(40, options));
    expect(progressBar(40, { ...options, height: "10px" })).toMatchObject({ height: "10px", cornerRadius: "5px" });
    expect(progressBar(40, { ...options, height: "5.6px" })).toMatchObject({ height: "6px", cornerRadius: "3px" });
  });

  test("a height that is not a whole pixel count is rounded, and never below 1px", () => {
    expect(progressBar(50, { ...options, height: 5.4 })).toMatchObject({ height: "5px", cornerRadius: "2px" });
    expect(progressBar(50, { ...options, height: 0 })).toMatchObject({ height: "1px", cornerRadius: "0px" });
  });
});

describe("bubble", () => {
  const BG = "#12151F";
  const body = vbox([text("hi", { color: "#EEF1F6" })], { paddingAll: "20px" });
  const footer = vbox([uriButton("x", "https://example.com/a", { color: "#0E8460" })], { paddingAll: "12px" });
  const hero = heroImage("https://example.com/h.jpg", "2:1", BG);

  // [MV]: skip the style for any block and it is white on a client whose default is white.
  test("writes a background for exactly the blocks it has", () => {
    expect(bubble({ body, background: BG })).toEqual({ type: "bubble", body, styles: { body: { backgroundColor: BG } } });
    expect(bubble({ hero, body, background: BG })).toEqual({
      type: "bubble",
      hero,
      body,
      styles: { hero: { backgroundColor: BG }, body: { backgroundColor: BG } },
    });
    expect(bubble({ body, footer, background: BG })).toEqual({
      type: "bubble",
      body,
      footer,
      styles: { body: { backgroundColor: BG }, footer: { backgroundColor: BG } },
    });
  });

  test("footerSeparator turns on the line between body and footer, in that colour", () => {
    expect(bubble({ body, footer, background: BG, footerSeparator: "#262C3F" }).styles.footer).toEqual({
      backgroundColor: BG,
      separator: true,
      separatorColor: "#262C3F",
    });
  });

  test("a footerSeparator without a footer styles nothing", () => {
    expect(bubble({ body, background: BG, footerSeparator: "#262C3F" }).styles).toEqual({ body: { backgroundColor: BG } });
  });

  test("never sets a size or direction", () => {
    const keys = Object.keys(bubble({ hero, body, footer, background: BG }));
    expect(keys.sort()).toEqual(["body", "footer", "hero", "styles", "type"]);
  });
});

describe("flexMessage", () => {
  const card = bubble({ body: vbox([text("hi", { color: "#EEF1F6" })], { paddingAll: "20px" }), background: "#12151F" });

  test("applies the altText limit itself", () => {
    expect(flexMessage("a".repeat(500), card).altText).toBe(`${"a".repeat(399)}…`);
    expect(flexMessage("", card).altText).toBe("—");
  });

  test("carries a quickReply only when given", () => {
    const quickReply = { items: [{ type: "action" as const, action: { type: "uri" as const, label: "x", uri: "https://example.com/a" } }] };
    expect(flexMessage("alt", card, quickReply).quickReply).toBe(quickReply);
    expect("quickReply" in flexMessage("alt", card)).toBe(false);
    expect("quickReply" in flexMessage("alt", card, undefined)).toBe(false);
  });

  test("everything the kit builds, put together, is a message LINE accepts", () => {
    const message = flexMessage(
      "alt",
      bubble({
        hero: heroImage("https://example.com/h.jpg", "2:1", "#12151F"),
        body: vbox(
          [
            text("title", { color: "#EEF1F6", size: "lg", weight: "bold", wrap: true, maxLines: 2 }),
            separator("#262C3F", "lg"),
            hbox([text("a", { color: "#9AA3B5", flex: 1 }), text("b", { color: "#EEF1F6", align: "end", flex: 0 })], { margin: "lg" }),
            progressBar(40, { fill: "#4DE3A6", track: "#262C3F", height: 8, margin: "md" }),
            progressBar(0, { fill: "#4DE3A6", track: "#262C3F", height: 8, margin: "md" }),
          ],
          { paddingAll: "20px" },
        ),
        footer: vbox([uriButton("開啟帳本", "https://example.com/a", { color: "#0E8460" })], { paddingAll: "12px" }),
        background: "#12151F",
        footerSeparator: "#262C3F",
      }),
    );

    assertValidFlexMessage(message);
    expect(JSON.parse(JSON.stringify(message))).toEqual(message);
  });
});
