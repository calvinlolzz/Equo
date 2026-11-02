import { useEffect, useRef, useState } from "react";
import type { Activity } from "./appTypes";
import { createMemoryStorage, type MemoryStorage } from "./memoryStorage";

const CLOUD_ACTIVITIES_KEY = "equo.clean.cloud_activities";

function readActivities(storage: MemoryStorage): Record<string, Activity[]> {
  try {
    const raw = storage.getItem(CLOUD_ACTIVITIES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Activity[]>) : {};
  } catch {
    return {};
  }
}

/**
 * The per-group activity log ("Alice added lunch", "renamed 阿明 → 小明", …).
 *
 * Deliberately local-only: it is a lightweight, device-local breadcrumb trail,
 * not server state, so it lives in localStorage and is capped at the 8 most
 * recent entries per group. Mutation handlers call recordCloudActivity after a
 * successful cloud write to append a line.
 *
 * `persist: false` (the LINE-in-app page) keeps the log in memory only: the
 * lines carry titles and amounts of the signed-in person's entries, and that
 * page leaves nothing of its own behind in the browser.
 */
export function useCloudActivities({ persist = true }: { persist?: boolean } = {}): {
  cloudActivities: Record<string, Activity[]>;
  recordCloudActivity: (groupId: string, activityText: string) => void;
} {
  const memory = useRef<MemoryStorage | null>(null);
  const storage = (): MemoryStorage => {
    if (persist) return window.localStorage;
    memory.current ??= createMemoryStorage();
    return memory.current;
  };
  const [cloudActivities, setCloudActivities] = useState<Record<string, Activity[]>>(() => readActivities(storage()));

  useEffect(() => {
    storage().setItem(CLOUD_ACTIVITIES_KEY, JSON.stringify(cloudActivities));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- storage() is a pure pick of two stable things
  }, [cloudActivities]);

  function recordCloudActivity(groupId: string, activityText: string) {
    const activity: Activity = { id: crypto.randomUUID(), text: activityText, createdAt: new Date().toISOString() };
    setCloudActivities((current) => ({
      ...current,
      [groupId]: [activity, ...(current[groupId] ?? [])].slice(0, 8),
    }));
  }

  return { cloudActivities, recordCloudActivity };
}
