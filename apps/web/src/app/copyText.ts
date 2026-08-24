/**
 * Copy a string to the clipboard, reporting whether it actually happened.
 *
 * The obvious one-liner is wrong in a way that fails silently:
 *
 *   await navigator.clipboard?.writeText(value)
 *
 * When the Clipboard API is absent — a non-secure context, an old in-app
 * browser — the optional chain yields `undefined`, `await undefined` resolves,
 * and the caller cheerfully reports "已複製" having copied nothing. The user
 * pastes their previous clipboard contents into a bank transfer form. So the
 * presence of the API is checked rather than optional-chained.
 */
export async function copyText(value: string): Promise<boolean> {
  if (!value) return false;

  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;

  if (!clipboard?.writeText) return false;

  try {
    await clipboard.writeText(value);
    return true;
  } catch {
    // Denied permission, or a browser that refuses outside a user gesture.
    return false;
  }
}
