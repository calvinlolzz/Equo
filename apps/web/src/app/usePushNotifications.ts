import { useCallback, useEffect, useRef, useState } from "react";
import { createApiClient } from "./apiClient";
import {
  decodeVapidKey,
  detectPushSubscriptionState,
  detectPushSupport,
  readyServiceWorker,
  serializeSubscription,
  type PushState,
} from "./pushNotifications";

/**
 * The notification switch.
 *
 * Three separate systems have to agree before this can say "on": the browser
 * has the APIs, the user has granted permission, and the server has a VAPID
 * key and a stored subscription for this device. The hook resolves all three
 * on mount and exposes one state plus two verbs.
 */
export function usePushNotifications(enabled: boolean) {
  const [state, setState] = useState<PushState>("loading");
  const [busy, setBusy] = useState(false);
  /**
   * The VAPID key from the mount-time check, kept so pressing 開啟 does not
   * have to fetch it again. That request can hit a cold serverless function,
   * and paying for it while the user waits on a button they just pressed is
   * the difference between "instant" and "why is this taking so long".
   */
  const publicKeyRef = useRef<string>("");

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    detectPushSubscriptionState({
      fetchPublicKey: async () => {
        const key = await createApiClient().getPushPublicKey();
        publicKeyRef.current = key.public_key ?? "";
        return key;
      },
    })
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => {
        if (!cancelled) setState("unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const enable = useCallback(async (): Promise<boolean> => {
    if (detectPushSupport() !== "supported") return false;

    // Deliberately NOT busy yet. requestPermission puts the browser's own
    // dialog on screen and does not resolve until the user answers it, which
    // can be many seconds - and showing 處理中… next to a prompt that is
    // waiting for them makes the app look like it is the slow one.
    //
    // It also has to be the first thing here: Safari only honours
    // requestPermission while the user gesture that opened it is still live,
    // so a network round trip in front of it can lose the permission entirely.
    let permission: NotificationPermission;
    try {
      permission = await Notification.requestPermission();
    } catch {
      setState("off");
      return false;
    }

    if (permission !== "granted") {
      setState(permission === "denied" ? "denied" : "off");
      return false;
    }

    setBusy(true);
    try {
      const client = createApiClient();
      // Reuse what the mount-time check already fetched; only ask again if it
      // somehow never arrived.
      const publicKey = publicKeyRef.current || (await client.getPushPublicKey()).public_key || "";

      if (!publicKey) {
        setState("unavailable");
        return false;
      }

      const registration = await readyServiceWorker();

      if (!registration) {
        // No active worker (blocked, private window, a registration that
        // failed): there is nothing to receive a push, so do not claim to be
        // on. readyServiceWorker caps the wait - `serviceWorker.ready` on its
        // own would hang here forever.
        setState("off");
        return false;
      }

      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          // Required by Chrome, and the honest setting anyway: every push this
          // app sends results in a visible notification.
          userVisibleOnly: true,
          applicationServerKey: decodeVapidKey(publicKey),
        }));

      await client.subscribePush(serializeSubscription(subscription));
      setState("on");
      return true;
    } catch {
      // Service workers fail to activate, networks drop, push services say no.
      // None of it is worth an error screen for a switch.
      setState("off");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const registration = await readyServiceWorker();
      const subscription = await registration?.pushManager.getSubscription();

      if (subscription) {
        // Server first: if unsubscribing locally succeeded and the server call
        // failed, we would keep sending to an endpoint nobody listens to.
        await createApiClient()
          .unsubscribePush(subscription.endpoint)
          .catch(() => {});
        await subscription.unsubscribe().catch(() => {});
      }

      setState("off");
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, busy, enable, disable };
}
