// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useDialogChrome } from "./useDialogChrome";

/**
 * Fix 2: when the expense detail (or the composer) is stacked over the
 * records sheet, the records sheet's own useDialogChrome instance must NOT
 * also react to Escape/Tab - only the dialog actually on top should. Without
 * the `data-covered` guard, both instances see the same document-level
 * keydown (focus routinely falls back to <body> in these dialogs - see the
 * hook's own comment) and Escape would call both onClose handlers at once.
 */

function Outer({ onClose }: { onClose: () => void }) {
  const ref = useDialogChrome(onClose);
  return (
    <div data-covered="detail">
      <section ref={ref as never} aria-label="outer">
        <button type="button">outer button</button>
      </section>
    </div>
  );
}

function Inner({ onClose }: { onClose: () => void }) {
  const ref = useDialogChrome(onClose);
  return (
    <section ref={ref as never} aria-label="inner">
      <button type="button">inner button</button>
    </section>
  );
}

afterEach(cleanup);

describe("useDialogChrome + data-covered", () => {
  // [MV]
  test("Escape with focus on body closes only the uncovered (topmost) dialog", () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    render(
      <>
        <Outer onClose={outerClose} />
        <Inner onClose={innerClose} />
      </>,
    );

    (document.activeElement as HTMLElement | null)?.blur?.();
    document.body.focus?.();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });
});
