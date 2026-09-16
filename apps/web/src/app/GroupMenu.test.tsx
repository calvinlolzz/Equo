// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { GroupMenu } from "./GroupMenu";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

function renderMenu(overrides: Partial<ComponentProps<typeof GroupMenu>> = {}) {
  return render(
    <GroupMenu
      groupName="東京旅行"
      memberCount={4}
      currency="TWD"
      isOwner
      onExportCsv={() => {}}
      onEditGroup={() => {}}
      onNavigate={() => {}}
      onArchive={() => {}}
      onDelete={() => {}}
      {...overrides}
    />,
  );
}

afterEach(cleanup);

describe("the desktop ▾ menu's own open/close chrome", () => {
  test("closed by default, and the trigger names itself without pointing at a popover that does not exist yet", () => {
    renderMenu();

    const trigger = screen.getByRole("button", { name: text.groupManage });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    // aria-controls must not dangle: the id it would point at is only
    // mounted once open.
    expect(trigger.hasAttribute("aria-controls")).toBe(false);
    expect(screen.queryByRole("button", { name: text.records })).toBeNull();
  });

  test("clicking the trigger opens it and moves focus inside", () => {
    renderMenu();

    fireEvent.click(screen.getByRole("button", { name: text.groupManage }));

    const trigger = screen.getByRole("button", { name: text.groupManage });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.hasAttribute("aria-controls")).toBe(true);
    expect(screen.getByRole("button", { name: text.records })).toBeTruthy();
    // The first row, not the trigger — the keyboard path in should land you
    // somewhere useful, the same way opening any disclosure/dialog in this
    // app does.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: text.groupHome }));
  });

  test("Escape closes it and returns focus to the trigger", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: text.groupManage });
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: text.records })).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("button", { name: text.records })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test("a pointerdown outside closes it and also returns focus to the trigger", () => {
    // Regression guard: the popover always holds focus while open (see
    // above), so closing it via an outside click without restoring focus
    // would drop focus to <body> and Tab would restart from the top of the
    // document — a real loss for a keyboard user, not just untidy.
    renderMenu();
    const trigger = screen.getByRole("button", { name: text.groupManage });
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: text.records })).toBeTruthy();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole("button", { name: text.records })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test("a pointerdown inside the popover does not close it", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: text.groupManage }));

    fireEvent.pointerDown(screen.getByRole("button", { name: text.records }));

    expect(screen.getByRole("button", { name: text.records })).toBeTruthy();
  });

  test("does not leak its document-level listeners once closed", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    renderMenu();

    fireEvent.click(screen.getByRole("button", { name: text.groupManage }));
    fireEvent.keyDown(document, { key: "Escape" });

    const added = addSpy.mock.calls.filter(([type]) => type === "pointerdown" || type === "keydown").length;
    const removed = removeSpy.mock.calls.filter(([type]) => type === "pointerdown" || type === "keydown").length;
    expect(removed).toBe(added);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});

describe("picking something in the popover", () => {
  test("closes it and calls the handler", () => {
    const onNavigate = vi.fn();
    renderMenu({ onNavigate });
    fireEvent.click(screen.getByRole("button", { name: text.groupManage }));

    fireEvent.click(screen.getByRole("button", { name: text.records }));

    expect(onNavigate).toHaveBeenCalledWith("records");
    expect(screen.queryByRole("button", { name: text.records })).toBeNull();
  });

  test("exporting closes it too, even though GroupSideNav's own onExportCsv does not call onBeforeNavigate", () => {
    const onExportCsv = vi.fn();
    renderMenu({ onExportCsv });
    fireEvent.click(screen.getByRole("button", { name: text.groupManage }));

    fireEvent.click(screen.getByRole("button", { name: text.exportCsv }));

    expect(onExportCsv).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: text.exportCsv })).toBeNull();
  });
});
