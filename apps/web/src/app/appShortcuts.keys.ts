/**
 * The two keyboard shortcuts the app answers to, and — mostly — the four
 * situations in which it must not.
 *
 * The app grew a full three-column desktop layout without a single key binding;
 * the operator console has had ⌘K for months. These are the two that earn their
 * place: 記一筆 is the thing the app exists for, and 搜尋 is the thing you do
 * when you are looking for one you already made.
 *
 * Single unmodified letters, which is the convention (Gmail, GitHub, Linear)
 * and also the dangerous choice — a bare `n` is a character somebody is
 * probably trying to type. Everything below is about telling those two apart,
 * and it is a pure function so each refusal can be stated as a test rather than
 * discovered in production.
 */
export type AppShortcut = "newExpense" | "focusSearch";

/**
 * Enough of a KeyboardEvent to decide. Written as a structural type so the
 * tests can state a case in one line instead of constructing a DOM event.
 */
export type ShortcutEventLike = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  target?: EventTarget | null;
};

/**
 * Whether the keystroke is going into something the user is typing in.
 *
 * The whole reason a bare letter is risky. A `<select>` counts: type-ahead
 * inside an open dropdown is somebody choosing 餐飲 by pressing ㄘ, not asking
 * for a new expense.
 */
export function isTypingTarget(target: EventTarget | null | undefined): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== "string") return false;

  const tag = element.tagName.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;

  return element.isContentEditable === true;
}

export function matchAppShortcut(event: ShortcutEventLike): AppShortcut | null {
  // Ctrl/⌘/Alt combinations belong to the browser and the OS. Ctrl+N is a new
  // window; stealing it would be worse than having no shortcut at all.
  if (event.metaKey || event.ctrlKey || event.altKey) return null;

  // Mid-composition. The same guard the composer's Enter handler and
  // useDialogChrome use: Chrome reports key "Process", the others set
  // isComposing, and older engines only ever set keyCode 229. Typing 「拿鐵」
  // starts with an `n`, and opening a sheet on top of the IME candidate window
  // would be the single most irritating bug this file could ship.
  if (event.isComposing || event.key === "Process" || event.keyCode === 229) return null;

  if (isTypingTarget(event.target)) return null;

  // Shift is not checked: `/` needs it on plenty of layouts, and Caps Lock
  // turning `n` into `N` is not a reason to ignore somebody.
  if (event.key.toLowerCase() === "n") return "newExpense";
  if (event.key === "/") return "focusSearch";

  return null;
}
