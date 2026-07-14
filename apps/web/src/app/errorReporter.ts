import { createApiClient } from "./apiClient";

export type ReporterState = {
  seen: Set<string>;
  sentCount: number;
};

export const ERROR_REPORT_SESSION_CAP = 5;

export function createReporterState(): ReporterState {
  return { seen: new Set(), sentCount: 0 };
}

/**
 * Gate for one candidate report: dedupes repeated identical messages (a
 * render-loop crash fires the same error hundreds of times) and caps the
 * total sent per page load so a pathological session can't flood the log
 * table. Mutates state when it admits the message.
 */
export function shouldReport(state: ReporterState, message: string): boolean {
  const key = message.slice(0, 200);
  if (!key.trim()) return false;
  if (state.sentCount >= ERROR_REPORT_SESSION_CAP) return false;
  if (state.seen.has(key)) return false;

  state.seen.add(key);
  state.sentCount += 1;
  return true;
}

/** Normalizes the mixed shapes error/unhandledrejection events carry. */
export function describeErrorEvent(input: unknown): { message: string; context: string | null } {
  if (input instanceof Error) {
    return { message: input.message || String(input), context: input.stack ?? null };
  }
  if (typeof input === "string") {
    return { message: input, context: null };
  }
  try {
    return { message: JSON.stringify(input)?.slice(0, 500) ?? "unknown error", context: null };
  } catch {
    return { message: "unknown error", context: null };
  }
}

/**
 * Installs window-level error + unhandledrejection listeners that POST to
 * /api/v1/errors. The equo_session cookie attributes the report when the user
 * is logged in - the browser attaches it on its own, and the endpoint also
 * accepts anonymous pre-login reports, which are the ones most worth hearing
 * about. Every failure path here is swallowed - the reporter must never become
 * an error source itself.
 */
export function installErrorReporter(source: "web" | "admin") {
  if (typeof window === "undefined") return;

  const state = createReporterState();

  function send(message: string, context: string | null) {
    if (!shouldReport(state, message)) return;

    try {
      const client = createApiClient();
      void client
        .reportClientError({
          source,
          message,
          context: context ?? undefined,
          page: window.location.pathname,
        })
        .catch(() => {});
    } catch {
      // Never let the reporter throw.
    }
  }

  window.addEventListener("error", (event) => {
    const described = describeErrorEvent(event.error ?? event.message);
    send(described.message, described.context);
  });

  window.addEventListener("unhandledrejection", (event) => {
    const described = describeErrorEvent(event.reason);
    send(described.message, described.context);
  });
}
