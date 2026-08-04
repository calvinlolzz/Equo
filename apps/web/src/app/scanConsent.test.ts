import { describe, expect, test } from "vitest";
import { grantScanConsent, hasScanConsent, revokeScanConsent } from "./scanConsent";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    size: () => values.size,
  };
}

function throwingStorage() {
  return {
    getItem() {
      throw new DOMException("denied", "SecurityError");
    },
    setItem() {
      throw new DOMException("denied", "SecurityError");
    },
    removeItem() {
      throw new DOMException("denied", "SecurityError");
    },
  };
}

describe("scanConsent", () => {
  test("starts ungranted, survives a grant, and is cleared by a revoke", () => {
    const storage = memoryStorage();

    expect(hasScanConsent(storage)).toBe(false);

    grantScanConsent(storage);
    expect(hasScanConsent(storage)).toBe(true);

    revokeScanConsent(storage);
    expect(hasScanConsent(storage)).toBe(false);
    expect(storage.size()).toBe(0);
  });

  test("records when consent was given", () => {
    const storage = memoryStorage();
    grantScanConsent(storage);

    const stored = JSON.parse(storage.getItem("equo.scanConsent.v1")!);
    expect(typeof stored.grantedAt).toBe("string");
    expect(Number.isNaN(Date.parse(stored.grantedAt))).toBe(false);
  });

  test("fails closed when storage is unusable", () => {
    // Private-mode Safari, or site data blocked. Asking again costs a tap;
    // assuming consent costs somebody their receipt.
    expect(hasScanConsent(throwingStorage())).toBe(false);
    expect(() => grantScanConsent(throwingStorage())).not.toThrow();
    expect(() => revokeScanConsent(throwingStorage())).not.toThrow();
    expect(hasScanConsent(null)).toBe(false);
  });

  test("a failed write does not leave consent looking granted", () => {
    const storage = throwingStorage();
    grantScanConsent(storage);

    expect(hasScanConsent(storage)).toBe(false);
  });
});
