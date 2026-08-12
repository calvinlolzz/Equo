import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * Lazy chunks that survive a deploy landing under an open tab.
 *
 * The failure this exists for, from the error log (five occurrences between
 * 2026-08-04 and 2026-08-11, every one of them on a /group/ page with
 * Lazy/Suspense in the stack):
 *
 *   1. Somebody has the app open. Their index.html references, say,
 *      RecordsPanel-XYZ.js.
 *   2. A deploy ships. The build is content-hashed, so that panel is now
 *      RecordsPanel-ABC.js and the old filename is gone.
 *   3. They tap 記錄. The still-running old page imports the old filename.
 *
 * What comes back is not a 404: the SPA rewrite hands index.html to anything it
 * doesn't recognise, so the browser gets HTML with a 200 and tries to parse it
 * as a module. Hence the two spellings in the log — Safari says "Importing a
 * module script failed", Firefox and Chrome say "'text/html' is not a valid
 * JavaScript MIME type". (vercel.json now excludes /assets/ from that rewrite,
 * so this arrives as an honest 404, but the import fails either way and old
 * tabs predate that change.)
 *
 * Retrying the same URL is pointless — the file really is gone. The only way
 * out is to reload, which fetches the current index.html and with it the
 * current chunk names. That does discard whatever was on screen, which is why
 * it is fenced in as tightly as it is below: only for errors that look like
 * this one, only when online, and at most once per cooldown.
 */

/** Marker for the reload guard. sessionStorage, so a new tab starts clean. */
const RELOAD_MARKER_KEY = "equo.staleChunkReload";

/**
 * Two reloads closer together than this means reloading is not fixing it —
 * a genuinely broken deploy, say — so the second one is refused and the error
 * surfaces instead. Long enough to break a loop, short enough that a second
 * deploy later in the same session still gets its own recovery.
 */
const RELOAD_COOLDOWN_MS = 30_000;

/**
 * How the browsers word this. Matched on the message rather than the error
 * type because every one of them throws a plain TypeError.
 */
const STALE_CHUNK_MESSAGES = [
  "importing a module script failed", // Safari
  "is not a valid javascript mime type", // Firefox / Chrome, when HTML comes back
  "failed to fetch dynamically imported module", // Chrome
  "error loading dynamically imported module", // Vite's own wrapper
  "unable to preload css",
];

/**
 * Whether this looks like a chunk that isn't there any more, as opposed to a
 * module that loaded fine and threw on the way up.
 *
 * Deliberately narrow: a reload is a destructive recovery, and applying it to
 * an ordinary crash inside a panel would turn one broken panel into a page that
 * throws away the user's screen every time they open it.
 */
export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();
  return STALE_CHUNK_MESSAGES.some((pattern) => lower.includes(pattern));
}

export type ChunkRecoveryDeps = {
  /** False while offline — a failed import is then expected, and reloading makes it worse. */
  isOnline: () => boolean;
  /** Records this reload and reports whether one is allowed; false if another just happened. */
  claimReload: () => boolean;
  reload: () => void;
};

function defaultDeps(): ChunkRecoveryDeps {
  return {
    isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
    claimReload: () => {
      // Storage being unavailable (private mode, blocked site data) must not
      // hand out an unguarded reload - without the marker there is nothing to
      // stop a loop, so the safe answer is "no".
      let storage: Storage;
      try {
        storage = window.sessionStorage;
      } catch {
        return false;
      }
      try {
        const previous = Number(storage.getItem(RELOAD_MARKER_KEY) ?? 0);
        if (Number.isFinite(previous) && Date.now() - previous < RELOAD_COOLDOWN_MS) return false;
        storage.setItem(RELOAD_MARKER_KEY, String(Date.now()));
        return true;
      } catch {
        return false;
      }
    },
    reload: () => window.location.reload(),
  };
}

/**
 * Run a dynamic import, recovering from a stale chunk by reloading.
 *
 * On the recovery path the returned promise never settles. That is on purpose:
 * the page is on its way out, and resolving or rejecting would let React paint
 * one frame of a Suspense fallback or an error boundary first — a flash of
 * "something went wrong" immediately before the reload that fixes it.
 */
export async function loadChunk<T>(load: () => Promise<T>, deps: ChunkRecoveryDeps = defaultDeps()): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (!isStaleChunkError(error) || !deps.isOnline() || !deps.claimReload()) throw error;
    deps.reload();
    return new Promise<T>(() => {});
  }
}

/**
 * React.lazy, with the recovery above. Same call shape, so a chunk is opted in
 * by swapping the wrapper and nothing else.
 */
// The constraint mirrors React's own lazy() signature exactly. Narrowing the
// props type here (to `never`, say) makes every component that takes props fail
// to match, so the `any` is load-bearing rather than laziness.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyChunk<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() => loadChunk(load));
}
