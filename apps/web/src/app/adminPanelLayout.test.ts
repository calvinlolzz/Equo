import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * The console's panels are styled entirely by hand-written class names, and
 * nothing in the type system connects a className string to a rule in
 * AdminApp.css. So the drift is silent: the panel renders, the class does
 * nothing, and the control falls back to whatever the browser draws.
 *
 * Which is what had happened. 設定 was shipping three submit buttons at 36x20
 * in browser-default grey, and three text inputs with no border radius,
 * because .admin-text-input and .admin-settings-actions had never been
 * written and .admin-primary existed only inside a max-width media query.
 */

const css = readFileSync(join(__dirname, "AdminApp.css"), "utf8");

/** The stylesheet minus every @media block, i.e. what a desktop gets before any query matches. */
const unconditional = stripMediaBlocks(css);

function stripMediaBlocks(source: string): string {
  let out = "";
  let cursor = 0;
  for (;;) {
    const start = source.indexOf("@media", cursor);
    if (start < 0) return out + source.slice(cursor);
    out += source.slice(cursor, start);

    let depth = 0;
    let i = source.indexOf("{", start);
    for (; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    cursor = i + 1;
  }
}

function classesIn(source: string): Set<string> {
  return new Set([...source.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((match) => match[1]));
}

/** Every class name the console's panels put in a className, admin-* only. */
function classesUsedByPanels(): Map<string, string[]> {
  const used = new Map<string, string[]>();
  const files = readdirSync(__dirname).filter(
    (name) => (name.startsWith("Admin") || name === "adminPanelKit.tsx") && name.endsWith(".tsx") && !name.includes(".test."),
  );

  for (const file of files) {
    const source = readFileSync(join(__dirname, file), "utf8");
    for (const match of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{[^}]*?"([^"]*)"[^}]*?\})/g)) {
      const literal = [match[1], match[2], match[3]].filter(Boolean).join(" ");
      // `admin-tile--${tone}` leaves an "admin-tile--" stub; the stem is what
      // matters and it is covered by its own full class elsewhere.
      for (const name of literal.replace(/\$\{/g, "  ").replace(/\}/g, " ").split(/\s+/)) {
        if (!/^admin[a-zA-Z0-9_-]*$/.test(name) || name.endsWith("--")) continue;
        used.set(name, [...(used.get(name) ?? []), file]);
      }
    }
  }
  return used;
}

/** The class names that are containers only - they exist to be selected by a modifier. */
const WRAPPERS_WITHOUT_RULES = new Set(["admin-list"]);

describe("every class the panels use is a class the stylesheet knows", () => {
  const used = classesUsedByPanels();

  test("the scan is actually finding classes", () => {
    // Guards the regex: a broken matcher would make every assertion below pass
    // by having nothing to check.
    expect(used.size).toBeGreaterThan(100);
    expect(used.has("admin-settings-card")).toBe(true);
  });

  test("none of them is missing a rule", () => {
    const defined = classesIn(css);
    const orphans = [...used.keys()].filter((name) => !defined.has(name) && !WRAPPERS_WITHOUT_RULES.has(name));
    expect(orphans).toEqual([]);
  });

  test("and none of them is styled only inside a media query", () => {
    // The failure this catches is the nastier one: it looks styled on a phone
    // and is a browser-default control everywhere else.
    const desktop = classesIn(unconditional);
    const conditional = [...used.keys()].filter(
      (name) => !desktop.has(name) && !WRAPPERS_WITHOUT_RULES.has(name),
    );
    expect(conditional).toEqual([]);
  });
});

describe("the controls that had drifted", () => {
  /** The declarations of one rule, as the stylesheet writes it: `selector {`. */
  function ruleBody(selector: string): string {
    const at = unconditional.indexOf(`${selector} {`);
    if (at < 0) return "";
    const open = unconditional.indexOf("{", at);
    return unconditional.slice(open + 1, unconditional.indexOf("}", open));
  }

  test("a checkbox in a toggle keeps a checkbox's size", () => {
    // An <input> with no width is a flex item sized from the UA text field:
    // the box painted 13px inside a 70px slot and shoved the label off the end.
    const block = ruleBody('.admin-toggle input[type="checkbox"]');
    expect(block).toMatch(/flex:\s*none/);
    expect(block).toMatch(/width:\s*16px/);
  });

  test("and the words beside it stay on one line", () => {
    // 顯示已刪除（{n} 筆）is three text nodes, and a flex container makes an
    // anonymous item of each - so the label broke at the interpolation however
    // much room the row had. One span, one item.
    expect(ruleBody(".admin-toggle > span")).toMatch(/white-space:\s*nowrap/);
    const panel = readFileSync(join(__dirname, "AdminGroupPanels.tsx"), "utf8");
    expect(panel).toContain("<span>顯示已刪除（{group.deleted_expense_count} 筆）</span>");
  });

  test("a settings row's first column is the checkbox, not whatever is in it", () => {
    // `auto` sized the column per row, so one 620px card had its labels
    // starting at four different x positions.
    expect(ruleBody(".admin-settings-row")).toMatch(/grid-template-columns:\s*18px 1fr/);
  });

  test("every settings form has a styled submit button", () => {
    const panel = readFileSync(join(__dirname, "AdminSettingsPanel.tsx"), "utf8");
    const submits = [...panel.matchAll(/<button\b[^>]*type="submit"[^>]*>/gs)];
    expect(submits.length).toBeGreaterThan(2);
    for (const [tag] of submits) expect(tag).toContain("className=");
  });
});
