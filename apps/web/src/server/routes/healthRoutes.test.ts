import { beforeEach, describe, expect, test, vi } from "vitest";
import { createFakePostgrest } from "../db/fakePostgrest.js";
import { HEALTH_CACHE_MS, healthRoute, resetHealthCache } from "./healthRoutes.js";

beforeEach(() => {
  resetHealthCache();
});

describe("healthRoute", () => {
  test("reports ok when the database answers", async () => {
    const client = createFakePostgrest({ select: () => [{ id: "user_alice" }] });

    const result = await healthRoute({ client, now: 0 });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ status: "ok", database: "ok" });
  });

  test("answers 503 when the database is unreachable", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = createFakePostgrest({
      select: () => {
        throw new Error("connection refused");
      },
    });

    const result = await healthRoute({ client, now: 0 });

    // A monitor alerts on the status code — a soft 200 carrying "degraded" is
    // an outage nobody gets told about.
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ status: "degraded", database: "down" });
    logged.mockRestore();
  });

  test("leaks nothing about the data or the failure", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = createFakePostgrest({
      select: () => {
        throw new Error("postgres://user:hunter2@db.internal:5432 refused");
      },
    });

    const result = await healthRoute({ client, now: 0 });

    // World-readable endpoint: the body is two fixed words, never the cause.
    expect(JSON.stringify(result.body)).not.toContain("hunter2");
    expect(JSON.stringify(result.body)).not.toContain("db.internal");
    expect(Object.keys(result.body).sort()).toEqual(["database", "status"]);
    logged.mockRestore();
  });

  test("memoises the probe so the endpoint can't be used to hammer the database", async () => {
    let probes = 0;
    const client = createFakePostgrest({
      select: () => {
        probes += 1;
        return [{ id: "user_alice" }];
      },
    });

    await healthRoute({ client, now: 0 });
    await healthRoute({ client, now: 1_000 });
    await healthRoute({ client, now: HEALTH_CACHE_MS - 1 });

    expect(probes).toBe(1);
  });

  test("probes again once the cache window has passed", async () => {
    let probes = 0;
    const client = createFakePostgrest({
      select: () => {
        probes += 1;
        return [{ id: "user_alice" }];
      },
    });

    await healthRoute({ client, now: 0 });
    await healthRoute({ client, now: HEALTH_CACHE_MS });

    // Otherwise a recovery (or a failure) would never be noticed.
    expect(probes).toBe(2);
  });
});
