import { createApiClient } from "../apiClient";
import { createReporterState, shouldReport } from "../errorReporter";

/**
 * Makes CSP gaps visible from a phone.
 *
 * The LIFF SDK reaches for a few origins, and which of them the policy must
 * allow can only be settled on a device inside LINE. A refused request leaves
 * nothing but a console line nobody can open there, so every
 * securitypolicyviolation on /liff is reported (deduped and capped by the same
 * rules as crash reports) to POST /errors.
 *
 * What is sent is the blocked URI's ORIGIN and the directive, never the path
 * or query: on this page those can hold LINE tokens and entry keys.
 */

/**
 * Origins the SDK requests on every open, that we deliberately keep blocked:
 * - static.line-scdn.net: "legacy client extensions" (scanCode and friends) loaded
 *   as a script. Init warns and carries on when it fails.
 * - liffsdk.line-scdn.net: the SDK's own UI translations. Init falls back to raw keys.
 * Reporting them would put two rows in the error log on every single open and
 * bury the one a real gap would add.
 */
export const EXPECTED_BLOCKED_ORIGINS: ReadonlySet<string> = new Set([
  "https://static.line-scdn.net",
  "https://liffsdk.line-scdn.net",
]);

export type CspViolation = { blockedURI: string; effectiveDirective: string };

/** `https://host` for a URL, the scheme for data:/blob:, the keyword for inline/eval, else "unknown". */
export function blockedOrigin(blockedURI: string): string {
  try {
    const url = new URL(blockedURI);
    if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
    return url.protocol;
  } catch {
    return /^[a-z-]{1,20}$/.test(blockedURI) ? blockedURI : "unknown";
  }
}

export function describeViolation(violation: CspViolation): string | null {
  const origin = blockedOrigin(violation.blockedURI);
  if (EXPECTED_BLOCKED_ORIGINS.has(origin)) return null;
  const directive = /^[a-z-]{1,30}$/.test(violation.effectiveDirective) ? violation.effectiveDirective : "unknown";
  return `[liff csp] blocked ${origin} (${directive})`;
}

type ViolationTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;

export type CspReportSender = (report: { source: string; message: string; page: string }) => void;

function defaultSender(report: { source: string; message: string; page: string }): void {
  try {
    void createApiClient()
      .reportClientError(report)
      .catch(() => {});
  } catch {
    // Never let the reporter throw.
  }
}

/** Starts listening; returns the function that stops. */
export function installCspViolationReporter(
  options: { target?: ViolationTarget; send?: CspReportSender; page?: () => string } = {},
): () => void {
  const target = options.target ?? document;
  const send = options.send ?? defaultSender;
  const page = options.page ?? (() => window.location.pathname);
  const state = createReporterState();

  const listener = (event: Event) => {
    const violation = event as SecurityPolicyViolationEvent;
    const message = describeViolation({
      blockedURI: String(violation.blockedURI ?? ""),
      effectiveDirective: String(violation.effectiveDirective ?? ""),
    });
    if (!message || !shouldReport(state, message)) return;
    send({ source: "liff", message, page: page() });
  };

  target.addEventListener("securitypolicyviolation", listener);
  return () => target.removeEventListener("securitypolicyviolation", listener);
}
