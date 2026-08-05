import { useCallback, useEffect, useState } from "react";
import type { EquoApiClient, NotificationRow } from "./apiClient";

/**
 * The in-app inbox.
 *
 * Polling rather than a socket, and a slow poll at that: the things that land
 * here are announcements and support replies, neither of which is worse for
 * arriving a few minutes late. A refresh on focus does most of the work - the
 * app is a phone app, and "came back to it" is when people look at the bell.
 */
const POLL_INTERVAL_MS = 5 * 60 * 1000;

export type NotificationsState = {
  unread: number;
  items: NotificationRow[];
  loading: boolean;
  /** Re-read the inbox; safe to call while one is already in flight. */
  refresh: () => void;
  /** Mark everything read (what opening the panel does). */
  markAllRead: () => Promise<void>;
};

export function useNotifications(client: EquoApiClient | null, enabled: boolean): NotificationsState {
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (!client || !enabled) return;
    setLoading(true);
    client
      .listNotifications()
      .then((page) => {
        setUnread(page.unread);
        setItems(page.items);
      })
      .catch(() => {
        // Non-fatal by design: the inbox is an extra, and a failed read must
        // never be the reason the app shows an error. The badge simply keeps
        // whatever it last knew.
      })
      .finally(() => setLoading(false));
  }, [client, enabled]);

  useEffect(() => {
    if (!enabled) {
      // Signing out has to clear it, or the next account briefly sees the
      // previous one's badge.
      setUnread(0);
      setItems([]);
      return;
    }

    refresh();

    const onFocus = () => {
      if (document.visibilityState === "visible") refresh();
    };

    const timer = window.setInterval(refresh, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [enabled, refresh]);

  const markAllRead = useCallback(async () => {
    if (!client || unread === 0) return;
    // Optimistic: the badge clearing is the whole point of opening the panel,
    // and it should not wait on a round trip to do it.
    setUnread(0);
    setItems((current) =>
      current.map((item) => (item.read_at ? item : { ...item, read_at: new Date().toISOString() })),
    );
    try {
      await client.markNotificationsRead();
    } catch {
      // Left as-is on failure rather than restored: the next refresh reports
      // the truth, and a badge that reappears under the finger is worse than
      // one that is briefly optimistic.
    }
  }, [client, unread]);

  return { unread, items, loading, refresh, markAllRead };
}
