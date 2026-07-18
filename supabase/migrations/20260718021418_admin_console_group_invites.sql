-- Admin console: add the group's invite codes to the group-detail drill-down.
--
-- The group detail already returns the roster and (via a sibling RPC) the
-- expenses, but not invites - so an admin can't see how a group is being
-- joined, spot an over-permissioned code (max_uses in the hundreds), or notice
-- a still-live invite that should have been revoked. This adds an `invites`
-- array to admin_console_group_detail.
--
-- token_hash is deliberately NOT returned: only the hash is stored (never the
-- raw code), so it can't reconstruct a joinable link and would just be noise.
-- Status (live / revoked / expired / used-up) is derived client-side from these
-- raw fields so the rule stays unit-testable.
--
-- Settlements are intentionally left out: the settlements table is 9 abandoned
-- drafts (0 confirmed, 0 transfers), and the actual 清償 are transfer-kind
-- expenses, already shown in the expense drill-down.
--
-- Reproduces the current (currency-scoped) definition verbatim; the only change
-- is the added top-level 'invites' key.
CREATE OR REPLACE FUNCTION "public"."admin_console_group_detail"(
  "p_actor" "uuid",
  "p_actor_email" "text",
  "p_group_id" "uuid"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row groups%rowtype;
  v_result jsonb;
begin
  select * into v_row from groups where id = p_group_id;

  if v_row.id is null then
    return null;
  end if;

  perform admin_log_group_view(p_actor, p_actor_email, v_row.id, v_row.name);

  select jsonb_build_object(
    'group', jsonb_build_object(
      'id', v_row.id,
      'name', v_row.name,
      'currency', v_row.currency,
      'created_at', v_row.created_at,
      'archived_at', v_row.archived_at,
      'deleted_at', v_row.deleted_at,
      'cover_image_url', v_row.cover_image_url,
      'member_count', (
        select count(*) from group_members gm
        where gm.group_id = v_row.id and gm.status = 'active'
      ),
      'expense_count', (
        select count(*) from expenses e
        where e.group_id = v_row.id and e.deleted_at is null
      ),
      'deleted_expense_count', (
        select count(*) from expenses e
        where e.group_id = v_row.id and e.deleted_at is not null
      ),
      'spend_total_minor', coalesce((
        select sum(e.amount_minor) from expenses e
        where e.group_id = v_row.id and e.deleted_at is null and e.kind = 'expense'
          and e.currency = v_row.currency
      ), 0),
      'last_expense_at', (
        select max(e.created_at) from expenses e
        where e.group_id = v_row.id and e.deleted_at is null
      ),
      'owner_display_name', (
        select gm.display_name from group_members gm
        where gm.id = v_row.owner_member_id
      )
    ),
    'members', coalesce((
      select jsonb_agg(member.data order by member.sort_key, member.display_name)
      from (
        select
          jsonb_build_object(
            'id', gm.id,
            'user_id', gm.user_id,
            'display_name', gm.display_name,
            'email', u.email,
            'avatar_url', coalesce(u.avatar_url, gm.photo_url),
            'role', gm.role,
            'status', gm.status,
            'joined_at', gm.created_at,
            'expense_count', (
              select count(*) from expenses e
              where e.created_by_member_id = gm.id and e.deleted_at is null
            ),
            'balance_minor', coalesce(b.balance_minor, 0)
          ) as data,
          case when gm.id = v_row.owner_member_id then 0 else 1 end as sort_key,
          gm.display_name
        from group_members gm
        left join users u on u.id = gm.user_id
        left join group_member_balances b
          on b.group_id = gm.group_id
          and b.member_id = gm.id
          and b.currency = v_row.currency
        where gm.group_id = v_row.id
      ) member
    ), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'max_uses', i.max_uses,
        'use_count', i.use_count,
        'expires_at', i.expires_at,
        'revoked_at', i.revoked_at,
        'created_at', i.created_at,
        'created_by_name', (
          select gm.display_name from group_members gm
          where gm.id = i.created_by_member_id
        )
      ) order by i.created_at desc)
      from invites i
      where i.group_id = v_row.id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end
$$;
