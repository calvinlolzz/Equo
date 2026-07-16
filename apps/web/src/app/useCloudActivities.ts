import { useEffect, useState } from "react";
import type { Activity } from "./appTypes";

const CLOUD_ACTIVITIES_KEY = "equo.clean.cloud_activities";

function readActivities(): Record<string, Activity[]> {
  try {
    const raw = window.localStorage.getItem(CLOUD_ACTIVITIES_KEY);
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
 */
export function useCloudActivities(): {
  cloudActivities: Record<string, Activity[]>;
  recordCloudActivity: (groupId: string, activityText: string) => void;
} {
  const [cloudActivities, setCloudActivities] = useState<Record<string, Activity[]>>(readActivities);

  useEffect(() => {
    window.localStorage.setItem(CLOUD_ACTIVITIES_KEY, JSON.stringify(cloudActivities));
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
