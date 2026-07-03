import type { ConfirmSettlementRequest } from "../../contracts/schemas.js";
import type { MemberBalance, SettlementTransfer } from "../../domain/settlement.js";
import type { AuthenticatedContext } from "../auth/session.js";

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
