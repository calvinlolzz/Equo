// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useOverlayHistory, type OverlayLayer } from "./useOverlayHistory";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

/**
 * jsdom traverses history asynchronously — back() queues the navigation and
 * nothing has moved yet when it returns. Wait for the popstate it ultimately
 * fires rather than for a timer, so this can't go flaky. Rejects loudly when
 * there was nothing to go back to, which is the failure this file is most
 * likely to produce and the one a hang would hide.
 */
async function pressBack() {
  const traversed = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("popstate", onPopState);
      reject(new Error("history.back() fired no popstate - nothing to go back to"));
    }, 1_000);
    function onPopState() {
      window.clearTimeout(timer);
      resolve();
    }
    window.addEventListener("popstate", onPopState, { once: true });
  });

  await act(async () => {
    window.history.back();
    await traversed;
  });
}

/** Lets the guard-entry pushes/unwinds queued by the sync effect settle. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

/**
 * Renders the hook over a mutable set of layers, exposing setters that flip a
 * layer the way the app's own state would.
 */
function renderOverlays(count: number) {
  const closes = Array.from({ length: count }, () => vi.fn());
  let open = Array.from({ length: count }, () => false);

  const view = renderHook(
    (props: { open: boolean[] }) =>
      useOverlayHistory(
        props.open.map<OverlayLayer>((isOpen, index) => ({ open: isOpen, close: closes[index] })),
      ),
    { initialProps: { open } },
  );

  return {
    closes,
    async setOpen(index: number, isOpen: boolean) {
      open = open.map((current, at) => (at === index ? isOpen : current));
      view.rerender({ open });
      await settle();
    },
    /** Applies whatever a close handler would have done, then re-renders. */
    async closeFromState(index: number) {
      return this.setOpen(index, false);
    },
    unmount: view.unmount,
  };
}

describe("useOverlayHistory", () => {
  test("Back closes the open overlay instead of leaving the page", async () => {
    const overlays = renderOverlays(1);
    const beforeLength = window.history.length;

    await overlays.setOpen(0, true);
    expect(window.history.length).toBe(beforeLength + 1);

    await pressBack();

    expect(overlays.closes[0]).toHaveBeenCalledTimes(1);
  });

  test("Back closes the topmost layer first, one press at a time", async () => {
    const overlays = renderOverlays(2);

    await overlays.setOpen(0, true);
    await overlays.setOpen(1, true);

    await pressBack();
    expect(overlays.closes[1]).toHaveBeenCalledTimes(1);
    expect(overlays.closes[0]).not.toHaveBeenCalled();

    // The app's own close handler runs, taking the top layer out of the stack.
    await overlays.closeFromState(1);

    await pressBack();
    expect(overlays.closes[0]).toHaveBeenCalledTimes(1);
  });

  test("closing without Back leaves no dead history entry on top", async () => {
    const overlays = renderOverlays(1);

    await overlays.setOpen(0, true);
    expect(window.history.state).toMatchObject({ equoOverlay: 1 });

    // The X button / backdrop / Esc path: state closes on its own.
    await overlays.closeFromState(0);
    await settle();

    // Back onto the guard would have looked dead — one press that visibly does
    // nothing. The entry we are left standing on carries no guard at all, so
    // the next press leaves the screen.
    expect((window.history.state as { equoOverlay?: number } | null)?.equoOverlay ?? 0).toBe(0);
    // Unwinding must not be mistaken for a Back press and re-fire the handler.
    expect(overlays.closes[0]).not.toHaveBeenCalled();
  });

  test("a guard restored by a reload is cleared in place, not navigated away", async () => {
    // What a reload with a sheet open leaves behind: the entry still carries
    // the guard, but React starts over with every overlay closed.
    window.history.replaceState({ equoOverlay: 1 }, "", "/group/g1");
    const lengthBeforeMount = window.history.length;

    const overlays = renderOverlays(1);
    await settle();

    expect(window.location.pathname).toBe("/group/g1");
    expect(window.history.length).toBe(lengthBeforeMount);
    expect(window.history.state).toMatchObject({ equoOverlay: 0 });
    expect(overlays.closes[0]).not.toHaveBeenCalled();
  });

  test("a route pushed over an open overlay is not un-navigated", async () => {
    // Switching group from the drawer: the route push lands on top of the
    // guard, then the drawer closes. Unwinding here would undo the navigation.
    const overlays = renderOverlays(1);
    await overlays.setOpen(0, true);

    window.history.pushState(null, "", "/group/g2");
    await overlays.closeFromState(0);
    await settle();

    expect(window.location.pathname).toBe("/group/g2");
  });

  test("stops closing overlays once unmounted", async () => {
    const overlays = renderOverlays(1);
    await overlays.setOpen(0, true);

    overlays.unmount();
    await pressBack();

    expect(overlays.closes[0]).not.toHaveBeenCalled();
  });
});
