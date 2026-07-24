import { useEffect, useState } from "react";

/**
 * Tracks the browser's online/offline state. The store seeds from the cloud
 * cache so groups still render offline, but nothing otherwise signals that the
 * data may be stale — this drives a small "目前離線" banner. SSR/test-safe:
 * assumes online when navigator is unavailable.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    // Reconcile once in case the state changed before the listeners attached.
    setOnline(navigator.onLine);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
