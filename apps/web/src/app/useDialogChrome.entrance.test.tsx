// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useDialogChrome } from "./useDialogChrome";

/**
 * The "travelling" flag, which is what lets CSS drop a sheet's backdrop blur
 * while it slides (see the note in useDialogChrome and the rule in
 * app-composer.css). The focus and Escape behaviour of this hook is covered by
 * the dialogs that use it; this is only about the flag's lifetime.
 */
function Sheet() {
  const ref = useDialogChrome(() => undefined);
  return (
    <section className="flow-dialog glass-panel" ref={ref} data-testid="sheet">
      <button type="button" data-testid="child">
        ok
      </button>
    </section>
  );
}

function sheetOf(container: HTMLElement) {
  return container.querySelector<HTMLElement>('[data-testid="sheet"]')!;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("a dialog's entrance flag", () => {
  test("is on from the moment the sheet mounts", () => {
    const { container } = render(<Sheet />);

    expect(sheetOf(container).classList.contains("is-entering")).toBe(true);
  });

  test("comes off when the sheet's own entrance finishes", () => {
    const { container } = render(<Sheet />);
    const sheet = sheetOf(container);

    sheet.dispatchEvent(new Event("animationend", { bubbles: true }));

    expect(sheet.classList.contains("is-entering")).toBe(false);
  });

  test("survives an animation finishing INSIDE the sheet", () => {
    // animationend bubbles, and the panel body runs its own fade on arrival
    // (.enter-content). Listening without checking the target ends the
    // entrance early — the frost would come back while the sheet is still
    // halfway up the screen, which is the exact frame it was dropped for.
    const { container } = render(<Sheet />);
    const sheet = sheetOf(container);

    container.querySelector<HTMLElement>('[data-testid="child"]')!.dispatchEvent(
      new Event("animationend", { bubbles: true }),
    );

    expect(sheet.classList.contains("is-entering")).toBe(true);
  });

  test("comes off on its own where no animation ever runs", () => {
    // A wide screen has no sheet entrance at all, and reduced motion removes
    // it. Left on, the sheet would never frost again.
    const { container } = render(<Sheet />);
    const sheet = sheetOf(container);

    vi.runAllTimers();

    expect(sheet.classList.contains("is-entering")).toBe(false);
  });
});
