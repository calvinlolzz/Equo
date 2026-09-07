// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { readAppStylesheet, ruleFor } from "./cssDeclarations";
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

/**
 * The four rows read as one list.
 *
 * They are two elements — a <nav> of destinations and a plain block holding a
 * fact (幣別) and an action (匯出 CSV) — and while they were two CHILDREN of the
 * drawer, the drawer's own 16px gap fell between them while the rows inside
 * each were 9px apart. Measured in the browser: 9 / 16 / 9, which does not read
 * as a deliberate separator, only as a list that has come apart. The rows were
 * different heights too, 58px against 52px.
 */
describe("the settings drawer's rows are evenly spaced", () => {
  const homeCss = readAppStylesheet("app-home.css");

  test("the destinations and the settings share one wrapper", () => {
    const { container } = renderNav("drawer");
    const lists = container.querySelector(".side-lists");

    expect(lists).toBeTruthy();
    // Both halves inside it, so the drawer's gap can no longer land between.
    expect(lists?.querySelector(".side-nav-list")).toBeTruthy();
    expect(lists?.querySelector(".side-settings-list")).toBeTruthy();
  });

  test("that wrapper spaces its two halves the way each spaces its own rows", () => {
    const gap = ruleFor(homeCss, ".side-nav-list").gap;
    expect(gap).toBeTruthy();
    expect(ruleFor(homeCss, ".side-settings-list").gap).toBe(gap);
    expect(ruleFor(homeCss, ".side-lists").gap).toBe(gap);
  });

  test("and every row is the same height", () => {
    const navRow = ruleFor(homeCss, ".side-nav-item")["min-height"];
    expect(navRow).toBeTruthy();
    expect(ruleFor(homeCss, ".side-settings-row")["min-height"]).toBe(navRow);
  });

  test("the drawer's row tracks match what it now contains", () => {
    // cover, the list block, then the flexible track the danger pair sits at
    // the bottom of. A fourth track would put a gap back in the middle.
    expect(ruleFor(homeCss, ".side-drawer-right")["grid-template-rows"]).toBe("auto auto 1fr");
  });

  test("navigation is still marked as navigation, not flattened into one box", () => {
    const { container } = renderNav("drawer");

    // The wrapper is presentational; the semantics stay where they were.
    expect(container.querySelector("nav.side-nav-list")).toBeTruthy();
    expect(container.querySelector("nav .side-settings-row")).toBeNull();
  });
});

/**
 * iOS Safari centres a datetime-local's value inside its box, so 日期 floated
 * in the middle of a full-width field while the title placeholder and the 分類
 * select above it started at the padding edge. Chrome left-aligns it already,
 * which is why this only ever showed on a phone — and why it is asserted
 * against the stylesheet rather than a rendered box.
 */
describe("the date field is aligned like the fields around it", () => {
  const baseCss = readAppStylesheet("app-base.css");

  test("the input says left", () => {
    expect(ruleFor(baseCss, 'input[type="datetime-local"]')["text-align"]).toBe("left");
  });

  test("and so does the shadow-DOM value, which is the one that was centred", () => {
    const rule = ruleFor(baseCss, 'input[type="datetime-local"]::-webkit-date-and-time-value');
    expect(rule["text-align"]).toBe("left");
    // Its own margin would re-centre it inside the input.
    expect(rule.margin).toBe("0");
  });
});
