import { beforeEach, describe, expect, test, vi } from "vitest";
import { scanReceiptRoute } from "./receiptRoutes.js";
import { createFakePostgrest } from "../db/fakePostgrest.js";
import { ReceiptScanUnavailableError, type ReceiptScanner } from "../runtime/receiptScanner.js";

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const validRequest = {
  client_request_id: "req_scan",
  currency: "TWD",
  data_url: `data:image/png;base64,${tinyPngBase64}`,
};

const recognised = {
  recognised: true as const,
  merchant: "全家便利商店",
  amount_minor: 12550,
  currency: "TWD",
  purchased_at: "2026-07-29",
  category: "food",
  items: [],
};

type Settings = { enabled: boolean; model: string } | "unavailable";

/** Rows the route wrote to receipt_scan_logs during a test. */
type LoggedScan = Record<string, unknown>;

function makeClient(
  settings: Settings = { enabled: true, model: "claude-haiku-4-5" },
  logged: LoggedScan[] = [],
  logFails = false,
) {
  return createFakePostgrest({
    select: (table) => (table === "users" ? [{ id: "user_alice", deleted_at: null }] : []),
    rpc: (fn, args) => {
      if (fn === "log_receipt_scan") {
        if (logFails) throw new Error("function does not exist");
        logged.push((args as { p_payload: LoggedScan }).p_payload);
        return null;
      }
      if (fn !== "receipt_scan_settings") throw new Error(`Unexpected rpc ${fn}`);
      if (settings === "unavailable") throw new Error("function does not exist");
      return { ...settings, updated_at: null, updated_by_email: null };
    },
  });
}

const verifier = async (idToken: string) => ({
  auth_user_id: idToken,
  google_sub: idToken,
  email: "alice@example.com",
  display_name: "Alice",
  resolved_user_id: idToken,
});

function options(scanReceipt?: ReceiptScanner, settings?: Settings, logged?: LoggedScan[], logFails?: boolean) {
  return { client: makeClient(settings, logged, logFails), verifier, idToken: "user_alice", scanReceipt };
}

function fakeScanner() {
  return vi.fn<ReceiptScanner>(async () => recognised);
}

describe("scanReceiptRoute", () => {
  beforeEach(() => {
    // Every scan writes a diagnostics line now; the assertions below are about
    // what was recorded, not what was printed.
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  test("returns the recognised receipt to an authenticated caller", async () => {
    const scanReceipt = fakeScanner();

    const result = await scanReceiptRoute(options(scanReceipt), validRequest);

    expect(result.status).toBe(200);
    expect(result.body).toEqual(recognised);
  });

  test("runs on the model the console saved, not the deployment default", async () => {
    const scanReceipt = fakeScanner();

    await scanReceiptRoute(
      { ...options(scanReceipt, { enabled: true, model: "claude-sonnet-5" }), defaultModel: "claude-haiku-4-5" },
      validRequest,
    );

    expect(scanReceipt).toHaveBeenCalledWith(expect.objectContaining({ model: "claude-sonnet-5" }));
  });

  test("the console's kill switch stops the spend before the upstream is called", async () => {
    const scanReceipt = fakeScanner();

    const result = await scanReceiptRoute(options(scanReceipt, { enabled: false, model: "claude-haiku-4-5" }), validRequest);

    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ error: { code: "RECEIPT_SCAN_UNAVAILABLE" } });
    // The whole point of the switch is that it costs nothing while it is off.
    expect(scanReceipt).not.toHaveBeenCalled();
  });

  test("ignores a saved model this build cannot call, rather than 503-ing every scan", async () => {
    const scanReceipt = fakeScanner();

    await scanReceiptRoute(
      { ...options(scanReceipt, { enabled: true, model: "claude-retired-9" }), defaultModel: "claude-haiku-4-5" },
      validRequest,
    );

    expect(scanReceipt).toHaveBeenCalledWith(expect.objectContaining({ model: "claude-haiku-4-5" }));
  });

  test("fails open when the settings function is missing, so a pending migration cannot break scanning", async () => {
    const scanReceipt = fakeScanner();
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await scanReceiptRoute({ ...options(scanReceipt, "unavailable"), defaultModel: "claude-haiku-4-5" }, validRequest);

    expect(result.status).toBe(200);
    expect(scanReceipt).toHaveBeenCalledWith(expect.objectContaining({ model: "claude-haiku-4-5" }));
    vi.restoreAllMocks();
  });

  test("rejects an anonymous caller before spending anything upstream", async () => {
    const scanReceipt = fakeScanner();

    const result = await scanReceiptRoute({ ...options(scanReceipt), idToken: "" }, validRequest);

    expect(result.status).toBe(401);
    expect(scanReceipt).not.toHaveBeenCalled();
  });

  test("rejects a body that is not an image data URL", async () => {
    const scanReceipt = fakeScanner();

    const result = await scanReceiptRoute(options(scanReceipt), { ...validRequest, data_url: "https://example.com/a.jpg" });

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: { code: "INVALID_IMAGE" } });
    expect(scanReceipt).not.toHaveBeenCalled();
  });

  test("reports the feature unavailable rather than 500 when no key is configured", async () => {
    const result = await scanReceiptRoute(options(undefined), validRequest);

    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ error: { code: "RECEIPT_SCAN_UNAVAILABLE" } });
  });

  test("turns an upstream failure into the same advisory 503 the client degrades on", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const scanReceipt = vi.fn<ReceiptScanner>(async () => {
      throw new ReceiptScanUnavailableError("upstream exploded");
    });

    const result = await scanReceiptRoute(options(scanReceipt), validRequest);

    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ error: { code: "RECEIPT_SCAN_UNAVAILABLE" } });
    vi.restoreAllMocks();
  });

  test("does not leak an unexpected upstream error message to the client", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const scanReceipt = vi.fn<ReceiptScanner>(async () => {
      throw new Error("anthropic key sk-ant-secret rejected");
    });

    const result = await scanReceiptRoute(options(scanReceipt), validRequest);

    expect(JSON.stringify(result.body)).not.toContain("sk-ant-secret");
    vi.restoreAllMocks();
  });
  test("records a successful scan against the user and the model that ran", async () => {
    const logged: LoggedScan[] = [];

    const result = await scanReceiptRoute(
      options(fakeScanner(), { enabled: true, model: "claude-sonnet-5" }, logged),
      validRequest,
    );

    expect(result.status).toBe(200);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      user_id: "user_alice",
      model: "claude-sonnet-5",
      provider: "anthropic",
      outcome: "recognised",
      image_bytes: validRequest.data_url.length,
    });
    // Measured, not guessed: the route times the upstream call itself.
    expect(typeof logged[0].upstream_ms).toBe("number");
  });

  test("keeps an unreadable photo apart from a failure, because the fixes differ", async () => {
    const logged: LoggedScan[] = [];
    const unreadable = vi.fn<ReceiptScanner>(async () => ({ ...recognised, recognised: false as const }));

    const result = await scanReceiptRoute(options(unreadable, undefined, logged), validRequest);

    // The call worked - the user just gets no auto-fill.
    expect(result.status).toBe(200);
    expect(logged[0]).toMatchObject({ outcome: "unrecognised" });
  });

  test("records a failed scan with the upstream's reason, and still degrades gracefully", async () => {
    const logged: LoggedScan[] = [];
    const scanReceipt = vi.fn<ReceiptScanner>(async () => {
      throw new ReceiptScanUnavailableError("upstream returned 429");
    });

    const result = await scanReceiptRoute(options(scanReceipt, undefined, logged), validRequest);

    expect(result.status).toBe(503);
    expect(logged[0]).toMatchObject({ outcome: "failed", failure_reason: "upstream returned 429" });
  });

  test("records nothing when the kill switch stopped the call", async () => {
    const logged: LoggedScan[] = [];

    await scanReceiptRoute(options(fakeScanner(), { enabled: false, model: "claude-haiku-4-5" }, logged), validRequest);

    // Nothing was spent, so there is nothing to account for.
    expect(logged).toHaveLength(0);
  });

  test("a scan still succeeds when the usage ledger cannot be written", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const logged: LoggedScan[] = [];

    // A deployment running ahead of the migration has no function to call. The
    // user has already paid for this scan; bookkeeping must not take it away.
    const result = await scanReceiptRoute(options(fakeScanner(), undefined, logged, true), validRequest);

    expect(result.status).toBe(200);
    expect(result.body).toEqual(recognised);
    vi.restoreAllMocks();
  });
});
