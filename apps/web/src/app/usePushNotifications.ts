import { useCallback, useEffect, useState } from "react";
import { createApiClient } from "./apiClient";
import {
  decodeVapidKey,
  detectPushSubscriptionState,
  detectPushSupport,
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

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    detectPushSubscriptionState({ fetchPublicKey: () => createApiClient().getPushPublicKey() })
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

    setBusy(true);
    try {
      // FIRST, before any await: Safari only honours requestPermission while
      // the user gesture that led here is still live, and a network round trip
      // in front of it is enough to lose that. Asking first is safe because
      // the switch only renders at all once the mount-time check has confirmed
      // the server can deliver.
      const permission = await Notification.requestPermission();

      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return false;
      }

      const client = createApiClient();
      const key = await client.getPushPublicKey();

      if (!key.enabled || !key.public_key) {
        setState("unavailable");
        return false;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          // Required by Chrome, and the honest setting anyway: every push this
          // app sends results in a visible notification.
          userVisibleOnly: true,
          applicationServerKey: decodeVapidKey(key.public_key),
        }));

      await client.subscribePush(serializeSubscription(subscription));
      setState("on");
      return true;
    } catch {
      // Permission dialogs get dismissed, service workers fail to activate,
      // networks drop. None of it is worth an error screen for a switch.
      setState("off");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

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
