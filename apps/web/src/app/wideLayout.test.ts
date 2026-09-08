import { describe, expect, test } from "vitest";
import { readAppStylesheet, ruleFor } from "./cssDeclarations";

/**
 * The three columns of the wide layout, and the button that floats over them.
 *
 * Both of these were reported together from a desktop screenshot: the right
 * column started lower than the other two, and the add button sat on top of
 * 刪除群組.
 */
const homeCss = readAppStylesheet("app-home.css");
const baseCss = readAppStylesheet("app-base.css");

describe("the right column lines up with the other two", () => {
  const rail = ruleFor(homeCss, ".group-side-nav");

  test("it is not sticky, because there is nothing here to stick to", () => {
    // .workspace-grid is a fixed-height overflow:hidden box - the page does not
    // scroll on this layout, each column scrolls inside itself. That made the
    // grid this column's sticky scrollport, and a scrollport that never scrolls
    // has nothing to stick to: `top` only pushed the column down.
    expect(rail.position).toBeUndefined();
    expect(rail.top).toBeUndefined();
  });

  test("and the left rail, which always lined up, is not sticky either", () => {
    // The pair that actually does the work is max-height + overflow, and both
    // columns have always had it.
    // The left rail lives in app-base.css, not beside this one.
    const left = ruleFor(baseCss, ".group-rail");
    expect(left.position).toBeUndefined();
    expect(left["max-height"]).toBe(rail["max-height"]);
    expect(left.overflow).toBeTruthy();
    expect(rail.overflow).toBeTruthy();
  });

  test("nothing above the cover, so it starts where the card does", () => {
    const padding = (rail.padding ?? "").split(/\s+/);
    expect(padding).toHaveLength(3);
    expect(padding[0]).toBe("0");
  });

  test("the grid still starts all three columns on the same line", () => {
    expect(ruleFor(baseCss, ".workspace-grid")["align-items"]).toBe("start");
  });
});

describe("the add button floats over the ledger, not over the navigation", () => {
  const fab = ruleFor(homeCss, ".floating-action");

  test("it is offset by a whole column, not just inset from the shell", () => {
    // `max(26px, (100vw - 1180px) / 2)` alone is the shell's right edge, which
    // on this layout is the navigation column - where it covered 刪除群組.
    const right = fab.right ?? "";
    expect(right).toContain("100vw - 1180px");
    // The rail's own width has to be in there, or it is still over the rail.
    expect(right).toMatch(/\+\s*29[0-9]px/);
  });

  test("that offset clears the widest the rail can be", () => {
    // Sizing off the narrow end of minmax(220px, 260px) left 2px between the
    // button and the rail, which is a coincidence rather than clearance.
    const railWidth = ruleFor(baseCss, ".workspace-grid")["grid-template-columns"] ?? "";
    expect(railWidth).toContain("260px");

    const offset = Number(/\+\s*(\d+)px/.exec(fab.right ?? "")?.[1]);
    expect(offset).toBeGreaterThanOrEqual(260 + 16);
  });

  test("the column it moved off keeps its full height", () => {
    // The first attempt shortened the right column to duck underneath, which
    // stopped the pair being covered by making it need a scroll instead.
    expect(ruleFor(homeCss, ".group-side-nav")["max-height"]).toBe("calc(100vh - 132px)");
  });
});
