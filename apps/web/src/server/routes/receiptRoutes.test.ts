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

function makeClient(deletedAt: string | null = null) {
  return createFakePostgrest({
    select: (table) => (table === "users" ? [{ id: "user_alice", deleted_at: deletedAt }] : []),
  });
}

const verifier = async (idToken: string) => ({
  auth_user_id: idToken,
  google_sub: idToken,
  email: "alice@example.com",
  display_name: "Alice",
  resolved_user_id: idToken,
});

function options(scanReceipt?: ReceiptScanner) {
  return { client: makeClient(), verifier, idToken: "user_alice", scanReceipt };
}

describe("scanReceiptRoute", () => {
  test("returns the recognised receipt to an authenticated caller", async () => {
    const scanReceipt = vi.fn<ReceiptScanner>(async () => recognised);

    const result = await scanReceiptRoute(options(scanReceipt), validRequest);

    expect(result.status).toBe(200);
    expect(result.body).toEqual(recognised);
    expect(scanReceipt).toHaveBeenCalledWith({ dataUrl: validRequest.data_url, currency: "TWD" });
  });

  test("rejects an anonymous caller before spending anything upstream", async () => {
    const scanReceipt = vi.fn<ReceiptScanner>(async () => recognised);

    const result = await scanReceiptRoute({ ...options(scanReceipt), idToken: "" }, validRequest);

    expect(result.status).toBe(401);
    expect(scanReceipt).not.toHaveBeenCalled();
  });

  test("rejects a body that is not an image data URL", async () => {
    const scanReceipt = vi.fn<ReceiptScanner>(async () => recognised);

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
    const scanReceipt = vi.fn<ReceiptScanner>(async () => {
      throw new ReceiptScanUnavailableError("upstream exploded");
    });

    const result = await scanReceiptRoute(options(scanReceipt), validRequest);

    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ error: { code: "RECEIPT_SCAN_UNAVAILABLE" } });
  });

  test("does not leak an unexpected upstream error message to the client", async () => {
    const scanReceipt = vi.fn<ReceiptScanner>(async () => {
      throw new Error("anthropic key sk-ant-secret rejected");
    });

    const result = await scanReceiptRoute(options(scanReceipt), validRequest);

    expect(JSON.stringify(result.body)).not.toContain("sk-ant-secret");
  });
});
