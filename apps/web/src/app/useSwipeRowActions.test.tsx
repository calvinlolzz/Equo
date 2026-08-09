// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useSwipeRowActions } from "./useSwipeRowActions";

function stubViewport(mobile: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: mobile && query.includes("620px"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

function Row({ open, onOpen, onClose }: { open: boolean; onOpen: () => void; onClose: () => void }) {
  const { swipeProps } = useSwipeRowActions({ revealWidth: 144, open, onOpen, onClose });
  // The wrapper is what carries --reveal; the hook reaches it via parentElement.
  return (
    <div data-testid="wrap">
      <button data-testid="row" type="button" {...swipeProps}>
        {"品項"}
      </button>
    </div>
  );
}

/** What the CSS clips the tray with — 0px means "not visible at all". */
function revealed() {
  return screen.getByTestId("wrap").style.getPropertyValue("--reveal");
}

function touch(node: HTMLElement, type: "start" | "move" | "end", x: number, y = 0) {
  const init = { touches: type === "end" ? [] : [{ clientX: x, clientY: y }] };
  if (type === "start") fireEvent.touchStart(node, init);
  if (type === "move") fireEvent.touchMove(node, init);
  if (type === "end") fireEvent.touchEnd(node, init);
}

function setup(mobile = true, open = false) {
  stubViewport(mobile);
  const onOpen = vi.fn();
  const onClose = vi.fn();
  const view = render(<Row open={open} onOpen={onOpen} onClose={onClose} />);
  return { onOpen, onClose, row: screen.getByTestId("row"), view };
}

beforeEach(() => {
  stubViewport(true);
});

afterEach(() => {
  // No vitest globals in this project, so RTL never auto-cleans - without this
  // every test finds the previous test's row too.
  cleanup();
  vi.unstubAllGlobals();
});

describe("useSwipeRowActions", () => {
  test("a decisive left swipe opens the tray and parks the row there", () => {
    const { onOpen, onClose, row } = setup();

    act(() => {
      touch(row, "start", 300);
      touch(row, "move", 200); // 100px left — past half of 144
      touch(row, "end", 200);
    });

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(row.style.transform).toBe("translateX(-144px)");
  });

  test("a short swipe springs back instead of leaving the row half-open", () => {
    const { onOpen, onClose, row } = setup();

    act(() => {
      touch(row, "start", 300);
      touch(row, "move", 260); // 40px — short of half
      touch(row, "end", 260);
    });

    expect(onOpen).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(row.style.transform).toBe("");
  });

  test("a vertical drag is left to the list — the row never moves", () => {
    const { onOpen, onClose, row } = setup();

    act(() => {
      touch(row, "start", 300, 100);
      touch(row, "move", 296, 180); // mostly vertical
      touch(row, "end", 296, 180);
    });

    expect(row.style.transform).toBe("");
    expect(onOpen).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  test("a rightward swipe on a closed row reveals nothing — there is no tray on that side", () => {
    const { onOpen, row } = setup();

    act(() => {
      touch(row, "start", 100);
      touch(row, "move", 240);
      touch(row, "end", 240);
    });

    expect(onOpen).not.toHaveBeenCalled();
    expect(row.style.transform).toBe("");
  });

  test("swiping an open row back to the right closes it", () => {
    const { onClose, row } = setup(true, true);

    act(() => {
      // Starts parked at -144; dragging 120px right lands at -24, past halfway back.
      touch(row, "start", 100);
      touch(row, "move", 220);
      touch(row, "end", 220);
    });

    expect(onClose).toHaveBeenCalled();
    expect(row.style.transform).toBe("");
  });

  test("the tray cannot be dragged further than its own width plus a little give", () => {
    const { row } = setup();

    act(() => {
      touch(row, "start", 400);
      touch(row, "move", 0); // 400px of travel
    });

    // Rubber-banded, not 400.
    expect(row.style.transform).toBe("translateX(-168px)");
  });

  test("desktop never engages — the detail dialog is the route there", () => {
    const { onOpen, row } = setup(false);

    act(() => {
      touch(row, "start", 300);
      touch(row, "move", 150);
      touch(row, "end", 150);
    });

    expect(onOpen).not.toHaveBeenCalled();
    expect(row.style.transform).toBe("");
  });

  test("the list closing the row externally animates it back", () => {
    const { row, view } = setup(true, true);
    expect(row.style.transform).toBe("translateX(-144px)");

    view.rerender(<Row open={false} onOpen={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByTestId("row").style.transform).toBe("");
  });

  /**
   * The bug this suite missed the first time: the tray was parked behind the
   * row and assumed hidden, but every surface in this app is translucent glass,
   * so it showed through on every closed row. Position and z-index were all
   * correct — "is it actually invisible" was never asserted.
   */
  test("a closed row reveals none of the tray", () => {
    setup();

    expect(revealed()).toBe("0px");
  });

  test("the reveal tracks the finger, so the tray only shows in the gap", () => {
    const { row } = setup();

    act(() => {
      touch(row, "start", 300);
      touch(row, "move", 240); // 60px of travel
    });

    expect(revealed()).toBe("60px");
  });

  test("the reveal never exceeds the tray, even while rubber-banding", () => {
    const { row } = setup();

    act(() => {
      touch(row, "start", 400);
      touch(row, "move", 0);
    });

    // The row rubber-bands to -168, but there are only 144px of tray to show.
    expect(row.style.transform).toBe("translateX(-168px)");
    expect(revealed()).toBe("144px");
  });

  test("an open row reveals the whole tray, and closing hides it again", () => {
    const { view } = setup(true, true);
    expect(revealed()).toBe("144px");

    view.rerender(<Row open={false} onOpen={vi.fn()} onClose={vi.fn()} />);

    expect(revealed()).toBe("0px");
  });

  test("a vertical drag reveals nothing", () => {
    const { row } = setup();

    act(() => {
      touch(row, "start", 300, 100);
      touch(row, "move", 296, 180);
      touch(row, "end", 296, 180);
    });

    expect(revealed()).toBe("0px");
  });
});
