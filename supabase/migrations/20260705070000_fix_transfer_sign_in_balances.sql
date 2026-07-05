-- Align transfer semantics with the app: the transfer payer GIVES money
-- (their balance goes up: they are owed more / owe less), the recipient
-- receives it (balance goes down). Previously the view applied the
-- opposite signs; nothing user-facing consumed it yet (the client
-- computes balances locally with the corrected semantics).
create or replace view public.group_member_balances as
 with paid as (
         select e.group_id, ep.payer_member_id as member_id, ep.currency,
            sum(ep.amount_minor)::integer as paid_minor
           from public.expenses e
             join public.expense_payments ep on ep.expense_id = e.id
          where e.deleted_at is null and e.kind in ('expense', 'income')
          group by e.group_id, ep.payer_member_id, ep.currency
        ), shared as (
         select e.group_id, es.member_id, e.currency,
            sum(es.amount_minor)::integer as shared_minor
           from public.expenses e
             join public.expense_shares es on es.expense_id = e.id
          where e.deleted_at is null and e.kind in ('expense', 'income')
          group by e.group_id, es.member_id, e.currency
        ), transfers_given as (
         select e.group_id, ep.payer_member_id as member_id, ep.currency,
            sum(ep.amount_minor)::integer as transfer_given_minor
           from public.expenses e
             join public.expense_payments ep on ep.expense_id = e.id
          where e.deleted_at is null and e.kind = 'transfer'
          group by e.group_id, ep.payer_member_id, ep.currency
        ), transfers_received as (
         select e.group_id, e.transfer_to_member_id as member_id, e.currency,
            sum(e.amount_minor)::integer as transfer_received_minor
           from public.expenses e
          where e.deleted_at is null and e.kind = 'transfer' and e.transfer_to_member_id is not null
          group by e.group_id, e.transfer_to_member_id, e.currency
        ), member_currency as (
         select group_id, member_id, currency from paid
        union
         select group_id, member_id, currency from shared
        union
         select group_id, member_id, currency from transfers_given
        union
         select group_id, member_id, currency from transfers_received
        )
 select mc.group_id, mc.member_id, mc.currency,
    coalesce(paid.paid_minor, 0)
      - coalesce(shared.shared_minor, 0)
      + coalesce(tg.transfer_given_minor, 0)
      - coalesce(tr.transfer_received_minor, 0) as balance_minor
   from member_currency mc
     left join paid on paid.group_id = mc.group_id and paid.member_id = mc.member_id and paid.currency = mc.currency
     left join shared on shared.group_id = mc.group_id and shared.member_id = mc.member_id and shared.currency = mc.currency
     left join transfers_given tg on tg.group_id = mc.group_id and tg.member_id = mc.member_id and tg.currency = mc.currency
     left join transfers_received tr on tr.group_id = mc.group_id and tr.member_id = mc.member_id and tr.currency = mc.currency;
