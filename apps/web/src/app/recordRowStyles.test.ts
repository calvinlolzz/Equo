import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Read off disk, not imported.
 *
 * `import css from "./x.css?raw"` looks like the idiomatic way and is a trap
 * here: Vitest stubs CSS imports (css: false), so the `?raw` suffix is swallowed
 * and the import resolves to an EMPTY STRING. A test written on top of that
 * parses nothing, finds nothing, and — depending on how it is phrased — can
 * pass. This path is resolved from import.meta.url rather than cwd so the suite
 * does not care which directory it was started from.
 */
const dialogCss = readFileSync(fileURLToPath(new URL("./styles/app-dialogs.css", import.meta.url)), "utf8");

/**
 * The only test in this suite that looks at CSS — and the reason it exists.
 *
 * Everything else here mounts components in jsdom, which applies no styles, so
 * no stylesheet change can fail any of them. That gap shipped a real bug. The
 * rule used to read:
 *
 *   .record-dialog-row,
 *   .member-dialog-row { ...the row layout... }
 *
 * and a new rule was inserted between those two lines (0514cae). The record row
 * silently detached from the layout and attached to the wrapper rule that now
 * followed it, so every row in 支出記錄 rendered as a bare browser-default
 * button: shrink-wrapped, grey, with its icon, title, time and amount stacked
 * vertically. It was live for a week; nothing in 1712 tests moved.
 *
 * ⚠️ Why this parses the file rather than asking jsdom for a computed style:
 * jsdom does cascade an injected rule, so that version looks like it works —
 * but under Vitest the stylesheet arrives empty (see below), every element then
 * reports the browser default, and a "both classes agree" assertion passes on
 * two identical defaults. The first draft of this file did exactly that. So the
 * cascade is resolved here, over the bytes on disk, for the two classes that
 * matter.
 */
type Declarations = Record<string, string>;

/**
 * Every declaration that applies to one class name, in file order.
 *
 * Deliberately exact-match on the selector: `.record-dialog-row:active` and
 * `.record-swipe > .record-dialog-row` are different rules with different jobs,
 * and folding them in would hide the base rule going missing.
 */
function declarationsFor(className: string): Declarations {
  const withoutComments = dialogCss.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g);
  const merged: Declarations = {};

  for (const [, selectorText, body] of blocks) {
    const selectors = selectorText.split(",").map((entry) => entry.trim());
    if (!selectors.includes(`.${className}`)) continue;

    for (const declaration of body.split(";")) {
      const separator = declaration.indexOf(":");
      if (separator === -1) continue;
      merged[declaration.slice(0, separator).trim()] = declaration.slice(separator + 1).trim();
    }
  }

  return merged;
}

describe("the records list keeps its row layout", () => {
  const row = declarationsFor("record-dialog-row");

  test("the row is laid out at all", () => {
    // Nothing here is decoration: without these the browser falls back to its
    // own button styling, which is what the bug looked like.
    expect(row.display).toBe("grid");
    expect(row["grid-template-columns"]).toBe("44px minmax(0, 1fr) auto");
    expect(row.width).toBe("100%");
  });

  test("the row carries its own surface, not the button face", () => {
    expect(row.background).toContain("var(--surf)");
    expect(row.padding).toBeTruthy();
    expect(row["min-height"]).toBeTruthy();
  });

  test("it is laid out by the same rule as the member row", () => {
    const member = declarationsFor("member-dialog-row");

    // Not a tautology: both sides are declarations read out of the file, so if
    // the shared selector list is split again, one of them keeps the layout and
    // this comparison is what notices.
    expect(member.display).toBe("grid");
    expect(row.display).toBe(member.display);
    expect(row["grid-template-columns"]).toBe(member["grid-template-columns"]);
    expect(row.padding).toBe(member.padding);
  });

  test("the wrapper rule that once swallowed it is a rule of its own", () => {
    // .member-dialog-entry stacks a member row above their 收款資訊 line. It is
    // a column flex, which is exactly the wrong shape for a row — the bug was
    // this rule's selector list reaching one line too far up.
    const entry = declarationsFor("member-dialog-entry");

    expect(entry["flex-direction"]).toBe("column");
    expect(row["flex-direction"]).toBeUndefined();
  });
});
