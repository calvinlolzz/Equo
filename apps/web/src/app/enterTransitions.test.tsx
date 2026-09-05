// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { GroupHomeSkeleton } from "./GroupHomeSkeleton";
import { StartFlow } from "./StartFlowPanel";
import { declarationsFor, insideAtRule, keyframesBody, readAppStylesheet, ruleFor, rules } from "./cssDeclarations";

/**
 * Two places where the app changed screens between one frame and the next.
 *
 * jsdom applies no stylesheet, so nothing that only mounts components can fail
 * when these rules go missing — the assertions about motion are made against
 * the CSS on disk, and the assertions about wiring are made against the DOM.
 * Both halves are needed: a rule nobody carries and a class with no rule behind
 * it look identical from the app's side, which is to say identical to the cut
 * they were added to remove.
 */
const baseCss = readAppStylesheet("app-base.css");
const dialogCss = readAppStylesheet("app-dialogs.css");
/** Every stylesheet, in @import order (App.css) - the cascade the app sees. */
const allCss = ["app-base.css", "app-home.css", "app-dialogs.css", "app-composer.css", "app-misc.css", "app-landing.css"]
  .map(readAppStylesheet)
  .join("\n");

const startFlowProps = {
  groups: [],
  groupName: "",
  groupNamePlaceholder: "\u65c5\u884c",
  selectedTemplate: "trip",
  selectedTemplateLabel: "\u65c5\u884c",
  startMode: "create" as const,
  templates: [{ id: "trip", label: "\u65c5\u884c", defaultName: "\u65c5\u884c" }],
  onCreateGroup: () => {},
  onGroupNameChange: () => {},
  onSelectGroup: () => {},
  onSelectTemplate: () => {},
  onSetStartMode: () => {},
  onOpenInviteInput: () => {},
};

afterEach(cleanup);

describe("what replaces the skeleton fades in", () => {
  test("the entrance is an animation with a duration", () => {
    const enter = declarationsFor(baseCss, "enter-content").animation ?? "";

    expect(enter).toContain("content-enter");
    expect(enter).toMatch(/\d+ms/);
    expect(keyframesBody(baseCss, "content-enter")).toContain("opacity");
  });

  test("it animates opacity and nothing else", () => {
    // Load-bearing, not tidiness: an element with a running transform is the
    // containing block for every position: fixed descendant underneath it, so
    // adding a slide here would make the tab bar and the FAB jump for as long
    // as the fade lasts. The opacity assertion is what stops this from passing
    // on an empty read.
    const body = keyframesBody(baseCss, "content-enter");

    expect(body).toContain("opacity");
    expect(body).not.toContain("transform");
  });

  test("reduced motion gets the old instant swap back", () => {
    const reduced = insideAtRule(baseCss, "prefers-reduced-motion");

    expect(declarationsFor(reduced, "enter-content").animation).toBe("none");
  });

  test("the skeleton and both screens that replace it carry the class", () => {
    // The skeleton has it too: it used to appear as abruptly as it left.
    const skeleton = render(<GroupHomeSkeleton />).container.querySelector(".skeleton-card");
    expect(skeleton?.classList.contains("enter-content")).toBe(true);

    const start = render(<StartFlow {...startFlowProps} />).container.querySelector(".create-flow-shell");
    expect(start?.classList.contains("enter-content")).toBe(true);
  });
});

describe("the bottom tab bar eases between tabs", () => {
  test("the selected colour and the press scale are transitioned", () => {
    // The icon's lift was already animated; these two were the frames that
    // made switching tabs feel like a jump cut.
    const item = declarationsFor(dialogCss, "mobile-tab-item").transition ?? "";

    expect(item).toContain("color");
    expect(item).toContain("transform");
    expect(declarationsFor(dialogCss, "mobile-tab-center").transition).toContain("transform");
  });

  test("reduced motion holds all three still, not just the icon", () => {
    const reduced = insideAtRule(dialogCss, "prefers-reduced-motion");

    expect(declarationsFor(reduced, "mobile-tab-item").transition).toBe("none");
    expect(declarationsFor(reduced, "mobile-tab-center").transition).toBe("none");
  });
});

describe("selected and pressed states ease instead of flipping", () => {
  /** The selectors sharing one `transition` declaration, and the ones opting out. */
  function groupDeclaring(property: string, value: string): string[] {
    return rules(allCss)
      .filter((rule) => rule.selectors.length > 8 && rule.declarations[property]?.replace(/\s+/g, " ") === value)
      .flatMap((rule) => rule.selectors);
  }

  const eased = rules(allCss).find((rule) => rule.selectors.includes(".template-chip") && rule.declarations.transition);
  const instantPress = groupDeclaring("transition", "none");

  test("the shared block covers the controls people touch most", () => {
    // Chips, rows and tabs used to change colour between two frames. Sampled
    // rather than exhaustive: the point is that this block is where they all
    // agree, not that this exact list is frozen.
    for (const selector of [".payer-chip", ".template-chip", ".profile-tab", ".soft-tab", ".record-dialog-row"]) {
      expect(eased?.selectors).toContain(selector);
    }

    const declaration = eased?.declarations.transition ?? "";
    expect(declaration).toContain("color");
    expect(declaration).toContain("background-color");
  });

  test("every one of them with a press state keeps the press instant", () => {
    // The dip has to land the moment a finger does; only the release is eased.
    // Derived, not typed twice: add a control to the block above and forget the
    // opt-out below, and its press dip starts easing IN - which reads as lag on
    // exactly the interaction that must feel immediate.
    const hasPressState = new Set(
      rules(allCss)
        .flatMap((rule) => rule.selectors)
        .filter((selector) => selector.endsWith(":active"))
        .map((selector) => selector.slice(0, -":active".length)),
    );

    const missing = (eased?.selectors ?? [])
      .filter((selector) => hasPressState.has(selector))
      .filter((selector) => !instantPress.includes(`${selector}:active`));

    expect(missing).toEqual([]);
  });

  test("reduced motion drops the movement and keeps the colour", () => {
    const calm = insideAtRule(allCss, "prefers-reduced-motion");
    const declaration = ruleFor(calm, ".template-chip").transition ?? "";

    expect(declaration).toContain("color");
    expect(declaration).not.toContain("transform");

    // And it has to cover the same controls. Two lists that must agree is the
    // shape of a drift bug: add a chip above, forget it here, and the one
    // person who asked for less movement is the only one who still gets it.
    const calmed = rules(calm).find((rule) => rule.selectors.includes(".template-chip"));
    expect(calmed?.selectors.slice().sort()).toEqual(eased?.selectors.slice().sort());
  });

  test("the profile tab underline can travel, because every tab has one", () => {
    // It used to exist only on the selected tab, so it could appear and vanish
    // and nothing else. Drawn on all of them at scaleX(0), switching tabs grows
    // one and shrinks the other.
    const underline = ruleFor(allCss, ".profile-tab::after");

    expect(underline.content).toBeTruthy();
    expect(underline.transform).toBe("scaleX(0)");
    expect(underline.transition).toContain("transform");
    expect(ruleFor(allCss, ".profile-tab.active::after").transform).toBe("scaleX(1)");
  });
});

describe("the blur budget", () => {
  /**
   * Every element that re-blurs what is behind it, listed on purpose.
   *
   * A backdrop-filter is a full-area GPU pass, every frame, for as long as the
   * element is on screen - and this app draws an animated WebGL field behind
   * everything, so "on screen" means "always repainting". They are worth it
   * exactly where real content passes behind the glass and worthless where the
   * surface is nearly opaque over a slow gradient, which is where three of them
   * used to be (one of them per expense ROW, so a scroll re-blurred once per
   * row). Adding one back is fine - but it should be a line in this test, not a
   * line nobody noticed.
   */
  const ALLOWED = [
    ".composer-backdrop",
    ".glass-panel",
    ".mobile-tab-bar",
    ".modal-backdrop",
    ".offline-banner",
    ".side-drawer-backdrop",
    ".toast-dock",
    ':root[data-theme="light"] .glass-panel',
  ];

  test("only the layers with something behind them still blur", () => {
    const blurring = rules(allCss)
      .filter((rule) => (rule.declarations["backdrop-filter"] ?? "none") !== "none")
      .flatMap((rule) => rule.selectors);

    expect(blurring.slice().sort()).toEqual(ALLOWED.slice().sort());
  });

  test("the home list rows in particular do not", () => {
    // The one that scaled with the amount of data on screen.
    expect(ruleFor(allCss, ".pizo-expense-row")["backdrop-filter"]).toBeUndefined();
    expect(ruleFor(allCss, ':root[data-theme="light"] .pizo-expense-row')["backdrop-filter"]).toBeUndefined();
  });
});
