// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { copyText } from "./copyText";

function stubClipboard(clipboard: unknown) {
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
}

describe("copyText", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("copies and reports success", async () => {
    const writeText = vi.fn(async () => {});
    stubClipboard({ writeText });

    await expect(copyText("玉山 808 末五碼 12345")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("玉山 808 末五碼 12345");
  });

  test("reports failure when the Clipboard API is absent", async () => {
    // The bug this guards: `await navigator.clipboard?.writeText(v)` resolves
    // to undefined when there is no clipboard, so the caller says 已複製 having
    // copied nothing - and the user pastes their PREVIOUS clipboard contents
    // into a bank transfer.
    stubClipboard(undefined);

    await expect(copyText("玉山 808 末五碼 12345")).resolves.toBe(false);
  });

  test("reports failure when the browser refuses", async () => {
    stubClipboard({
      writeText: vi.fn(async () => {
        throw new Error("NotAllowedError");
      }),
    });

    await expect(copyText("anything")).resolves.toBe(false);
  });

  test("an empty string is never worth copying", async () => {
    const writeText = vi.fn(async () => {});
    stubClipboard({ writeText });

    await expect(copyText("")).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });
});
