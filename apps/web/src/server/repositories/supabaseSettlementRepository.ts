import type { ConfirmSettlementRequest } from "../../contracts/schemas.js";
import { calculateSettlement, type MemberBalance } from "../../domain/settlement.js";
import type { AuthenticatedContext } from "../auth/session.js";
import {
  columns,
  eq,
  limit,
  query,
  requireRow,
  type PostgrestClient,
} from "../db/postgrestClient.js";
import { NOT_A_GROUP_MEMBER, type SettlementRecord, type SettlementRepository } from "./settlementRepository.js";

const SETTLEMENT_COLUMNS = "id,group_id,settlement_version,calculated_version,status";

function nowIso(): string {
  return new Date().toISOString();
}

export function createSupabaseSettlementRepository(client: PostgrestClient): SettlementRepository {
  return {
    async listBalances(groupId: string): Promise<MemberBalance[]> {
      const rows = await client.select<{ member_id: string; balance_minor: number; currency: string }>(
        "group_member_balances",
        query(columns("member_id,balance_minor,currency"), eq("group_id", groupId)),
      );

      return rows.map((row) => ({
        memberId: row.member_id,
        balance: { amount_minor: row.balance_minor, currency: row.currency },
      }));
    },

    /**
     * The transfer amounts are computed here (domain/settlement.ts); only the
     * write lives in the database. It used to be an insert of the settlement
     * followed by one insert per transfer, each its own PostgREST call - so a
     * failure partway through left a settlement carrying only some of its
     * transfers, which under-settles the group with nothing to show that it did.
     */
    async calculateCurrentSettlement(context: AuthenticatedContext, groupId: string) {
      const balances = await this.listBalances(groupId);
      const transfers = calculateSettlement(balances);

      const settlement = await client
        .rpc<SettlementRecord>("create_settlement", {
          p_group_id: groupId,
          p_user_id: context.user.id,
          // Postgres integer: seconds, not milliseconds.
          p_settlement_version: Math.floor(Date.now() / 1000),
          p_calculated_version: balances.length,
          p_transfers: transfers.map((transfer) => ({
            from_member_id: transfer.fromMemberId,
            to_member_id: transfer.toMemberId,
            amount_minor: transfer.amount.amount_minor,
            currency: transfer.amount.currency,
          })),
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          throw message.includes(NOT_A_GROUP_MEMBER) ? new Error(NOT_A_GROUP_MEMBER) : error;
        });

      return { settlement, transfers };
    },

    async confirmSettlement(
      context: AuthenticatedContext,
      groupId: string,
      settlementId: string,
      request: ConfirmSettlementRequest,
    ) {
      const member = await client.select<{ id: string }>(
        "group_members",
        query(
          columns("id"),
          eq("group_id", groupId),
          eq("user_id", context.user.id),
          eq("status", "active"),
          limit(1),
        ),
      );

      if (!member[0]) {
        throw new Error(NOT_A_GROUP_MEMBER);
      }

      const current = requireRow(
        await client.select<SettlementRecord>(
          "settlements",
          query(columns(SETTLEMENT_COLUMNS), eq("group_id", groupId), eq("id", settlementId), limit(1)),
        ),
        "settlement",
      );

      if (current.settlement_version !== request.settlement_version) {
        throw new Error("SETTLEMENT_VERSION_CONFLICT");
      }

      // settlement_version in the filter is the optimistic-concurrency check:
      // if another confirm landed between the read above and this write, it has
      // already moved the version and this matches nothing.
      return requireRow(
        await client.update<SettlementRecord>(
          "settlements",
          query(
            eq("group_id", groupId),
            eq("id", settlementId),
            eq("settlement_version", request.settlement_version),
            columns(SETTLEMENT_COLUMNS),
          ),
          { status: "confirmed", confirmed_at: nowIso() },
        ),
        "settlement",
      );
    },
  };
}
