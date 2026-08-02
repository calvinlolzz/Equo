import { describe, expect, test, vi } from "vitest";
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

function makeClient(settings: Settings = { enabled: true, model: "claude-haiku-4-5" }) {
  return createFakePostgrest({
    select: (table) => (table === "users" ? [{ id: "user_alice", deleted_at: null }] : []),
    rpc: (fn) => {
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

function options(scanReceipt?: ReceiptScanner, settings?: Settings) {
  return { client: makeClient(settings), verifier, idToken: "user_alice", scanReceipt };
}

function fakeScanner() {
  return vi.fn<ReceiptScanner>(async () => recognised);
}

describe("scanReceiptRoute", () => {
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
});
