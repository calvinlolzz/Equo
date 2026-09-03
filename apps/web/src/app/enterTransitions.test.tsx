// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { GroupHomeSkeleton } from "./GroupHomeSkeleton";
import { StartFlow } from "./StartFlowPanel";
import { declarationsFor, insideAtRule, keyframesBody, readAppStylesheet } from "./cssDeclarations";

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
