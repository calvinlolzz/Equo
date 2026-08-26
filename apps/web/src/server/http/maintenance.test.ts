import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  blocksRequest,
  loadSiteNotice,
  resetSiteNoticeCache,
  SITE_NOTICE_DEFAULT,
  type SiteNotice,
} from "./maintenance.js";

function notice(overrides: Partial<SiteNotice["maintenance"]> = {}): SiteNotice {
  return {
    banner: { message: "", level: "info", ends_at: null, active: false },
    maintenance: { enabled: true, message: "", ...overrides },
  };
}

const OFF: SiteNotice = SITE_NOTICE_DEFAULT;

beforeEach(() => {
  resetSiteNoticeCache();
});

describe("blocksRequest", () => {
  test("lets everything through when maintenance is off", () => {
    expect(blocksRequest(OFF, "POST", "/api/v1/groups/g1/expenses")).toBe(false);
  });

  test("blocks writes while maintenance is on", () => {
    expect(blocksRequest(notice(), "POST", "/api/v1/groups/g1/expenses")).toBe(true);
    expect(blocksRequest(notice(), "PUT", "/api/v1/groups/g1/expenses/e1")).toBe(true);
    expect(blocksRequest(notice(), "DELETE", "/api/v1/groups/g1/expenses/e1")).toBe(true);
    expect(blocksRequest(notice(), "PATCH", "/api/v1/groups/g1")).toBe(true);
  });

  test.each([
    ["GET", "/api/v1/groups"],
    ["GET", "/api/v1/groups/g1"],
    ["HEAD", "/api/v1/health"],
  ])("never blocks a read (%s %s)", (method, path) => {
    // The point is to stop the ledger changing under a migration, not to take
    // the site down. Checking what you owe still works.
    expect(blocksRequest(notice(), method, path)).toBe(false);
  });

  test("never blocks the admin console, or the switch could not be turned off", () => {
    // The single most important line in this file: a maintenance mode that
    // blocks the endpoint used to end it is a door that locks from the inside.
    expect(blocksRequest(notice(), "PUT", "/api/v1/admin/settings/site-notice")).toBe(false);
    expect(blocksRequest(notice(), "POST", "/api/v1/admin/users/u1/disabled")).toBe(false);
  });

  test("never blocks auth, so an admin who is signed out can still get in", () => {
    expect(blocksRequest(notice(), "POST", "/api/v1/auth/google")).toBe(false);
  });

  test("never blocks crash reports, which is when you most want them", () => {
    expect(blocksRequest(notice(), "POST", "/api/v1/errors")).toBe(false);
  });

  test("never blocks reading the notice itself", () => {
    expect(blocksRequest(notice(), "POST", "/api/v1/site-notice")).toBe(false);
  });

  test("blocks an unknown path too, so probing cannot map the API mid-window", () => {
    expect(blocksRequest(notice(), "POST", "/api/v1/does-not-exist")).toBe(true);
  });
});

describe("loadSiteNotice", () => {
  test("reads the settings RPC", async () => {
    const rpc = vi.fn(async () => notice({ message: "upgrading" }));
    const result = await loadSiteNotice({ rpc, select: vi.fn() } as never);

    expect(rpc).toHaveBeenCalledWith("site_notice_settings", {});
    expect(result.maintenance).toEqual({ enabled: true, message: "upgrading" });
  });

  test("caches, so every write does not pay for a round trip", async () => {
    const rpc = vi.fn(async () => notice());
    const client = { rpc, select: vi.fn() } as never;

    await loadSiteNotice(client, 1_000);
    await loadSiteNotice(client, 1_000 + 29_000);

    expect(rpc).toHaveBeenCalledTimes(1);
  });

  test("re-reads once the cache is stale", async () => {
    const rpc = vi.fn(async () => notice());
    const client = { rpc, select: vi.fn() } as never;

    await loadSiteNotice(client, 1_000);
    await loadSiteNotice(client, 1_000 + 31_000);

    expect(rpc).toHaveBeenCalledTimes(2);
  });

  test("fails OPEN when the settings read throws", async () => {
    // Treating an unreachable database as "we must be in maintenance" would
    // turn one bad query into a total write outage, at the exact moment nobody
    // can use the console to argue otherwise.
    const rpc = vi.fn(async () => {
      throw new Error("database unreachable");
    });

    const result = await loadSiteNotice({ rpc, select: vi.fn() } as never);

    expect(result.maintenance.enabled).toBe(false);
    expect(blocksRequest(result, "POST", "/api/v1/groups/g1/expenses")).toBe(false);
  });

  test("survives a malformed payload without blocking anybody", async () => {
    const rpc = vi.fn(async () => ({ maintenance: "yes please" }));
    const result = await loadSiteNotice({ rpc, select: vi.fn() } as never);

    expect(result.maintenance.enabled).toBe(false);
    expect(result.banner.level).toBe("info");
  });
});
