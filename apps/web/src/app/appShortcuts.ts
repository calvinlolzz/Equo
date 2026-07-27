/**
 * PWA manifest shortcuts (long-press the home-screen icon). The manifest points
 * them at `/?shortcut=<action>`; this reads the intent back out.
 *
 * Kept honest: every action listed in site.webmanifest must be handled here.
 * A shortcut labelled 新增支出 that merely opened the app would be the same
 * kind of dead entry as the placeholder rows removed elsewhere.
 */
export type ShortcutAction = "add-expense" | "join";

const ACTIONS: readonly ShortcutAction[] = ["add-expense", "join"];

/** The action named in a URL's query string, if it is one we implement. */
export function readShortcutAction(search: string): ShortcutAction | null {
  const value = new URLSearchParams(search).get("shortcut") ?? "";
  return (ACTIONS as readonly string[]).includes(value) ? (value as ShortcutAction) : null;
}

/**
 * Strips `?shortcut=` from the address bar once the intent has been consumed,
 * so a reload (or a Back that lands here) doesn't re-trigger the composer.
 * Leaves any other query parameter — notably `?invite=` — untouched.
 */
export function clearShortcutParam(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("shortcut")) return;
  url.searchParams.delete("shortcut");
  window.history.replaceState(window.history.state, document.title, `${url.pathname}${url.search}${url.hash}`);
}
