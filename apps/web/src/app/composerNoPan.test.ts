import { describe, expect, test } from "vitest";
import { insideAtRule, readAppStylesheet, ruleFor } from "./cssDeclarations";

/**
 * The add-expense sheet used to pan sideways under a finger, sliding its own
 * labels off the left edge — 「分帳方式」 read as 「帳方式」, 「付款人」 as 「款人」.
 *
 * Two independent causes, both asserted here:
 *
 * 1. The step body is a grid, and a grid column sized `1fr` is
 *    `minmax(auto, 1fr)` — `auto` as a MINIMUM means "never narrower than the
 *    content". One stubborn child therefore sets a floor for the whole sheet,
 *    and input[type=datetime-local] is exactly that child: a native control
 *    with a ~255px intrinsic width that shrinks for nobody. Measured on the
 *    real sheet, the floor was 299px before these rules and 150px after.
 *
 * 2. `overflow-y: auto` on its own computes `overflow-x` to `auto` as well, so
 *    the step body was a horizontally scrollable box the whole time. Anything
 *    that overflowed it by a pixel became a drag.
 */
const composerCss = readAppStylesheet("app-composer.css");
const phoneCss = insideAtRule(composerCss, "max-width: 620px");

describe("the stepped composer cannot be panned sideways", () => {
  const stepBody = ruleFor(phoneCss, ".composer-step-body");

  test("names both overflow axes, rather than letting overflow-x default to auto", () => {
    const overflow = `${stepBody.overflow ?? ""} ${stepBody["overflow-x"] ?? ""}`;
    expect(overflow).toContain("hidden");
    // Still scrolls vertically - it is the sheet's scroll surface.
    expect(`${stepBody.overflow ?? ""} ${stepBody["overflow-y"] ?? ""}`).toContain("auto");
  });

  test("keeps the overscroll containment that stops the page behind it scrolling", () => {
    expect(stepBody["overscroll-behavior"]).toBe("none");
  });
});

describe("every grid column inside the sheet can be squeezed", () => {
  /** `1fr` alone carries a min-content floor; `minmax(0, 1fr)` does not. */
  const shrinkable = (value: string | undefined) => {
    expect(value).toBeTruthy();
    expect(value).toContain("minmax(0,");
    // No bare `1fr` track left to reintroduce the floor.
    expect(value?.replace(/minmax\(0,[^)]*\)/g, "")).not.toMatch(/\b1fr\b/);
  };

  test("the step body itself", () => {
    shrinkable(ruleFor(phoneCss, ".composer-step-body")["grid-template-columns"]);
  });

  test("the card sections that hold the payer and split editors", () => {
    shrinkable(ruleFor(composerCss, ".composer-card-section")["grid-template-columns"]);
  });

  test("the 分類 / 日期 grid, in both its layouts - the date field is the worst offender", () => {
    shrinkable(ruleFor(composerCss, ".composer-meta-grid")["grid-template-columns"]);
    shrinkable(ruleFor(phoneCss, ".composer-meta-grid")["grid-template-columns"]);
  });

  test("and the native controls in it are allowed below their intrinsic width", () => {
    const rule = ruleFor(composerCss, ".composer-meta-grid input");
    expect(rule["min-width"]).toBe("0");
  });
});

describe("a long display name is absorbed by the row it is in", () => {
  const value = ruleFor(composerCss, ".composer-payer-summary-value");
  const strong = ruleFor(composerCss, ".composer-payer-summary-value strong");

  test("the value shrinks instead of widening the sheet", () => {
    expect(value["min-width"]).toBe("0");
  });

  test("and truncates rather than wrapping the chevron off the row", () => {
    expect(strong["min-width"]).toBe("0");
    expect(strong.overflow).toBe("hidden");
    expect(strong["text-overflow"]).toBe("ellipsis");
    expect(strong["white-space"]).toBe("nowrap");
  });

  test("which is what lets the label beside it stay on one line", () => {
    // 「分帳方 / 式」 on a 320px phone, before this.
    expect(ruleFor(composerCss, ".composer-section-head-label")["white-space"]).toBe("nowrap");
  });

  test("the split summary is covered by the same rule, not a second copy of it", () => {
    expect(composerCss).not.toContain(".composer-split-summary-value");
  });
});
