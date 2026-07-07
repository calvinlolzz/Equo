import type { CloudGroupData } from "./cloudStore";
import type { Group } from "./appTypes";

const CLOUD_CACHE_KEY = "equo.clean.cloud_cache";
const CLOUD_CACHE_VERSION = 1;

export type CloudCacheSnapshot = {
  userId: string;
  groups: Group[];
  groupDetails: Record<string, CloudGroupData>;
};

type StoredCloudCache = CloudCacheSnapshot & {
  version: number;
};

export type CacheStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): CacheStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function isGroup(value: unknown): value is Group {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && typeof candidate.name === "string" && typeof candidate.currency === "string";
}

function isCloudGroupData(value: unknown): value is CloudGroupData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    isGroup(candidate.group) &&
    Array.isArray(candidate.members) &&
    Array.isArray(candidate.expenses) &&
    // balances/aggregates were added alongside the get_group_detail v3
    // aggregates (see detailAggregates.ts) - reject an older-shaped cache
    // entry outright rather than silently seeding the store with holes
    // (e.g. current.balances being undefined) that would only surface as a
    // crash on the first mutation after a stale reload.
    Array.isArray(candidate.balances) &&
    Boolean(candidate.aggregates) &&
    typeof candidate.aggregates === "object"
  );
}

function isStoredCloudCache(value: unknown): value is StoredCloudCache {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;

  if (candidate.version !== CLOUD_CACHE_VERSION) return false;
  if (typeof candidate.userId !== "string") return false;
  if (!Array.isArray(candidate.groups) || !candidate.groups.every(isGroup)) return false;

  if (!candidate.groupDetails || typeof candidate.groupDetails !== "object") return false;
  return Object.values(candidate.groupDetails as Record<string, unknown>).every(isCloudGroupData);
}

/**
 * Load the cached display-seed snapshot for `userId`, or null when nothing is
 * cached, the cache belongs to a different user, the format version has
 * moved on, or the stored JSON is corrupt. Used to seed cloudStore's initial
 * state so the app can render instantly on reload while a fresh
 * refreshGroups/refreshGroupDetail call revalidates in the background.
 */
export function loadCloudCache(
  userId: string,
  storage: CacheStorage | null = browserStorage(),
): CloudCacheSnapshot | null {
  const raw = storage?.getItem(CLOUD_CACHE_KEY);
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isStoredCloudCache(parsed)) return null;
  if (parsed.userId !== userId) return null;

  return { userId: parsed.userId, groups: parsed.groups, groupDetails: parsed.groupDetails };
}

export function saveCloudCache(snapshot: CloudCacheSnapshot, storage: CacheStorage | null = browserStorage()) {
  const stored: StoredCloudCache = { ...snapshot, version: CLOUD_CACHE_VERSION };
  storage?.setItem(CLOUD_CACHE_KEY, JSON.stringify(stored));
}

export function clearCloudCache(storage: CacheStorage | null = browserStorage()) {
  storage?.removeItem(CLOUD_CACHE_KEY);
}
