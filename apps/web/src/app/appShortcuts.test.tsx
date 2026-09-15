// @vitest-environment jsdom
import { configure, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fakeApi, group, groupDetail, renderApp, signIn, stubBrowser } from "./appTestHarness";
import { isTypingTarget, matchAppShortcut } from "./appShortcuts.keys";
import { UI_TEXT } from "./uiText";

configure({ asyncUtilTimeout: 4_000 });
vi.setConfig({ testTimeout: 20_000 });

const app = UI_TEXT.app;

/**
 * `n` for a new expense and `/` for search.
 *
 * The shortcuts are two lines; the rest of this file is the part that matters.
 * A bare unmodified letter is a character somebody is probably trying to type,
 * and every test below is one way of telling those two apart.
 */

describe("what counts as a shortcut", () => {
  test("a bare n and a bare slash", () => {
    expect(matchAppShortcut({ key: "n" })).toBe("newExpense");
    expect(matchAppShortcut({ key: "/" })).toBe("focusSearch");
  });

  test("Caps Lock does not make somebody invisible", () => {
    expect(matchAppShortcut({ key: "N" })).toBe("newExpense");
  });

  test("anything else is not ours", () => {
    for (const key of ["a", "Enter", "Escape", "ArrowDown", " ", "?"]) {
      expect(matchAppShortcut({ key })).toBeNull();
    }
  });

  test("modifiers belong to the browser and the OS", () => {
    // Ctrl+N is a new window. Taking it would be worse than having no
    // shortcut at all.
    expect(matchAppShortcut({ key: "n", ctrlKey: true })).toBeNull();
    expect(matchAppShortcut({ key: "n", metaKey: true })).toBeNull();
    expect(matchAppShortcut({ key: "n", altKey: true })).toBeNull();
    expect(matchAppShortcut({ key: "/", metaKey: true })).toBeNull();
  });

  test("Shift is allowed, because / needs it on plenty of layouts", () => {
    expect(matchAppShortcut({ key: "/", shiftKey: true } as never)).toBe("focusSearch");
  });

  test("never mid-composition — 「拿鐵」 starts with an n", () => {
    // Three spellings because the engines disagree: Chrome reports key
    // "Process", the others set isComposing, and older ones only ever set
    // keyCode 229.
    expect(matchAppShortcut({ key: "n", isComposing: true })).toBeNull();
    expect(matchAppShortcut({ key: "Process" })).toBeNull();
    expect(matchAppShortcut({ key: "n", keyCode: 229 })).toBeNull();
  });
});

describe("what counts as typing", () => {
  const el = (tag: string, contentEditable = false) => {
    const node = document.createElement(tag);
    if (contentEditable) Object.defineProperty(node, "isContentEditable", { value: true });
    return node;
  };

  test("an input, a textarea and a select", () => {
    // A <select> counts: type-ahead inside an open dropdown is somebody
    // choosing 餐飲, not asking for a new expense.
    for (const tag of ["input", "textarea", "select"]) {
      expect(isTypingTarget(el(tag))).toBe(true);
      expect(matchAppShortcut({ key: "n", target: el(tag) })).toBeNull();
    }
  });

  test("and anything contenteditable", () => {
    expect(isTypingTarget(el("div", true))).toBe(true);
    expect(matchAppShortcut({ key: "/", target: el("div", true) })).toBeNull();
  });

  test("but not a button, a div, or nothing at all", () => {
    expect(isTypingTarget(el("button"))).toBe(false);
    expect(isTypingTarget(el("div"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
    expect(matchAppShortcut({ key: "n", target: el("button") })).toBe("newExpense");
  });
});

describe("pressed for real", () => {
  beforeEach(() => stubBrowser());

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function landOnGroup() {
    signIn();
    fakeApi([
      { route: "GET /groups", body: { groups: [group()] } },
      { route: "GET /groups/group_1", body: groupDetail() },
      { route: "POST /groups/group_1/expenses", body: { expense: { id: "exp_new" } } },
    ]);
    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));
    // The pathname changes as soon as the group is selected - before its
    // detail has necessarily loaded, and with it the useAppShortcuts effect
    // that attaches the very listener these tests fire a keydown at. Wait for
    // the home card itself (present regardless of loading/empty state) so
    // the keydown below is not racing that effect.
    await waitFor(() => expect(document.getElementById("group-home")).toBeTruthy());
  }

  test("n opens the composer", async () => {
    await landOnGroup();

    fireEvent.keyDown(document.body, { key: "n" });

    expect(await screen.findByLabelText(app.amount)).toBeTruthy();
  });

  test("/ opens the records sheet with the cursor in the search box", async () => {
    await landOnGroup();

    fireEvent.keyDown(document.body, { key: "/" });

    const search = await screen.findByLabelText(UI_TEXT.records.searchLabel);
    await waitFor(() => expect(document.activeElement).toBe(search));
  });

  test("/ again, with the sheet already open, puts the cursor back", async () => {
    await landOnGroup();

    fireEvent.keyDown(document.body, { key: "/" });
    const search = await screen.findByLabelText(UI_TEXT.records.searchLabel);
    await waitFor(() => expect(document.activeElement).toBe(search));

    // Click away, then ask again. A boolean prop would already be true here and
    // this is why the signal is a counter.
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).not.toBe(search);

    fireEvent.keyDown(document.body, { key: "/" });
    await waitFor(() => expect(document.activeElement).toBe(search));
  });

  test("typing n into a field types an n", async () => {
    await landOnGroup();
    fireEvent.keyDown(document.body, { key: "n" });
    const title = await screen.findByLabelText(app.title);

    // The composer is open. Pressing n in its title must not re-open it or do
    // anything at all.
    fireEvent.keyDown(title, { key: "n" });

    expect(screen.getByLabelText(app.title)).toBe(title);
  });

  test("and the shortcut is off entirely while the composer is up", async () => {
    await landOnGroup();
    fireEvent.keyDown(document.body, { key: "n" });
    await screen.findByLabelText(app.amount);

    // Even from the body: the keystroke belongs to whatever is on top.
    fireEvent.keyDown(document.body, { key: "/" });

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(screen.queryByLabelText(UI_TEXT.records.searchLabel)).toBeNull();
  });

  test("nothing happens before there is a group to record against", async () => {
    signIn();
    fakeApi([{ route: "GET /groups", body: { groups: [] } }]);
    renderApp();
    await screen.findByText("建立或加入一個群組");

    fireEvent.keyDown(document.body, { key: "n" });

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(screen.queryByLabelText(app.amount)).toBeNull();
  });

  test("the shortcut is advertised somewhere a mouse user will find it", async () => {
    await landOnGroup();

    // A shortcut nobody knows about is worth nothing. The FAB is desktop-only
    // (inert on mobile), which is exactly the audience.
    const fab = document.querySelector(".floating-action");
    expect(fab?.getAttribute("title")).toBe(app.addExpenseShortcutHint);
    expect(app.addExpenseShortcutHint).toMatch(/N/);
  });
});
