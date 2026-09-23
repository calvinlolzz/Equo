import type { ApiError } from "../../contracts/errors.js";
import type { AuthenticatedContext } from "../auth/session.js";
import type { SpendBreakdownRecord, SpendPeriodKind, SpendRepository } from "../repositories/spendRepository.js";

type HandlerResult<T> = { ok: true; status: number; body: T } | { ok: false; status: number; body: ApiError };

const YEAR_KEY = /^\d{4}$/;
const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Normalises the two query params before they reach SQL.
 *
 * A malformed key is dropped rather than rejected: the RPC falls back to the
 * newest period for an unknown key, so a stale bookmark renders the current
 * period instead of a 400 the user can do nothing about. An outright wrong
 * *kind* is likewise folded to 'year' (the default view).
 */
export function parseSpendPeriod(kind: string | undefined, key: string | undefined) {
  const periodKind: SpendPeriodKind = kind === "month" ? "month" : "year";
  const pattern = periodKind === "month" ? MONTH_KEY : YEAR_KEY;
  return { periodKind, periodKey: key && pattern.test(key) ? key : null };
}

export async function handleGetSpendBreakdown(
  repository: SpendRepository,
  context: AuthenticatedContext,
  groupId: string,
  query: { kind?: string; key?: string },
  request_id = "req_spend_breakdown",
): Promise<HandlerResult<SpendBreakdownRecord>> {
  const { periodKind, periodKey } = parseSpendPeriod(query.kind, query.key);
  const breakdown = await repository.getSpendBreakdown(context.user.id, groupId, periodKind, periodKey);

  // Same collapse as handleGetGroupDetail: not-a-member and no-such-group are
  // one response, so the API never confirms a group id exists.
  if (!breakdown) {
    return {
      ok: false,
      status: 403,
      body: { error: { code: "FORBIDDEN", message: "You are not a member of this group.", request_id } },
    };
  }

  return { ok: true, status: 200, body: breakdown };
}
