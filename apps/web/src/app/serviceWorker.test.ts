// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readAppFile } from "./cssDeclarations";

/**
 * The service worker, exercised as code rather than trusted as a file.
 *
 * public/sw.js is not part of the bundle - nothing imports it, so nothing in
 * this suite could ever have run a line of it. It is evaluated here against a
 * fabricated global scope, which is enough to drive the one part with real
 * timing in it: what a navigation does when the network neither answers nor
 * fails.
 */
const source = readAppFile("..", "..", "public", "sw.js");

type Listener = (event: FakeEvent) => void;

type FakeEvent = {
  request: { url: string; method: string; mode: string };
  respondWith: (value: Promise<Response>) => void;
  waitUntil: (value: Promise<unknown>) => void;
};

const ORIGIN = "https://equo-mu.vercel.app/";

/**
 * A CacheStorage that is just a Map.
 *
 * Keys are resolved against the origin because the real one does: the worker
 * stores the shell as `cache.put("/")` and reads it back as `caches.match("/")`,
 * and both are normalised to the full URL. A fake that keys on the raw string
 * happens to work for that pair and then quietly misses whenever a Request goes
 * in and a path comes out.
 */
function fakeCaches() {
  const entries = new Map<string, Response>();
  const key = (request: string | { url: string }) =>
    new URL(typeof request === "string" ? request : request.url, ORIGIN).href;
  const cache = {
    put: async (request: string | { url: string }, response: Response) => void entries.set(key(request), response),
    add: async () => undefined,
    match: async (request: string | { url: string }) => entries.get(key(request)),
  };

  return {
    entries,
    open: async () => cache,
    match: async (request: string | { url: string }) => entries.get(key(request)),
    keys: async () => [...entries.keys()],
    delete: async () => true,
  };
}

function html(body: string, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

/** Load sw.js and hand back its fetch handler plus the scope it runs in. */
function loadWorker() {
  const listeners = new Map<string, Listener>();
  const self = {
    location: new URL(ORIGIN),
    addEventListener: (type: string, listener: Listener) => void listeners.set(type, listener),
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined, matchAll: async () => [] },
    registration: { showNotification: async () => undefined, getNotifications: async () => [] },
  };

  // eslint-disable-next-line no-new-func
  new Function("self", source)(self);

  const onFetch = listeners.get("fetch");
  if (!onFetch) throw new Error("sw.js registered no fetch handler");
  return onFetch;
}

/** Run a navigation through the worker and return what the page would get. */
function navigate(onFetch: Listener, url = "https://equo-mu.vercel.app/group/group_1") {
  let response: Promise<Response> | null = null;
  const pending: Promise<unknown>[] = [];

  onFetch({
    request: { url, method: "GET", mode: "navigate" },
    respondWith: (value) => void (response = value),
    waitUntil: (value) => void pending.push(value),
  });

  if (!response) throw new Error("the worker did not answer the navigation");
  return { response: response as Promise<Response>, pending };
}

let caches: ReturnType<typeof fakeCaches>;

beforeEach(() => {
  vi.useFakeTimers();
  caches = fakeCaches();
  vi.stubGlobal("caches", caches);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a navigation when the network answers", () => {
  test("the page gets the live response, and it becomes the offline shell", async () => {
    vi.stubGlobal("fetch", async () => html("<!doctype html>fresh"));
    const { response } = navigate(loadWorker());

    expect(await (await response).text()).toContain("fresh");
    await vi.advanceTimersByTimeAsync(0);
    expect(await caches.entries.get(ORIGIN)?.text()).toContain("fresh");
  });

  test("a non-HTML answer is not stored as the shell", async () => {
    // /robots.txt, /site.webmanifest and every icon are mode:"navigate" too.
    vi.stubGlobal("fetch", async () => new Response("User-agent: *", { headers: { "content-type": "text/plain" } }));
    const { response } = navigate(loadWorker(), "https://equo-mu.vercel.app/robots.txt");

    await response;
    await vi.advanceTimersByTimeAsync(0);
    expect(caches.entries.size).toBe(0);
  });
});

describe("a navigation when the network hangs", () => {
  /** A fetch that never settles on its own - the case this whole path exists for. */
  function hangingFetch() {
    let settle: (response: Response) => void = () => undefined;
    const fetch = () => new Promise<Response>((resolve) => void (settle = resolve));
    vi.stubGlobal("fetch", fetch);
    return { answer: (response: Response) => settle(response) };
  }

  test("the cached shell takes over instead of waiting it out", async () => {
    caches.entries.set(ORIGIN, html("<!doctype html>shell"));
    hangingFetch();

    const { response } = navigate(loadWorker());
    let settled = false;
    void response.then(() => void (settled = true));

    // A merely slow connection still gets the real thing: nothing has given up
    // one second in.
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(false);

    // But the wait is bounded. Before this, "network-first" meant waiting for
    // the fetch to fail on its own, which on a dead connection is tens of
    // seconds of no document at all - not even the launch screen, which is in
    // the HTML that never arrived.
    await vi.advanceTimersByTimeAsync(4000);
    expect(await (await response).text()).toContain("shell");
  });

  test("the answer that arrives late still refreshes the shell for next time", async () => {
    caches.entries.set(ORIGIN, html("<!doctype html>old"));
    const network = hangingFetch();

    const { response, pending } = navigate(loadWorker());
    await vi.advanceTimersByTimeAsync(5000);
    expect(await (await response).text()).toContain("old");

    // The worker was asked to stay alive for it. Asserted directly, because
    // nothing here can actually kill a worker mid-promise: without waitUntil
    // this still passes in a test and still loses the update on a real phone,
    // on exactly the connections that need it.
    expect(pending).toHaveLength(1);

    // And the request was never cancelled, so the open after this one is fast.
    network.answer(html("<!doctype html>new"));
    await Promise.all(pending);
    await vi.advanceTimersByTimeAsync(0);
    expect(await caches.entries.get(ORIGIN)?.text()).toContain("new");
  });

  test("with no shell to fall back to, it keeps waiting rather than failing", async () => {
    // First ever visit, or cleared site data. A blank tab that eventually loads
    // beats a navigation that errors.
    const network = hangingFetch();
    const { response } = navigate(loadWorker());

    let settled = false;
    void response.then(() => void (settled = true));
    await vi.advanceTimersByTimeAsync(10000);
    expect(settled).toBe(false);

    network.answer(html("<!doctype html>late"));
    expect(await (await response).text()).toContain("late");
  });
});

describe("a navigation when the network is gone", () => {
  test("offline falls back to the shell", async () => {
    caches.entries.set(ORIGIN, html("<!doctype html>shell"));
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });

    const { response } = navigate(loadWorker());
    expect(await (await response).text()).toContain("shell");
  });
});
