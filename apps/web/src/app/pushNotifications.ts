import { ACTIVE_LOCALE, UI_TEXT } from "./uiText";

/**
 * Browser-side web push: what this device can do, and how to turn it on.
 *
 * The support story is genuinely three-way and worth spelling out, because
 * "notifications are not available" would be wrong advice on two of the three:
 *
 * - Chromium/Firefox on desktop and Android: works in a normal tab.
 * - iOS 16.4+: works ONLY once the site has been added to the home screen.
 *   Until then `window.PushManager` does not exist, and no amount of asking
 *   will produce it - the user has to install first.
 * - Everything older, and every in-app webview: no path at all.
 */

export type PushSupport = "supported" | "needs-install" | "unsupported";

/**
 * The state the toggle renders.
 *
 * `unavailable` is the server's answer, not the browser's: a deployment with
 * no VAPID key configured cannot deliver anything, and offering the switch
 * would promise something that silently never arrives.
 */
export type PushState =
  | "loading"
  | "unsupported"
  | "needs-install"
  | "unavailable"
  | "denied"
  | "off"
  | "on";

function isStandalone(): boolean {
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia("(display-mode: standalone)").matches;
}

function isIos(): boolean {
  const ua = window.navigator.userAgent;
  return (
    /iphone|ipad|ipod/i.test(ua) ||
    // iPadOS 13+ reports as a Mac; the touch points give it away.
    (/macintosh/i.test(ua) && window.navigator.maxTouchPoints > 1)
  );
}

export function detectPushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";

  const hasApi = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  if (hasApi) return "supported";
  // An iPhone that has not installed the app yet is the one case where the
  // missing API is fixable by the user, so it gets its own answer.
  if (isIos() && !isStandalone()) return "needs-install";

  return "unsupported";
}

/**
 * The VAPID public key as `applicationServerKey` wants it: raw bytes, from the
 * base64url text the server serves.
 */
export function decodeVapidKey(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  // Explicit ArrayBuffer, not the default ArrayBufferLike: applicationServerKey
  // takes a BufferSource, which excludes a SharedArrayBuffer-backed view.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));

  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }

  return bytes;
}

/**
 * Resolve `promise`, or give up after `ms` and answer null.
 *
 * Exists for `navigator.serviceWorker.ready`, which is a promise that resolves
 * when a worker becomes active and OTHERWISE NEVER SETTLES - it does not
 * reject, it does not time out. Awaiting it bare means a registration that
 * silently failed (a private window, a blocked SW, a botched update) leaves the
 * switch spinning forever with nothing on screen to explain it.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), ms);
    }),
  ]);
}

/** How long to wait for an active service worker before treating it as absent. */
export const SERVICE_WORKER_READY_TIMEOUT_MS = 8_000;

export function readyServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return Promise.resolve(null);
  }
  return withTimeout(navigator.serviceWorker.ready, SERVICE_WORKER_READY_TIMEOUT_MS);
}

export type SerializedSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  user_agent: string;
  /**
   * What language to write this device's notifications in.
   *
   * Sent with the subscription rather than synced as a setting: the browser
   * re-subscribes whenever the permission or the key changes, and the language
   * picker reloads the page, so this rides along on a request that already has
   * to happen. A device that has never sent it keeps getting 繁體中文.
   */
  locale: string;
};

function encodeKey(subscription: PushSubscription, name: "p256dh" | "auth"): string {
  const key = subscription.getKey(name);
  if (!key) return "";
  // btoa over the raw bytes, then to base64url - the encoding RFC 8291 and
  // every push library expect.
  return window
    .btoa(String.fromCharCode(...new Uint8Array(key)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** The wire shape of a PushSubscription; `toJSON()` is not reliable across browsers. */
export function serializeSubscription(subscription: PushSubscription): SerializedSubscription {
  return {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: encodeKey(subscription, "p256dh"),
      auth: encodeKey(subscription, "auth"),
    },
    user_agent: window.navigator.userAgent,
    locale: ACTIVE_LOCALE,
  };
}

/**
 * Where this device actually stands, checked in the order that produces the
 * most useful answer:
 *
 * 1. the browser (no APIs = nothing else matters, and iPhone gets its own
 *    fixable answer);
 * 2. the server (a deployment with no key cannot deliver, so saying "off"
 *    would invite a switch that does nothing);
 * 3. the permission, then whether this browser is actually subscribed.
 *
 * Every dependency is injectable because none of them exist in jsdom.
 */
export async function detectPushSubscriptionState({
  fetchPublicKey,
  support = detectPushSupport(),
  permission = typeof Notification === "undefined" ? "default" : Notification.permission,
  getSubscription = async () => (await readyServiceWorker())?.pushManager.getSubscription() ?? null,
}: {
  fetchPublicKey: () => Promise<{ enabled: boolean; public_key?: string }>;
  support?: PushSupport;
  permission?: NotificationPermission;
  getSubscription?: () => Promise<PushSubscription | null>;
}): Promise<PushState> {
  if (support !== "supported") return support;

  const key = await fetchPublicKey();
  if (!key.enabled) return "unavailable";

  if (permission === "denied") return "denied";
  if (permission !== "granted") return "off";

  // Granted once, but the subscription can still be gone: browsers drop them
  // when storage is cleared, and permission survives that.
  const subscription = await getSubscription();
  return subscription ? "on" : "off";
}

/**
 * What the toggle should say. Kept next to the state it describes so a new
 * state cannot be added without deciding what it tells the user.
 */
export function describePushState(state: PushState): string {
  switch (state) {
    case "on":
      return UI_TEXT.pushSetting.on;
    case "off":
      return UI_TEXT.pushSetting.off;
    case "denied":
      return UI_TEXT.pushSetting.blocked;
    case "needs-install":
      return UI_TEXT.pushSetting.iosNeedsInstall;
    case "unavailable":
      return UI_TEXT.pushSetting.unsupportedSite;
    case "unsupported":
      return UI_TEXT.pushSetting.unsupportedBrowser;
    case "loading":
      return UI_TEXT.pushSetting.checking;
  }
}
