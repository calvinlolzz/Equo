// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { GroupSideNav } from "./GroupSideNav";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

function renderNav(variant?: "rail" | "drawer") {
  return render(
    <GroupSideNav
      variant={variant}
      groupName="東京旅行"
      memberCount={4}
      currency="TWD"
      onExportCsv={() => {}}
      isOwner
      onEditGroup={() => {}}
      onNavigate={() => {}}
      onArchive={() => {}}
      onDelete={() => {}}
    />,
  );
}

afterEach(cleanup);

describe("the group side nav", () => {
  test("the desktop rail carries the whole navigation", () => {
    // There is no bottom bar on a wide screen: this is the only way to reach
    // any of it.
    renderNav("rail");

    for (const label of [text.groupHome, text.records, text.analysis, text.members, text.recurring]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  test("the phone drawer does not repeat the bottom bar", () => {
    // 首頁, 紀錄 and 分析 are the first three buttons of the bar this drawer was
    // opened from — offering them again is offering the navigation you just
    // used.
    renderNav("drawer");

    for (const label of [text.groupHome, text.records, text.analysis]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
  });

  test("and still carries what the bar has no room for", () => {
    // The point of the drawer, and the reason it is not just deleted.
    renderNav("drawer");

    expect(screen.getByRole("button", { name: text.members })).toBeTruthy();
    expect(screen.getByRole("button", { name: text.recurring })).toBeTruthy();
    expect(screen.getByRole("button", { name: text.archiveGroup })).toBeTruthy();
    expect(screen.getByRole("button", { name: text.deleteGroup })).toBeTruthy();
  });
});

describe("the group's own settings", () => {
  test("the drawer shows the currency and offers the export", () => {
    // Both moved here from elsewhere: the currency was a readOnly input in the
    // edit dialog (a field that looked broken), and the export was a text link
    // at the bottom of 支出記錄.
    renderNav("drawer");

    expect(screen.getByText("TWD")).toBeTruthy();
    expect(screen.getByRole("button", { name: text.exportCsv })).toBeTruthy();
  });

  test("the currency is shown, not offered as a field", () => {
    // It is fixed when the group is created and every amount is denominated in
    // it — a fact about the group, not a preference.
    renderNav("drawer");

    expect(screen.queryByRole("textbox", { name: text.currency })).toBeNull();
    expect(screen.queryByRole("combobox", { name: text.currency })).toBeNull();
  });

  test("an export in flight says so and cannot be started twice", () => {
    render(
      <GroupSideNav
        variant="drawer"
        groupName="東京旅行"
        memberCount={4}
        currency="TWD"
        exporting
        onExportCsv={() => {}}
        isOwner
        onEditGroup={() => {}}
        onNavigate={() => {}}
        onArchive={() => {}}
        onDelete={() => {}}
      />,
    );

    const button = screen.getByRole("button", { name: text.processing });
    expect(button.hasAttribute("disabled")).toBe(true);
  });
});
