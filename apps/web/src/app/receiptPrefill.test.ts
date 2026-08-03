import { describe, expect, test } from "vitest";
import type { ScanReceiptResponse } from "../contracts/schemas";
import { buildReceiptComposerPrefill, type ReceiptPrefill } from "./receiptPrefill";

const context = {
  groupCurrency: "TWD",
  currencyCodes: ["TWD", "JPY", "USD"],
  memberIds: ["member_alice", "member_bob"],
  nowIso: "2026-08-03T14:30:00.000Z",
};

function scan(overrides: Partial<ScanReceiptResponse> = {}): ScanReceiptResponse {
  return {
    recognised: true,
    merchant: "全家便利商店",
    amount_minor: 12550,
    currency: "TWD",
    purchased_at: "2026-07-29",
    category: "food",
    items: [],
    ...overrides,
  };
}

function prefill(value: ScanReceiptResponse | null): ReceiptPrefill {
  return { imageDataUrl: "data:image/jpeg;base64,AAAA", scan: value };
}

describe("buildReceiptComposerPrefill", () => {
  test("fills the composer from a recognised receipt", () => {
    const result = buildReceiptComposerPrefill(prefill(scan()), context);

    expect(result.title).toBe("全家便利商店");
    expect(result.amount).toBe("125.5");
    expect(result.currency).toBe("TWD");
    expect(result.category).toBe("food");
    expect(result.mode).toBe("expense");
  });

  test("leaves every field empty when recognition did not run", () => {
    const result = buildReceiptComposerPrefill(prefill(null), context);

    expect(result.amount).toBe("");
    expect(result.title).toBe("");
    expect(result.category).toBe("general");
    expect(result.note).toBe("");
  });

  test("ignores a scan that came back unrecognised even if it carries values", () => {
    const result = buildReceiptComposerPrefill(
      prefill(scan({ recognised: false, merchant: "guessed", amount_minor: 99900 })),
      context,
    );

    expect(result.amount).toBe("");
    expect(result.title).toBe("");
  });

  test("splits the cost across every member evenly by default", () => {
    const result = buildReceiptComposerPrefill(prefill(scan()), context);

    expect(result.payerId).toBe("member_alice");
    expect(result.shareMemberIds).toEqual(["member_alice", "member_bob"]);
    expect(result.splitMode).toBe("equal");
  });

  test("keeps the receipt's date but takes the time of day from now", () => {
    const result = buildReceiptComposerPrefill(prefill(scan({ purchased_at: "2026-07-29" })), context);
    const parsed = new Date(result.dateTimeIso);
    const now = new Date(context.nowIso);

    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(6);
    expect(parsed.getDate()).toBe(29);
    expect(parsed.getHours()).toBe(now.getHours());
    expect(parsed.getMinutes()).toBe(now.getMinutes());
  });

  test("falls back to now when the receipt printed no date", () => {
    const result = buildReceiptComposerPrefill(prefill(scan({ purchased_at: null })), context);

    expect(result.dateTimeIso).toBe(context.nowIso);
  });

  test("keeps a scanned currency the picker can actually show", () => {
    const result = buildReceiptComposerPrefill(prefill(scan({ currency: "JPY", amount_minor: 120000 })), context);

    expect(result.currency).toBe("JPY");
    expect(result.amount).toBe("1200");
  });

  test("falls back to the group currency when the scanned one is not offered", () => {
    const result = buildReceiptComposerPrefill(prefill(scan({ currency: "THB" })), context);

    expect(result.currency).toBe("TWD");
  });

  test("carries line items into the note so the total can be eyeballed", () => {
    const result = buildReceiptComposerPrefill(
      prefill(
        scan({
          items: [
            { name: "美式咖啡", amount_minor: 6500 },
            { name: "御飯糰", amount_minor: null },
          ],
        }),
      ),
      context,
    );

    expect(result.note).toContain("美式咖啡 65");
    expect(result.note).toContain("御飯糰");
    expect(result.note).not.toContain("御飯糰 ");
  });

  test("never seeds a foreign-currency rate with a stale 1-to-1", () => {
    // The composer refreshes the rate itself for anything that is not an edit;
    // shipping a real-looking rate here would suppress that.
    const result = buildReceiptComposerPrefill(prefill(scan({ currency: "JPY" })), context);

    expect(result.exchangeRate).toBe("1");
  });
});
