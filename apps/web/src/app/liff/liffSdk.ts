/**
 * The only importer of @line/liff, and the test seam for it: everything else
 * (liffBoot, LiffApp) talks to this narrow type, so tests drive a fake and the
 * real SDK is never loaded outside a browser inside /liff.
 *
 * Loaded with a dynamic import, so the SDK is a chunk of its own that nobody
 * outside /liff ever downloads.
 */
export type LiffSdk = {
  init(options: { liffId: string }): Promise<void>;
  isLoggedIn(): boolean;
  isInClient(): boolean;
  login(options?: { redirectUri?: string }): void;
  logout(): void;
  getIDToken(): string | null;
  closeWindow(): void;
  openWindow(options: { url: string; external: boolean }): void;
};

export async function loadLiffSdk(): Promise<LiffSdk> {
  const { default: liff } = await import("@line/liff");
  return {
    init: (options) => liff.init(options),
    isLoggedIn: () => liff.isLoggedIn(),
    isInClient: () => liff.isInClient(),
    login: (options) => liff.login(options),
    logout: () => liff.logout(),
    getIDToken: () => liff.getIDToken(),
    closeWindow: () => liff.closeWindow(),
    openWindow: (options) => liff.openWindow(options),
  };
}
