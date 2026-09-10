// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ExpenseComposerSheet } from "./ExpenseComposerSheet";
import { readLastCategory, recentExpenseTitles, writeLastCategory } from "./composerMemory";
import type { Expense, Member } from "./appTypes";

/**
 * Four things the composer made somebody do that it already knew the answer to.
 *
 * Measured by walking the real sheet at 390×844 and at 1280×900:
 *
 * - opening it on a desktop left focus on the 支出 chip, so typing an amount
 *   straight away did nothing and every entry began with a click into the
 *   field;
 * - Enter did nothing anywhere, because the sheet is a dialog rather than a
 *   <form> and got none of that for free;
 * - the category started at 一般 every time regardless of the last twenty
 *   entries;
 * - and the title field offered nothing, in a group that had already recorded
 *   居酒屋 and 地鐵一日券.
 */

const MEMBERS: Member[] = [
  { id: "m_me", name: "我", role: "owner" },
  { id: "m_ming", name: "小明", role: "member" },
];

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "e1",
    title: "居酒屋",
    amountMinor: 240_000,
    currency: "TWD",
    createdAt: "2026-09-01T12:00:00.000Z",
    payerId: "m_me",
    shareMemberIds: ["m_me", "m_ming"],
    kind: "expense",
    category: "food",
    ...overrides,
  };
}

const CURRENCIES = [
  { code: "TWD", label: "TWD" },
  { code: "JPY", label: "JPY" },
];

/** jsdom answers every media query false, i.e. the wide layout. */
function stubViewport(phone: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: phone && /max-width/.test(query),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

function renderComposer(props: Partial<Parameters<typeof ExpenseComposerSheet>[0]> = {}) {
  const onSubmit = vi.fn();
  const result = render(
    <ExpenseComposerSheet
      members={MEMBERS}
      currentMemberId="m_me"
      groupId="g1"
      groupCurrency="TWD"
      currencyOptions={CURRENCIES}
      onClose={() => {}}
      onSubmit={onSubmit}
      {...props}
    />,
  );
  return { ...result, onSubmit };
}

beforeEach(() => {
  window.localStorage.clear();
  stubViewport(false);
  vi.stubGlobal("crypto", { randomUUID: () => "req_test" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the amount field is ready to be typed into", () => {
  test("a new entry opens with the cursor already in it", () => {
    renderComposer();

    const amount = screen.getByLabelText("金額");
    expect(document.activeElement).toBe(amount);
  });

  test("so typing an amount straight away actually lands", () => {
    const { onSubmit } = renderComposer();

    // No click first. This is the whole point.
    fireEvent.change(document.activeElement as HTMLElement, { target: { value: "1250" } });

    expect((screen.getByLabelText("金額") as HTMLInputElement).value).toBe("1,250");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("an edit does not yank focus onto the amount", () => {
    // Editing usually means changing something other than the number, and
    // stealing focus onto a filled field scrolls the sheet for no reason.
    renderComposer({ initialExpense: expense({ title: "居酒屋", category: "food" }) });

    expect(document.activeElement).not.toBe(screen.getByLabelText("金額"));
  });
});

describe("Enter moves it along", () => {
  test("on the wide layout it saves", async () => {
    const { onSubmit } = renderComposer();

    fireEvent.change(screen.getByLabelText("金額"), { target: { value: "240" } });
    fireEvent.keyDown(screen.getByLabelText("金額"), { key: "Enter" });

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  test("but never mid-composition — Enter is how an IME commits 居酒屋", async () => {
    const { onSubmit } = renderComposer();
    fireEvent.change(screen.getByLabelText("金額"), { target: { value: "240" } });

    fireEvent.keyDown(screen.getByLabelText("標題"), { key: "Enter", isComposing: true });
    fireEvent.keyDown(screen.getByLabelText("標題"), { key: "Process" });
    fireEvent.keyDown(screen.getByLabelText("標題"), { key: "Enter", keyCode: 229 });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("from any single-line field, including 備註", async () => {
    // 備註 is an <input>, not a textarea, so Enter there has no newline to be
    // and saving is what a form would have done. The TEXTAREA guard in the
    // handler is for the day one of these grows into a real multi-line field.
    const { onSubmit } = renderComposer();
    fireEvent.change(screen.getByLabelText("金額"), { target: { value: "240" } });

    fireEvent.keyDown(screen.getByLabelText("備註"), { key: "Enter" });

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  test("nor with nothing to save", async () => {
    const { onSubmit } = renderComposer();

    fireEvent.keyDown(screen.getByLabelText("金額"), { key: "Enter" });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  /**
   * The stepped layout is not only phones — a desktop window dragged narrower
   * than 620px gets it too, and that one does have a keyboard.
   *
   * ⚠️ Checked in a real browser, and it matters: after tapping the keypad,
   * focus is on a keypad BUTTON, where Enter is a click on that digit and this
   * handler correctly stands aside. So Enter advances only when it arrives
   * from somewhere that is not a button — which is what these two assert,
   * rather than a journey nobody takes.
   */
  test("when it reaches the sheet mid-flow, it advances instead of saving", async () => {
    cleanup();
    stubViewport(true);
    const { onSubmit } = renderComposer();

    fireEvent.click(screen.getByRole("button", { name: "2" }));
    fireEvent.click(screen.getByRole("button", { name: "4" }));
    fireEvent.click(screen.getByRole("button", { name: "0" }));

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });

    await screen.findByLabelText("標題");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("Enter on a keypad key stays a press of that key", async () => {
    cleanup();
    stubViewport(true);
    const { onSubmit } = renderComposer();

    const two = screen.getByRole("button", { name: "2" });
    fireEvent.click(two);
    fireEvent.keyDown(two, { key: "Enter" });

    await new Promise((resolve) => setTimeout(resolve, 20));
    // Still on the amount step, and certainly not saved.
    expect(screen.queryByLabelText("標題")).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("and on the last step, from a text field, it saves", async () => {
    cleanup();
    stubViewport(true);
    const { onSubmit } = renderComposer();

    fireEvent.click(screen.getByRole("button", { name: "2" }));
    fireEvent.click(screen.getByRole("button", { name: "4" }));
    fireEvent.click(screen.getByRole("button", { name: "0" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });

    const title = await screen.findByLabelText("標題");
    fireEvent.keyDown(title, { key: "Enter" });

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });
});

describe("the category remembers what this group uses", () => {
  test("a fresh group still starts at 一般", () => {
    renderComposer();
    expect((screen.getByLabelText("分類") as HTMLSelectElement).value).toBe("general");
  });

  test("after one 餐飲 entry, the next one starts there", async () => {
    const { onSubmit, unmount } = renderComposer();

    fireEvent.change(screen.getByLabelText("金額"), { target: { value: "240" } });
    fireEvent.change(screen.getByLabelText("分類"), { target: { value: "food" } });
    fireEvent.keyDown(screen.getByLabelText("金額"), { key: "Enter" });
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());

    unmount();
    renderComposer();
    expect((screen.getByLabelText("分類") as HTMLSelectElement).value).toBe("food");
  });

  test("it is per group, because the right default in one is wrong in another", () => {
    writeLastCategory("g1", "food");
    writeLastCategory("g2", "transport");

    expect(readLastCategory("g1")).toBe("food");
    expect(readLastCategory("g2")).toBe("transport");
    expect(readLastCategory("g3")).toBe("");
  });

  test("a category the console has since switched off falls back to 一般", () => {
    writeLastCategory("g1", "kayaking");
    renderComposer();
    // Defaulting to a category that no longer exists is worse than not
    // defaulting: the select would show a blank.
    expect((screen.getByLabelText("分類") as HTMLSelectElement).value).toBe("general");
  });

  test("editing an existing expense keeps ITS category, not the remembered one", () => {
    writeLastCategory("g1", "food");
    renderComposer({ initialExpense: expense({ title: "計程車", category: "transport" }) });
    expect((screen.getByLabelText("分類") as HTMLSelectElement).value).toBe("transport");
  });
});

describe("the title field offers what this group has called things", () => {
  test("the suggestions are attached to the field", () => {
    renderComposer({ recentTitles: ["居酒屋", "地鐵一日券"] });

    const title = screen.getByLabelText("標題") as HTMLInputElement;
    expect(title.getAttribute("list")).toBeTruthy();
    const list = document.getElementById(title.getAttribute("list") as string);
    expect([...(list?.querySelectorAll("option") ?? [])].map((option) => option.getAttribute("value"))).toEqual([
      "居酒屋",
      "地鐵一日券",
    ]);
  });

  test("no history, no dropdown — an empty datalist is a control that opens to nothing", () => {
    renderComposer({ recentTitles: [] });
    expect(screen.getByLabelText("標題").getAttribute("list")).toBeNull();
  });

  test("what is already typed is not suggested back", () => {
    renderComposer({ recentTitles: ["居酒屋"] });

    fireEvent.change(screen.getByLabelText("標題"), { target: { value: "居酒屋" } });

    expect(screen.getByLabelText("標題").getAttribute("list")).toBeNull();
  });
});

describe("which titles are worth suggesting", () => {
  const labels = new Set(["一般", "餐飲", "交通"]);

  test("newest first, no repeats", () => {
    const titles = recentExpenseTitles(
      [{ title: "居酒屋" }, { title: "拉麵" }, { title: "居酒屋" }, { title: "地鐵一日券" }],
      labels,
    );
    expect(titles).toEqual(["居酒屋", "拉麵", "地鐵一日券"]);
  });

  test("a category label is not a title — the composer writes those itself", () => {
    // submitComposer falls back to the category label when the field is blank,
    // so these are somebody's empty title coming back as a suggestion.
    expect(recentExpenseTitles([{ title: "餐飲" }, { title: "拉麵" }], labels)).toEqual(["拉麵"]);
  });

  test("blank and whitespace-only titles are dropped", () => {
    expect(recentExpenseTitles([{ title: "" }, { title: "   " }, { title: null }, { title: "拉麵" }], labels)).toEqual([
      "拉麵",
    ]);
  });

  test("capped, because a datalist is a list somebody has to read", () => {
    const many = Array.from({ length: 60 }, (_, index) => ({ title: `品項 ${index}` }));
    expect(recentExpenseTitles(many, labels)).toHaveLength(20);
    expect(recentExpenseTitles(many, labels, 5)).toHaveLength(5);
  });

  test("case-insensitive de-duplication", () => {
    expect(recentExpenseTitles([{ title: "Ramen" }, { title: "ramen" }], labels)).toEqual(["Ramen"]);
  });
});
