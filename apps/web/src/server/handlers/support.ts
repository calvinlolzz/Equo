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
export async function handleReportError(
  repository: SupportRepository,
  userId: string | null,
  request: ReportErrorRequest,
): Promise<HandlerResult<{ ok: true }>> {
  const message = clamp(request.message, ERROR_MESSAGE_MAX);

  if (message) {
    await repository.recordClientError(userId, {
      source: request.source === "admin" ? "admin" : "web",
      message,
      context: clamp(request.context, ERROR_CONTEXT_MAX),
      page: clamp(request.page, PAGE_MAX),
    });
  }

  return { ok: true, status: 200, body: { ok: true } };
}
