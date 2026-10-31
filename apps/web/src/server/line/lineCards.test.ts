import { describe, expect, test } from "vitest";
import { fill } from "../push/pushText.js";
import { CARD } from "./lineCardTheme.js";
import { brandStrip, helpCard } from "./lineCards.js";
import type { FlexBox, LineFlexMessage } from "./lineFlex.js";
import { actionsOf, assertValidFlexMessage, lineMessageProblems } from "./lineFlexValidator.js";
import { type LineDictionary, LINE_TEXT_EN as EN, LINE_TEXT_ZH_HANT as ZH_HANT } from "./lineText.js";

type Node = Record<string, unknown>;

const LOCALES = [
  ["zh-Hant", ZH_HANT],
  ["en", EN],
] as const satisfies ReadonlyArray<readonly [string, LineDictionary]>;

/** Depth-first, in document order: the order the nodes are drawn in. */
function walk(node: unknown, visit: (node: Node) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
  } else if (typeof node === "object" && node !== null) {
    visit(node as Node);
    for (const value of Object.values(node)) walk(value, visit);
  }
}

/** Every text node's string, in the order it is drawn. */
function textsOf(message: LineFlexMessage): string[] {
  const found: string[] = [];
  walk(message.contents, (node) => {
    if (node.type === "text") found.push(node.text as string);
  });
  return found;
}

function nodesWhere(message: LineFlexMessage, predicate: (node: Node) => boolean): Node[] {
  const found: Node[] = [];
  walk(message.contents, (node) => {
    if (predicate(node)) found.push(node);
  });
  return found;
}

/** The inset content box: the second child of the body, after the brand strip. */
function contentOf(message: LineFlexMessage): Node[] {
  return (message.contents.body.contents[1] as FlexBox).contents as unknown as Node[];
}

describe("brandStrip", () => {
  test("is a 4px row of three equal empty segments: mint, blue, violet", () => {
    const strip = brandStrip();
    expect(strip.layout).toBe("horizontal");
    expect(strip.height).toBe("4px");
    expect(strip.contents).toHaveLength(3);
    for (const segment of strip.contents) {
      expect(segment).toMatchObject({ type: "box", flex: 1, contents: [] });
    }
    expect(strip.contents.map((segment) => (segment as FlexBox).backgroundColor)).toEqual([CARD.mint, CARD.blue, CARD.violet]);
  });
});

describe("helpCard", () => {
  const build = (dict: LineDictionary, minutes: number) =>
    helpCard(dict, { minutes, altText: fill(dict.help, { minutes }) });

  describe.each(LOCALES)("%s", (_locale, dict) => {
    // Window sizes around where the plain text's 400-unit altText limit bites (see lineText.test.ts).
    test.each([1, 30, 1440])("is a valid card for an undo window of %s minutes", (minutes) => {
      assertValidFlexMessage(build(dict, minutes));
    });

    test("carries the altText it was given, whole", () => {
      expect(build(dict, 30).altText).toBe(fill(dict.help, { minutes: 30 }));
    });

    test("draws the title, lead, six rows in order, then the note", () => {
      const minutes = 45;
      expect(textsOf(build(dict, minutes))).toEqual([
        dict.helpCardTitle,
        dict.helpCardLead,
        "\u{1F4B8}",
        dict.helpExpenseTitle,
        dict.helpExpenseCmd,
        "\u{1F4B0}",
        dict.helpIncomeTitle,
        dict.helpIncomeCmd,
        "\u{1F4CA}",
        dict.helpMonthTitle,
        dict.helpMonthCmd,
        "\u{1F3AF}",
        dict.helpBudgetTitle,
        dict.helpBudgetCmd,
        "\u{23EA}",
        fill(dict.helpUndoTitle, { minutes }),
        dict.helpUndoCmd,
        "\u{1F517}",
        dict.helpUnlinkTitle,
        dict.helpUnlinkCmd,
        dict.helpCardNote,
      ]);
    });

    test("says the real undo window in the undo row", () => {
      expect(textsOf(build(dict, 45)).join("\n")).toContain("45");
      expect(textsOf(build(dict, 45)).join("\n")).not.toContain("{minutes}");
    });
  });

  test("a body with the brand strip first, then the inset content, on the card background", () => {
    const message = build(ZH_HANT, 30);
    const { body } = message.contents;

    expect(body.paddingAll).toBe("0px");
    expect(body.contents[0]).toEqual(brandStrip());
    expect(body.contents[1]).toMatchObject({ type: "box", layout: "vertical", paddingAll: "20px" });
    expect(message.contents.styles.body.backgroundColor).toBe(CARD.bg);
    expect(message.contents.hero).toBeUndefined();
    expect(message.contents.footer).toBeUndefined();
  });

  test("is one bubble with no size, so every client draws the default width", () => {
    expect(build(ZH_HANT, 30).contents.type).toBe("bubble");
    expect(build(ZH_HANT, 30).contents).not.toHaveProperty("size");
  });

  test("has six rows, each a tinted tile beside a title and a command box", () => {
    const rows = contentOf(build(ZH_HANT, 30)).filter((node) => node.type === "box");

    expect(rows).toHaveLength(6);
    for (const row of rows as unknown as FlexBox[]) {
      expect(row.layout).toBe("horizontal");
      const [tile, column] = row.contents as FlexBox[];
      expect(tile).toMatchObject({ width: "36px", height: "36px", cornerRadius: "10px", flex: 0 });
      expect(column.flex).toBe(1);
      // The command sits in a full-width raised box: a shrink-to-fit pill overflows a horizontal box.
      const commandBox = column.contents[1] as FlexBox;
      expect(commandBox.backgroundColor).toBe(CARD.raised);
      expect(commandBox.contents[0]).toMatchObject({ type: "text", color: CARD.mint, wrap: true });
    }
  });

  // [MV]: a variation selector or a ZWJ sequence draws as text or as several emoji on some clients.
  test("every row emoji is a single code point with Emoji_Presentation", () => {
    const emoji = textsOf(build(ZH_HANT, 30)).filter((value) => /^\p{Emoji}/u.test(value) && [...value].length === 1);

    expect(emoji).toHaveLength(6);
    for (const value of emoji) {
      expect(value).toMatch(/^\p{Emoji_Presentation}$/u);
      expect(value).not.toContain("️");
    }
  });

  test("the six tiles are tinted from six different accents", () => {
    const tiles = nodesWhere(build(ZH_HANT, 30), (node) => node.width === "36px").map((node) => node.backgroundColor);
    expect(new Set(tiles).size).toBe(6);
  });

  // [MV]: put any action on the card and tapping an example would send (and so record) it.
  test("nothing on the card can be tapped, and there is no quick reply", () => {
    const message = build(ZH_HANT, 30);
    expect(actionsOf(message)).toEqual([]);
    expect(nodesWhere(message, (node) => node.type === "button")).toEqual([]);
    expect(message.quickReply).toBeUndefined();
  });

  test("makes no problem the validator can find, in either locale", () => {
    for (const [, dict] of LOCALES) expect(lineMessageProblems(build(dict, 30))).toEqual([]);
  });
});
