// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { stubBrowser } from "./appTestHarness";
import { ExpenseComposerSheet } from "./ExpenseComposerSheet";
import { insideAtRule, readAppStylesheet, ruleFor } from "./cssDeclarations";
import { UI_TEXT } from "./uiText";

/**
 * Fix 3: above 620px the composer used to still be a bottom sheet pinned to
 * the screen's bottom edge, with the drag handle showing even though there
 * is nothing to drag with a mouse. It is now a centred dialog, matching
 * .flow-dialog/.panel-dialog's own desktop treatment.
 */

const composerCss = readAppStylesheet("app-composer.css");
const desktopCss = insideAtRule(composerCss, "min-width: 621px");

describe("the composer above 620px", () => {
  test("the backdrop centres the dialog instead of pinning it to the bottom", () => {
    expect(ruleFor(desktopCss, ".composer-backdrop")["align-items"]).toBe("center");
  });

  test("the footer stays put while the form body scrolls", () => {
    expect(ruleFor(desktopCss, ".composer-form-footer").flex).toBe("0 0 auto");
    const body = ruleFor(desktopCss, ".composer-form-body");
    const overflow = `${body.overflow ?? ""} ${body["overflow-y"] ?? ""} ${body["overflow-x"] ?? ""}`;
    expect(overflow).toContain("hidden");
  });

  test("the drag handle is hidden - nothing here can be dragged with a mouse", () => {
    expect(ruleFor(desktopCss, ".expense-composer .sheet-drag-handle").display).toBe("none");
  });
});

beforeEach(() => stubBrowser({ mobile: false }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a desktop render of the composer", () => {
  const soloMember = [{ id: "member_me", name: "我" }];

  test("wraps the footer's submit button in .composer-form-footer", () => {
    render(
      <ExpenseComposerSheet
        members={soloMember}
        currentMemberId="member_me"
        groupId="ledger_1"
        groupCurrency="TWD"
        currencyOptions={[{ code: "TWD", label: "台幣" }]}
        personal
        onClose={() => {}}
        onSubmit={() => {}}
      />,
    );

    const submit = screen.getByRole("button", { name: UI_TEXT.composerSubmit.addExpense });
    expect(submit.closest(".composer-form-footer")).toBeTruthy();
  });
});
