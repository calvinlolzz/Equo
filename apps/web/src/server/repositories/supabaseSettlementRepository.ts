import type { ConfirmSettlementRequest } from "../../contracts/schemas.js";
import { calculateSettlement, type MemberBalance } from "../../domain/settlement.js";
import type { AuthenticatedContext } from "../auth/session.js";
import type { SupabaseQueryClient } from "./supabaseGroupRepository.js";
import { NOT_A_GROUP_MEMBER, type SettlementRecord, type SettlementRepository } from "./settlementRepository.js";

export function createSupabaseSettlementRepository(client: SupabaseQueryClient): SettlementRepository {
  return {
    async listBalances(groupId: string) {
      return client.one<MemberBalance[]>(
        `
          select member_id as "memberId", json_build_object(
            'amount_minor', balance_minor,
            'currency', currency
          ) as balance
          from public.group_member_balances
          where group_id = $1
        `,
        [groupId],
      );
    },

    /**
     * The transfer amounts are still computed here (domain/settlement.ts); only
     * the write moved into the database. It had been an insert of the settlement
     * followed by one insert per transfer, each its own PostgREST call - so a
     * failure partway through left a settlement carrying only some of its
     * transfers, which under-settles the group without any sign that it did.
     */
    async calculateCurrentSettlement(context: AuthenticatedContext, groupId: string) {
      const balances = await this.listBalances(groupId);
      const transfers = calculateSettlement(balances);

      const settlement = await client
        .one<SettlementRecord>(`select public.create_settlement($1, $2, $3, $4, $5) as settlement`, [
          groupId,
          context.user.id,
          Math.floor(Date.now() / 1000),
          balances.length,
          transfers.map((transfer) => ({
            from_member_id: transfer.fromMemberId,
            to_member_id: transfer.toMemberId,
            amount_minor: transfer.amount.amount_minor,
            currency: transfer.amount.currency,
          })),
        ])
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
      const member = await client.maybeOne<{ id: string }>(
        `
          select id
          from public.group_members
          where group_id = $1 and user_id = $2 and status = 'active'
          limit 1
        `,
        [groupId, context.user.id],
      );

      if (!member) {
        throw new Error(NOT_A_GROUP_MEMBER);
      }

      const current = await client.one<SettlementRecord>(
        `
          select id, group_id, settlement_version, calculated_version, status
          from public.settlements
          where group_id = $1 and id = $2
          limit 1
        `,
        [groupId, settlementId],
      );

      if (current.settlement_version !== request.settlement_version) {
        throw new Error("SETTLEMENT_VERSION_CONFLICT");
      }

      return client.one<SettlementRecord>(
        `
          update public.settlements
          set status = 'confirmed', confirmed_at = now()
          where group_id = $1 and id = $2 and settlement_version = $3
          returning id, group_id, settlement_version, calculated_version, status
        `,
        [groupId, settlementId, request.settlement_version],
      );
    },
  };
}
