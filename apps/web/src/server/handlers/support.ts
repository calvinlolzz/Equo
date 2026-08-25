import type { ApiError } from "../../contracts/errors.js";
import type { AuthenticatedContext } from "../auth/session.js";
import type { SupportRepository } from "../repositories/supportRepository.js";

type HandlerResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; body: ApiError };

const FEEDBACK_TYPES = ["problem", "suggestion", "confusing", "other"] as const;

export const FEEDBACK_MESSAGE_MAX = 2000;
const CONTACT_MAX = 200;
const PAGE_MAX = 300;
const ERROR_MESSAGE_MAX = 500;
const ERROR_CONTEXT_MAX = 2000;

export type CreateFeedbackRequest = {
  type?: string;
  message?: string;
  contact?: string;
  page?: string;
};

export type ReportErrorRequest = {
  source?: string;
  message?: string;
  context?: string;
  page?: string;
};

function clamp(value: string | undefined, max: number): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export async function handleCreateFeedback(
  repository: SupportRepository,
  context: AuthenticatedContext,
  request: CreateFeedbackRequest,
): Promise<HandlerResult<{ feedback: { id: string } }>> {
  const message = clamp(request.message, FEEDBACK_MESSAGE_MAX);

  if (!message) {
    return {
      ok: false,
      status: 400,
      body: {
        error: {
          code: "INVALID_FEEDBACK",
          message: "Feedback message must not be empty.",
          request_id: "req_feedback",
        },
      },
    };
  }

  const type = (FEEDBACK_TYPES as readonly string[]).includes(request.type ?? "")
    ? (request.type as string)
    : "other";

  const created = await repository.createFeedback(context.user.id, {
    type,
    message,
    contact: clamp(request.contact, CONTACT_MAX),
    page: clamp(request.page, PAGE_MAX),
  });

  return { ok: true, status: 201, body: { feedback: { id: created.id } } };
}

/**
 * Client error intake is deliberately forgiving: it always answers
 * {ok:true} (a broken error reporter must never cascade user-visible
 * failures), silently drops empty messages, and clamps every field so a
 * malicious client can't stuff megabytes into the log table.
 */
/** What the runtime needs to push, when the claim says this one is worth it. */
export type ErrorAlert = {
  fingerprint: string;
  message: string;
  occurrences: number;
  isNew: boolean;
};

export async function handleReportError(
  repository: SupportRepository,
  userId: string | null,
  request: ReportErrorRequest,
): Promise<HandlerResult<{ ok: true }> & { alert?: ErrorAlert }> {
  const message = clamp(request.message, ERROR_MESSAGE_MAX);
  const ok = { ok: true, status: 200, body: { ok: true } } as const;

  if (!message) return ok;

  const source = request.source === "admin" ? "admin" : "web";

  await repository.recordClientError(userId, {
    source,
    message,
    context: clamp(request.context, ERROR_CONTEXT_MAX),
    page: clamp(request.page, PAGE_MAX),
  });

  // Deliberately after the insert and deliberately in its own try: the error
  // row is the thing that must not be lost. A deployment running ahead of the
  // migration has no claim_error_alert to call, and losing the alert is a much
  // smaller problem than losing the crash report it was about.
  try {
    const claim = await repository.claimErrorAlert(source, message);

    if (claim.alert && claim.fingerprint) {
      return {
        ...ok,
        alert: {
          fingerprint: claim.fingerprint,
          message,
          occurrences: claim.occurrences_24h ?? 1,
          isNew: claim.reason === "new",
        },
      };
    }
  } catch (error) {
    console.warn("Error alert not claimed:", (error as Error).message);
  }

  return ok;
}
