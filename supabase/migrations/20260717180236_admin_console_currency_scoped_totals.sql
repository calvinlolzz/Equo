-- Admin console: scope every spend_total_minor to the group's own currency.
--
-- spend_total_minor summed expenses.amount_minor with no currency predicate,
-- but the UI labels the result with the group's currency. Every live expense
-- today is already in its group's currency (the composer converts before
-- submit, and a check confirmed 0 mismatched rows), so this is a no-op on
-- current data - but if a foreign-currency expense ever lands, the old sum
-- would add minor units across currencies and overstate the total under the
-- wrong symbol.
--
-- The fix mirrors what group_member_balances already does: only same-currency
-- rows are summed, because there is no exchange rate at read time to convert
-- the rest. This also makes admin_console_group_detail internally consistent -
-- its spend_total_minor and its per-member balance_minor now scope to the same
-- currency, instead of the total silently including rows the balances exclude.
--
-- All three functions that expose spend_total_minor change together so the same
-- group reads identically in the group list, a user's group list, and the group
-- detail page. Baseline definitions are reproduced verbatim except for the added
-- `and e.currency = <group>.currency` line.

CREATE OR REPLACE FUNCTION "public"."admin_console_groups"("p_search" "text", "p_limit" integer, "p_offset" integer, "p_filter" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with filtered as (
    select g.*
    from groups g
    where (
        p_search is null or p_search = ''
        or g.name ilike '%' || p_search || '%'
      )
      and case coalesce(nullif(p_filter, ''), 'all')
        when 'deleted' then g.deleted_at is not null
        when 'archived' then g.deleted_at is null and g.archived_at is not null
        when 'empty' then g.deleted_at is null and not exists (
          select 1 from expenses e where e.group_id = g.id and e.deleted_at is null
        )
        else g.deleted_at is null
      end
  ),
  page as (
    select
      f.id,
      f.name,
      f.currency,
      f.created_at,
      f.archived_at,
      f.deleted_at,
      (
        select count(*) from group_members gm
        where gm.group_id = f.id and gm.status = 'active'
      ) as member_count,
      (
        select count(*) from expenses e
        where e.group_id = f.id and e.deleted_at is null
      ) as expense_count,
      coalesce((
        select sum(e.amount_minor) from expenses e
        where e.group_id = f.id and e.deleted_at is null and e.kind = 'expense'
          and e.currency = f.currency
      ), 0) as spend_total_minor,
      (
        select max(e.created_at) from expenses e
        where e.group_id = f.id and e.deleted_at is null
      ) as last_expense_at,
      (
        select gm.display_name from group_members gm
        where gm.id = f.owner_member_id
      ) as owner_display_name
    from filtered f
    order by f.created_at desc
    limit greatest(p_limit, 0)
    offset greatest(p_offset, 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'groups', coalesce((select jsonb_agg(to_jsonb(page.*)) from page), '[]'::jsonb)
  );
$$;


CREATE OR REPLACE FUNCTION "public"."admin_console_user_detail"("p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when u.id is null then null else jsonb_build_object(
    'user', jsonb_build_object(
      'id', u.id,
      'email', u.email,
      'display_name', u.display_name,
      'avatar_url', u.avatar_url,
      'created_at', u.created_at,
      'last_seen_at', u.updated_at,
      'disabled_at', u.deleted_at,
      'group_count', (
        select count(*) from group_members gm
        join groups g on g.id = gm.group_id and g.deleted_at is null
        where gm.user_id = u.id and gm.status = 'active'
      ),
      'expense_count', (
        select count(*) from expenses e
        join group_members gm on gm.id = e.created_by_member_id
        where gm.user_id = u.id and e.deleted_at is null
      )
    ),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id,
        'name', g.name,
        'currency', g.currency,
        'role', gm.role,
        'member_status', gm.status,
        'joined_at', gm.created_at,
        'archived_at', g.archived_at,
        'member_count', (
          select count(*) from group_members gm2
          where gm2.group_id = g.id and gm2.status = 'active'
        ),
        'expense_count', (
          select count(*) from expenses e
          where e.group_id = g.id and e.deleted_at is null
        ),
        'spend_total_minor', coalesce((
          select sum(e.amount_minor) from expenses e
          where e.group_id = g.id and e.deleted_at is null and e.kind = 'expense'
            and e.currency = g.currency
        ), 0),
        'last_expense_at', (
          select max(e.created_at) from expenses e
          where e.group_id = g.id and e.deleted_at is null
        )
      ) order by gm.created_at desc)
      from group_members gm
      join groups g on g.id = gm.group_id and g.deleted_at is null
      where gm.user_id = u.id
    ), '[]'::jsonb)
  ) end
  from (select 1) placeholder
  left join users u on u.id = p_user_id;
$$;


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
      -- Same-currency only, matching balance_minor below and the app's own
      -- balance screen (no read-time rate to fold in other currencies).
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
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end
$$;
