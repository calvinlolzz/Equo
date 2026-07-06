import type { ConfirmSettlementRequest } from "../../contracts/schemas.js";
import type { MemberBalance, SettlementTransfer } from "../../domain/settlement.js";
import type { AuthenticatedContext } from "../auth/session.js";

/**
 * Thrown by the Supabase settlement repository when the caller has no active
 * membership row in the target group (calculate and confirm both require
 * one). Routes catch this by message and map it to a clean 403 FORBIDDEN
 * instead of letting a "no rows" error from the underlying query surface as
 * an unhandled 500.
 */
export const NOT_A_GROUP_MEMBER = "NOT_A_GROUP_MEMBER";

export type SettlementRecord = {
  id: string;
  group_id: string;
  settlement_version: number;
  calculated_version: number;
  status: "draft" | "confirmed" | "superseded";
};

export type SettlementRepository = {
  listBalances(groupId: string): Promise<MemberBalance[]>;
  calculateCurrentSettlement(
    context: AuthenticatedContext,
    groupId: string,
  ): Promise<{
    settlement: SettlementRecord;
    transfers: SettlementTransfer[];
  }>;
  confirmSettlement(
    context: AuthenticatedContext,
    groupId: string,
    settlementId: string,
    request: ConfirmSettlementRequest,
  ): Promise<SettlementRecord>;
};
