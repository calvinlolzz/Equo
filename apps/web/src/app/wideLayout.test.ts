import { describe, expect, test } from "vitest";
import { readAppStylesheet, ruleFor } from "./cssDeclarations";

/**
 * The two columns of the wide layout (phase 3: the three columns of phase 0
 * became two — the right-hand navigation column is gone, its content moved
 * into the ▾ menu beside the group's name), and the button that floats over
 * them.
 *
 * This file used to protect a three-column geometry: the right column
 * started lower than the other two, and the add button sat on top of
 * 刪除群組 at the bottom of that column. The three-column assertions are gone
 * with the column, but the FAB-covers-something-clickable risk did not go
 * away with it — the left rail can still open as a 260px overlay, and the
 * button must not land on it, or on the rail's own expand/collapse arrow.
 * That risk is what the last describe block below re-derives and protects.
 */
const homeCss = readAppStylesheet("app-home.css");
const baseCss = readAppStylesheet("app-base.css");
const composerCss = readAppStylesheet("app-composer.css");

describe("the workspace is two columns, not three", () => {
  test("a 64px rail strip and the content, nothing else", () => {
    expect(ruleFor(baseCss, ".workspace-grid")["grid-template-columns"]).toBe("64px minmax(0, 1fr)");
  });

  test("still starts both columns on the same line", () => {
    expect(ruleFor(baseCss, ".workspace-grid")["align-items"]).toBe("start");
  });

  test("has no position of its own", () => {
    // Load-bearing: a positioned grid becomes the expanded rail's containing
    // block, and .workspace-grid's own overflow:hidden would then clip the
    // overlay's drop shadow at the 64px track. See the next describe block.
    expect(ruleFor(baseCss, ".workspace-grid").position).toBeUndefined();
  });

  test("the ancestor the expanded rail actually overlays against is positioned", () => {
    expect(ruleFor(baseCss, ".app-shell").position).toBe("relative");
  });

  test("both columns are placed explicitly", () => {
    // Auto-placement would drop the content into the 64px rail track the
    // moment the rail goes absolute and leaves the grid flow.
    expect(ruleFor(baseCss, ".workspace-grid > .group-rail")["grid-column"]).toBe("1");
    expect(ruleFor(baseCss, ".workspace-grid > .pizo-home")["grid-column"]).toBe("2");
  });

  test("the right column is gone at every width, not just the mobile one", () => {
    // Its content moved into the ▾ menu (GroupMenu.tsx / .group-menu-popover)
    // beside the group's name. The <aside> is kept in the tree (see App.tsx)
    // for the mobile settings drawer's own GroupSideNav instance, but this
    // element itself never paints again.
    expect(ruleFor(baseCss, ".workspace-grid > .group-side-nav").display).toBe("none");
  });

  test("the pre-group skeleton, the grid's only child then, is not split into a rail track", () => {
    expect(ruleFor(baseCss, ".workspace-grid--solo")["grid-template-columns"]).toBe("minmax(0, 1fr)");
  });
});

describe("the rail is a strip that opens over the content, not beside it", () => {
  const expandedRail = ruleFor(baseCss, ':root[data-rail="expanded"] .workspace-grid > .group-rail');

  test("expanding it is an overlay, not a layout change", () => {
    expect(expandedRail.position).toBe("absolute");
    expect(expandedRail.width).toBe("260px");
    expect(expandedRail["box-shadow"]).toBeTruthy();
    // Opaque, not translucent glass: it now sits over the ledger, not beside it.
    expect(expandedRail.background).toBe("var(--card-solid)");
  });

  test("it anchors to the shell's own padding, not an independent guess", () => {
    expect(expandedRail.bottom).toBe("34px");
    expect(ruleFor(baseCss, ".app-shell").padding).toContain(expandedRail.bottom as string);
  });

  test("the grid's own tracks do not change when the rail opens", () => {
    // A track change here is exactly the reflow this design exists to avoid —
    // the 64px strip stays 64px whether or not the overlay is showing. Checked
    // in every stylesheet that touches .workspace-grid, not just app-base.css
    // (where this file's own rules live) — a track override added to
    // app-home.css or app-composer.css instead would reintroduce the reflow
    // just as easily and this would otherwise never see it.
    for (const css of [baseCss, homeCss, composerCss]) {
      expect(ruleFor(css, ':root[data-rail="expanded"] .workspace-grid')).toEqual({});
    }
  });

  test("collapsed is the attribute-less default, so there is no flash before JS runs", () => {
    expect(baseCss).toContain(':root:not([data-rail="expanded"])');
    // i.e. there is no rule gated on a "collapsed" attribute value — collapsed
    // is what you get when <html> carries no data-rail at all.
    expect(ruleFor(baseCss, ':root[data-rail="collapsed"] .workspace-grid > .group-rail')).toEqual({});
  });

  test("light mode gets its own shadow", () => {
    const lightExpandedRail = ruleFor(baseCss, ':root[data-theme="light"][data-rail="expanded"] .workspace-grid > .group-rail');
    expect(lightExpandedRail["box-shadow"]).toBeTruthy();
    expect(lightExpandedRail["box-shadow"]).not.toBe(expandedRail["box-shadow"]);
  });
});

describe("the centre column is a fixed measure with air on both sides", () => {
  test("720px, not 620px — wide screens buy whitespace, not more content", () => {
    expect(ruleFor(baseCss, ".pizo-home")["max-width"]).toBe("720px");
  });

  test("centred in the track", () => {
    expect(ruleFor(baseCss, ".pizo-home")["justify-self"]).toBe("center");
  });

  test("the rail and the content still agree on how tall this layout is", () => {
    expect(ruleFor(baseCss, ".group-rail")["max-height"]).toBe(ruleFor(baseCss, ".pizo-home")["max-height"]);
  });
});

describe("the add button floats over the ledger, not over the rail", () => {
  const fab = ruleFor(homeCss, ".floating-action");
  const expandedRail = ruleFor(baseCss, ':root[data-rail="expanded"] .workspace-grid > .group-rail');
  const grid = ruleFor(baseCss, ".workspace-grid");
  const shell = ruleFor(baseCss, ".app-shell");

  test("it no longer ducks a column that isn't there", () => {
    // The old formula added +292px to clear the three-column layout's right
    // rail. That rail is gone; this asserts the extra term is too, not just
    // that the shell-edge term survived.
    expect(fab.right).toContain("100vw - 1180px");
    expect(fab.right).not.toMatch(/\+\s*\d+px/);
    // And not reintroduced by a top-level rule elsewhere — app-composer.css's
    // OWN .floating-action rules all live inside @media blocks (small-screen
    // overrides), which readAppStylesheet's ruleFor deliberately does not
    // see, so a stray top-level one here would otherwise go unnoticed.
    expect(ruleFor(composerCss, ".floating-action")).toEqual({});
  });

  test("it clears the rail — open or shut — at every desktop width the layout renders", () => {
    // Parsed out of the stylesheet rather than duplicated as literals, so a
    // future change to any of these numbers re-derives the same guarantee
    // instead of quietly invalidating it.
    const shellMax = Number(/min\(\s*(\d+)px/.exec(shell.width ?? "")?.[1]);
    const shellGutters = Number(/-\s*(\d+)px/.exec(shell.width ?? "")?.[1]);
    const fabInset = Number(/max\(\s*(\d+)px/.exec(fab.right ?? "")?.[1]);
    const fabWidth = Number.parseFloat(fab.width ?? "");
    const railOpenWidth = Number.parseFloat(expandedRail.width ?? "");
    const railStripWidth = Number.parseFloat((grid["grid-template-columns"] ?? "").split(" ")[0] ?? "");

    expect([shellMax, shellGutters, fabInset, fabWidth, railOpenWidth, railStripWidth]).not.toContain(Number.NaN);

    const fabLeftEdge = (vw: number) => vw - Math.max(fabInset, (vw - shellMax) / 2) - fabWidth;
    const shellLeftEdge = (vw: number) => (vw - Math.min(shellMax, vw - shellGutters)) / 2;

    // 961 is the mobile breakpoint + 1px — the tightest window this layout is
    // ever asked to render (useIsMobileLayout switches to the mobile shell at
    // 960px and below).
    for (const vw of [961, 1180, 1920]) {
      expect(fabLeftEdge(vw)).toBeGreaterThan(shellLeftEdge(vw) + railOpenWidth);
      expect(fabLeftEdge(vw)).toBeGreaterThan(shellLeftEdge(vw) + railStripWidth);
    }
  });

  test("and if they ever did meet anyway, the rail wins — it is the thing being reached for", () => {
    expect(Number(expandedRail["z-index"])).toBeGreaterThan(Number(fab["z-index"]));
  });
});
