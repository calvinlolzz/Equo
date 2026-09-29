// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ProfileDialog } from "./ProfileDialog";
import { ACTIVE_LOCALE, UI_TEXT } from "./uiText";
import { LOCALES } from "./i18n/locale";

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

  test("the language row shows the current language and opens the native picker", async () => {
    renderDialog();
    const label = await openOtherTab();
    const row = label.closest(".profile-language-row") as HTMLElement;

    // Not a <button>: it never was one that did something, and a button that
    // looks pressable and only opens a picker is the shape this row used to
    // fake. The real control is a <select> laid invisibly over the whole row.
    expect(label.closest("button")).toBeNull();
    const picker = within(row).getByRole("combobox", { name: text.languageSetting }) as HTMLSelectElement;
    expect(picker.value).toBe(ACTIVE_LOCALE);
    expect([...picker.options].map((option) => option.value)).toEqual([...LOCALES]);

    // And the value a person reads is plain text in the row, like every other
    // row's value — not the select's own rendering, which is what dragged the
    // native dropdown arrows into the middle of the row on iOS.
    const shown = within(row).getAllByText(text.languageValue);
    expect(shown.some((node) => node.tagName !== "OPTION")).toBe(true);
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

describe("the LINE row", () => {
  const aliceSession = {
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    user: { id: "user_alice", email: "alice@example.com", displayName: "Alice" },
  };

  function stubLineLinkFetch(linked: boolean) {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      if (String(url).includes("/me/line")) {
        return {
          ok: true,
          json: async () => ({ linked, linked_at: linked ? "2026-09-29T00:00:00Z" : null }),
        } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    return calls;
  }

  test("is hidden when unlinked and no LINE add-friend URL is configured", async () => {
    const calls = stubLineLinkFetch(false);
    renderDialog({ session: aliceSession });

    await waitFor(() => expect(calls.some((url) => url.includes("/me/line"))).toBe(true));
    // Let the fetch's own .then() settle before asserting the row stayed absent.
    await waitFor(() => expect(screen.queryByText(UI_TEXT.lineLink.rowTitle)).toBeNull());
  });

  test("shows an unlink control when linked", async () => {
    stubLineLinkFetch(true);
    renderDialog({ session: aliceSession });

    await waitFor(() => expect(screen.getByText(UI_TEXT.lineLink.rowTitle)).toBeTruthy());
    expect(screen.getByRole("button", { name: UI_TEXT.lineLink.unlink })).toBeTruthy();
  });
});
