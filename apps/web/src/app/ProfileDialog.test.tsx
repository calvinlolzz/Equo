// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ProfileDialog } from "./ProfileDialog";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.profile;

function renderDialog(props: Partial<Parameters<typeof ProfileDialog>[0]> = {}) {
  const onToggleTheme = vi.fn();

  const view = render(
    <ProfileDialog
      profile={{ name: "Alice" }}
      session={null}
      infoDialog={null}
      onOpenInfoDialog={() => {}}
      theme="dark"
      onToggleTheme={onToggleTheme}
      onClose={() => {}}
      onSave={() => {}}
      onToast={() => {}}
      onLogout={() => {}}
      onDeleteAccount={async () => {}}
      onFeedback={() => {}}
      {...props}
    />,
  );

  return { view, onToggleTheme };
}

async function openOtherTab() {
  fireEvent.click(screen.getByRole("tab", { name: text.otherTab }));
  return screen.findByText(text.languageSetting);
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the 其他設定 rows", () => {
  test("the theme row shows which mode is on and flips it", async () => {
    const { onToggleTheme } = renderDialog({ theme: "dark" });
    await openOtherTab();

    const row = screen.getByRole("button", { name: new RegExp(text.themeSetting) });
    expect(within(row).getByText(text.themeDark)).toBeTruthy();

    fireEvent.click(row);
    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });

  test("the theme row follows the value it is given, so both entry points agree", async () => {
    renderDialog({ theme: "light" });
    await openOtherTab();

    const row = screen.getByRole("button", { name: new RegExp(text.themeSetting) });
    expect(within(row).getByText(text.themeLight)).toBeTruthy();
  });

  test("the language row reports, and is not a control", async () => {
    renderDialog();
    const label = await openOtherTab();

    // There is one language, so a button here would be something you can press
    // that does nothing - which is what this row used to be.
    expect(screen.queryByRole("button", { name: new RegExp(text.languageSetting) })).toBeNull();
    expect(label.closest("button")).toBeNull();
    expect(screen.getByText(text.languageValue)).toBeTruthy();
  });

  test("still offers the rows that do go somewhere", async () => {
    renderDialog();
    await openOtherTab();

    for (const label of [text.feedbackEntry, text.privacyPolicy, text.termsOfService]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeTruthy();
    }
  });

  test("the delete-account row only exists for a signed-in account", async () => {
    renderDialog();
    await openOtherTab();
    expect(screen.queryByRole("button", { name: new RegExp(text.deleteAccount) })).toBeNull();

    cleanup();
    renderDialog({
      session: {
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        user: { id: "user_alice", email: "alice@example.com", displayName: "Alice" },
      },
    });
    await openOtherTab();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: new RegExp(text.deleteAccount) })).toBeTruthy(),
    );
  });
});
