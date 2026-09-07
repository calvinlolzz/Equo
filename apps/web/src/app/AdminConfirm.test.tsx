// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AdminConfirmProvider, typedMatches, useAdminConfirm } from "./AdminConfirm";
import { readAppFile } from "./cssDeclarations";

afterEach(cleanup);

/** A button that asks, and reports what it was told. */
function Asker({ request, onAnswer }: { request: Parameters<ReturnType<typeof useAdminConfirm>>[0]; onAnswer: (ok: boolean) => void }) {
  const confirm = useAdminConfirm();
  return (
    <button type="button" onClick={async () => onAnswer(await confirm(request))}>
      去做
    </button>
  );
}

function ask(request: Parameters<ReturnType<typeof useAdminConfirm>>[0]) {
  const onAnswer = vi.fn();
  render(
    <AdminConfirmProvider>
      <Asker request={request} onAnswer={onAnswer} />
    </AdminConfirmProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "去做" }));
  return onAnswer;
}

const buttons = (dialog: HTMLElement) => within(dialog).getAllByRole("button") as HTMLButtonElement[];
const affirmative = (dialog: HTMLElement) => buttons(dialog).at(-1) as HTMLButtonElement;

describe("the console's confirm", () => {
  test("resolves true only when the affirmative is pressed", async () => {
    const onAnswer = ask({ title: "刪掉？" });
    fireEvent.click(affirmative(await screen.findByRole("alertdialog")));

    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(true));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  test("resolves false on cancel, rather than leaving the caller waiting", async () => {
    const onAnswer = ask({ title: "刪掉？" });
    fireEvent.click(buttons(await screen.findByRole("alertdialog"))[0]);

    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(false));
  });

  test("Escape is a no", async () => {
    const onAnswer = ask({ title: "刪掉？" });
    await screen.findByRole("alertdialog");

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(false));
  });

  test("says what will happen, not just that something will", async () => {
    ask({ title: "刪掉？", body: "群組會從所有成員的列表消失。" });
    const dialog = await screen.findByRole("alertdialog");

    expect(dialog.textContent).toContain("群組會從所有成員的列表消失。");
    // Named for a screen reader by the question it is asking.
    expect(dialog.getAttribute("aria-label")).toBe("刪掉？");
  });
});

describe("the type-to-confirm guard", () => {
  test("keeps the affirmative disabled until the text matches", async () => {
    const onAnswer = ask({ title: "刪除帳號？", typeToConfirm: "alice@example.com" });
    const dialog = await screen.findByRole("alertdialog");

    expect(affirmative(dialog).disabled).toBe(true);

    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "bob@example.com" } });
    expect(affirmative(dialog).disabled).toBe(true);
    // A wrong answer is refused HERE. window.prompt could only accept it,
    // close, and report 「email 不符」 afterwards.
    fireEvent.click(affirmative(dialog));
    expect(onAnswer).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "alice@example.com" } });
    expect(affirmative(dialog).disabled).toBe(false);
  });

  test("reads the typed text the way the old guards did", () => {
    expect(typedMatches("alice@example.com", "  ALICE@Example.com ")).toBe(true);
    expect(typedMatches("alice@example.com", "alice@example.co")).toBe(false);
    expect(typedMatches("alice@example.com", "")).toBe(false);
    // No requirement means nothing to satisfy.
    expect(typedMatches(undefined, "")).toBe(true);
  });

  test("Enter submits once the box is right, and does nothing before", async () => {
    const onAnswer = ask({ title: "刪除帳號？", typeToConfirm: "alice@example.com" });
    const dialog = await screen.findByRole("alertdialog");
    const box = within(dialog).getByRole("textbox");

    fireEvent.keyDown(box, { key: "Enter" });
    expect(onAnswer).not.toHaveBeenCalled();

    fireEvent.change(box, { target: { value: "alice@example.com" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(true));
  });
});

describe("nothing in the console asks the browser any more", () => {
  test("no window.confirm, no window.prompt", () => {
    // Two reasons they went: a browser dialog cannot refuse a wrong answer, and
    // Chrome's "prevent this page from creating additional dialogs" makes every
    // later confirm() return false - the operator presses 刪除, nothing happens,
    // and nothing says why.
    const source = readAppFile("AdminApp.tsx");
    expect(source).not.toContain("window.confirm");
    expect(source).not.toContain("window.prompt");
  });
});
