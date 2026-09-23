import type { ApiError } from "../../contracts/errors.js";
import type { AuthenticatedContext } from "../auth/session.js";
import type {
  PersonalGroupSharesRecord,
  PersonalSharesRepository,
  SpendBreakdownRecord,
  SpendPeriodKind,
  SpendRepository,
} from "../repositories/spendRepository.js";

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

/**
 * GET /api/v1/me/group-shares - the personal ledger home's "本月群組分攤".
 *
 * A missing or malformed month is a 400: unlike the spend-breakdown period
 * key (which degrades to "the newest period" because there is always a
 * sensible default), there is no fallback month that wouldn't just be wrong,
 * and the repository is never called for one - see personalLedger.ts's
 * combineLedgerMonth on the client, which treats "no data for this exact
 * month" as sharesKnown:false rather than zero.
 */
export async function handleGetPersonalGroupShares(
  repository: PersonalSharesRepository,
  context: AuthenticatedContext,
  query: { month?: string },
  request_id = "req_personal_group_shares",
): Promise<HandlerResult<PersonalGroupSharesRecord>> {
  const month = query.month;

  if (!month || !MONTH_KEY.test(month)) {
    return {
      ok: false,
      status: 400,
      body: { error: { code: "MALFORMED_REQUEST", message: "month must be YYYY-MM.", request_id } },
    };
  }

  const result = await repository.getMonthGroupShares(context.user.id, month);

  if (!result) {
    return { ok: true, status: 200, body: { month, groups: [] } };
  }

  return { ok: true, status: 200, body: { month, groups: Array.isArray(result.groups) ? result.groups : [] } };
}
