/**
 * The invite token carried by a scanned QR payload, or "" when the payload is
 * not one of ours.
 *
 * Deliberately not in inviteQr.ts: App.tsx needs this on the scan path,
 * and importing it from there would drag the QR *encoder* into the entry
 * chunk for every visitor who never opens the invite sheet.
 *
 * Accepts both what we generate (a full https://…/?invite=TOKEN link) and a
 * bare code typed or printed on its own, because a user scanning a code has no
 * way to know which of the two the other phone is showing. Anything else — a
 * wifi QR, a URL to somewhere else — is rejected rather than shoved into the
 * invite field, where it would fail with a confusing "invite not found".
 */
export function readInviteToken(payload: string): string {
  const trimmed = payload.trim();
  if (!trimmed) return "";

  if (/^[A-Za-z0-9]{6,32}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  try {
    const url = new URL(trimmed);
    const token = url.searchParams.get("invite")?.trim() ?? "";
    return /^[A-Za-z0-9]{6,32}$/.test(token) ? token.toUpperCase() : "";
  } catch {
    return "";
  }
}
