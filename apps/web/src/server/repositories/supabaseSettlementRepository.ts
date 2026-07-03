import type { ConfirmSettlementRequest } from "../../contracts/schemas.js";
import { calculateSettlement, type MemberBalance } from "../../domain/settlement.js";
import type { AuthenticatedContext } from "../auth/session.js";
import type { SupabaseQueryClient } from "./supabaseGroupRepository.js";
import type { SettlementRecord, SettlementRepository } from "./settlementRepository.js";

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

    async calculateCurrentSettlement(context: AuthenticatedContext, groupId: string) {
      const member = await client.one<{ id: string }>(
        `
          select id
          from public.group_members
          where group_id = $1 and user_id = $2 and status = 'active'
          limit 1
        `,
        [groupId, context.user.id],
      );
      const balances = await this.listBalances(groupId);
      const transfers = calculateSettlement(balances);
      const settlement = await client.one<SettlementRecord>(
        `
          insert into public.settlements (
            group_id,
            settlement_version,
            calculated_version,
            status,
            created_by_member_id
          )
          values ($1, $2, $3, 'draft', $4)
          returning id, group_id, settlement_version, calculated_version, status
        `,
        [groupId, Math.floor(Date.now() / 1000), balances.length, member.id],
      );

      for (const transfer of transfers) {
        await client.exec(
          `
            insert into public.settlement_transfers (
              settlement_id,
              from_member_id,
              to_member_id,
              amount_minor,
              currency
            )
            values ($1, $2, $3, $4, $5)
          `,
          [
            settlement.id,
            transfer.fromMemberId,
            transfer.toMemberId,
            transfer.amount.amount_minor,
            transfer.amount.currency,
          ],
        );
      }

      return { settlement, transfers };
    },

    async confirmSettlement(
      _context: AuthenticatedContext,
      groupId: string,
      settlementId: string,
      request: ConfirmSettlementRequest,
    ) {
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
