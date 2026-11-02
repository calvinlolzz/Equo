import { describe, expect, test } from "vitest";
import { describeCloudActionError } from "./describeCloudActionError";
import { isLineUnavailableError, isRetryableError } from "./apiClient";
import { UI_TEXT } from "./uiText";

function coded(code: string, message = "A raw English server message."): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

describe("the LINE (LIFF) gate's errors", () => {
  // [MV]: remove the mapping and the toast shows the server's English sentence.
  test("LINE_UNAVAILABLE and LIFF_SCOPE are localized, never the raw server message", () => {
    expect(describeCloudActionError(coded("LINE_UNAVAILABLE"))).toBe(UI_TEXT.app.lineUnavailable);
    expect(describeCloudActionError(coded("LIFF_SCOPE"))).toBe(UI_TEXT.app.liffScope);
    expect(UI_TEXT.app.lineUnavailable).not.toBe(UI_TEXT.app.liffScope);
  });

  test("only LINE_UNAVAILABLE is retryable; a scope refusal is dropped like any rejection", () => {
    expect(isLineUnavailableError(coded("LINE_UNAVAILABLE"))).toBe(true);
    expect(isRetryableError(coded("LINE_UNAVAILABLE"))).toBe(true);
    expect(isRetryableError(coded("LIFF_SCOPE"))).toBe(false);
    expect(isLineUnavailableError(null)).toBe(false);
    expect(isLineUnavailableError(coded("MAINTENANCE"))).toBe(false);
  });
});
