import { describe, expect, test } from "vitest";
import {
  createReporterState,
  describeErrorEvent,
  ERROR_REPORT_SESSION_CAP,
  shouldReport,
} from "./errorReporter";

describe("shouldReport", () => {
  test("admits a fresh message and dedupes repeats", () => {
    const state = createReporterState();

    expect(shouldReport(state, "boom")).toBe(true);
    expect(shouldReport(state, "boom")).toBe(false);
    expect(shouldReport(state, "different")).toBe(true);
  });

  test("caps total reports per session", () => {
    const state = createReporterState();

    for (let index = 0; index < ERROR_REPORT_SESSION_CAP; index += 1) {
      expect(shouldReport(state, `error-${index}`)).toBe(true);
    }
    expect(shouldReport(state, "one-too-many")).toBe(false);
  });

  test("rejects blank messages", () => {
    const state = createReporterState();

    expect(shouldReport(state, "   ")).toBe(false);
    expect(state.sentCount).toBe(0);
  });
});

describe("describeErrorEvent", () => {
  test("unwraps Error instances with their stack", () => {
    const error = new Error("kaput");
    const described = describeErrorEvent(error);

    expect(described.message).toBe("kaput");
    expect(described.context).toContain("kaput");
  });

  test("passes strings through and serializes objects", () => {
    expect(describeErrorEvent("plain failure").message).toBe("plain failure");
    expect(describeErrorEvent({ code: 42 }).message).toBe('{"code":42}');
  });
});
