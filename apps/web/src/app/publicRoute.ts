/**
 * The pages that render without a session.
 *
 * The privacy policy and the terms used to exist only as a sheet inside the
 * profile dialog, which put them behind the login wall: a Google OAuth review,
 * an app directory, or anybody deciding whether to hand over their account had
 * no URL to open. These two paths serve the same documents as standalone pages
 * that need no session and no API call.
 *
 * Deliberately a pure function over a pathname rather than a router: main.tsx
 * picks one of three trees at boot (console / legal page / app), and this is
 * the whole vocabulary of the middle one.
 */
export type PublicPage = "privacy" | "terms";

/**
 * Trailing slashes are stripped and case is ignored, because both spellings get
 * typed and linked in the wild — /Privacy/ has to land on the policy rather
 * than on the app shell, or the "publicly reachable URL" this exists for stops
 * being reliably reachable.
 */
export function resolvePublicPage(pathname: string): PublicPage | null {
  const path = pathname.replace(/\/+$/, "").toLowerCase();

  if (path === "/privacy") return "privacy";
  if (path === "/terms") return "terms";

  return null;
}
