-- Admin console: group drill-down (members + per-expense detail with images).
--
-- admin_console_groups only ever returned per-group aggregates, so the console
-- could not answer "what did this group actually spend on" or show a receipt
-- photo. These two functions are the drill-down: the detail reads the group and
-- its roster, the expense listing pages through the expenses themselves with
-- their payers, shares, and image URLs attached.
--
-- Reading a group's expenses exposes personal financial data, so both functions
-- record a 'group.view' audit row in the same transaction as the read - they
-- are separately callable endpoints, so auditing only the detail would leave
-- the expense listing (the sensitive half) reachable unaudited. Both go through
-- admin_log_group_view, which collapses repeats inside a 5-minute window so a
-- single drill-in and its pagination clicks produce one row rather than burying
-- the write actions in noise.

-- One drill-in should be one audit row. The console loads the detail and the
-- first expense page together, and an admin paging through expenses is still
-- the same act of looking - so repeats by the same admin on the same group
-- inside this window are folded into the first row.
CREATE OR REPLACE FUNCTION "public"."admin_log_group_view"(
  "p_actor" "uuid",
  "p_actor_email" "text",
  "p_group_id" "uuid",
  "p_group_name" "text"
) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if exists (
    select 1 from admin_audit_logs l
    where l.action = 'group.view'
      and l.admin_id is not distinct from p_actor
      and l.metadata ->> 'group_id' = p_group_id::text
      and l.created_at > now() - interval '5 minutes'
  ) then
    return;
  end if;

  insert into admin_audit_logs (admin_id, admin_email, action, metadata)
  values (
    p_actor,
    p_actor_email,
    'group.view',
    jsonb_build_object('group_id', p_group_id, 'name', p_group_name)
  );
end
$$;


ALTER FUNCTION "public"."admin_log_group_view"("p_actor" "uuid", "p_actor_email" "text", "p_group_id" "uuid", "p_group_name" "text") OWNER TO "postgres";

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
      -- Deleted expenses are listable (p_include_deleted), so surface how many
      -- exist - otherwise the toggle looks broken on a group that has none.
      'deleted_expense_count', (
        select count(*) from expenses e
        where e.group_id = v_row.id and e.deleted_at is not null
      ),
      'spend_total_minor', coalesce((
        select sum(e.amount_minor) from expenses e
        where e.group_id = v_row.id and e.deleted_at is null and e.kind = 'expense'
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
            -- Balance in the group's own currency only. A member holding rows
            -- in another currency (a foreign-currency expense) is not summed
            -- in - there is no rate to convert at read time - so this matches
            -- what the app shows on the group's balance screen.
            --
            -- Joined once for the whole roster rather than looked up per
            -- member: group_member_balances is four CTEs over every expense,
            -- payment and share row in the database, so a correlated subquery
            -- here would re-run that whole aggregate once per member.
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


ALTER FUNCTION "public"."admin_console_group_detail"("p_actor" "uuid", "p_actor_email" "text", "p_group_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_console_group_expenses"(
  "p_actor" "uuid",
  "p_actor_email" "text",
  "p_group_id" "uuid",
  "p_limit" integer,
  "p_offset" integer,
  "p_include_deleted" boolean
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_name text;
begin
  select name into v_name from groups where id = p_group_id;

  if v_name is null then
    return null;
  end if;

  perform admin_log_group_view(p_actor, p_actor_email, p_group_id, v_name);

  return (
    with filtered as (
      select e.*
      from expenses e
      where e.group_id = p_group_id
        and (coalesce(p_include_deleted, false) or e.deleted_at is null)
    ),
    page as (
      select
        f.id,
        f.title,
        f.kind,
        f.category,
        -- amount_minor is the source of truth the app writes and splits
        -- against; the legacy numeric amount column is not surfaced here on
        -- purpose.
        f.amount_minor,
        f.currency,
        f.expense_date,
        f.note,
        f.image_url,
        f.receipt_image_url,
        f.created_at,
        f.deleted_at,
        f.version,
        (
          select gm.display_name from group_members gm
          where gm.id = f.created_by_member_id
        ) as created_by_name,
        (
          select gm.display_name from group_members gm
          where gm.id = f.transfer_to_member_id
        ) as transfer_to_name,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'member_id', ep.payer_member_id,
            'display_name', gm.display_name,
            'amount_minor', ep.amount_minor,
            'currency', ep.currency
          ) order by ep.amount_minor desc)
          from expense_payments ep
          left join group_members gm on gm.id = ep.payer_member_id
          where ep.expense_id = f.id
        ), '[]'::jsonb) as payers,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'member_id', es.member_id,
            'display_name', gm.display_name,
            'share_type', es.share_type,
            'share_value', es.share_value,
            'amount_minor', es.amount_minor
          ) order by es.amount_minor desc)
          from expense_shares es
          left join group_members gm on gm.id = es.member_id
          where es.expense_id = f.id
        ), '[]'::jsonb) as shares
      from filtered f
      order by f.expense_date desc, f.created_at desc
      limit greatest(p_limit, 0)
      offset greatest(p_offset, 0)
    )
    select jsonb_build_object(
      'total', (select count(*) from filtered),
      -- Ordered inside the aggregate too: the CTE's ORDER BY fixes which rows
      -- the page contains, but not the order they reach jsonb_agg in.
      'expenses', coalesce((
        select jsonb_agg(to_jsonb(page.*) order by page.expense_date desc, page.created_at desc)
        from page
      ), '[]'::jsonb)
    )
  );
end
$$;


ALTER FUNCTION "public"."admin_console_group_expenses"("p_actor" "uuid", "p_actor_email" "text", "p_group_id" "uuid", "p_limit" integer, "p_offset" integer, "p_include_deleted" boolean) OWNER TO "postgres";


REVOKE ALL ON FUNCTION "public"."admin_console_group_detail"("p_actor" "uuid", "p_actor_email" "text", "p_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_group_detail"("p_actor" "uuid", "p_actor_email" "text", "p_group_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."admin_console_group_expenses"("p_actor" "uuid", "p_actor_email" "text", "p_group_id" "uuid", "p_limit" integer, "p_offset" integer, "p_include_deleted" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_group_expenses"("p_actor" "uuid", "p_actor_email" "text", "p_group_id" "uuid", "p_limit" integer, "p_offset" integer, "p_include_deleted" boolean) TO "service_role";

-- Not granted to service_role: only the two admin_console_* functions above
-- call it, and they run as their owner.
REVOKE ALL ON FUNCTION "public"."admin_log_group_view"("p_actor" "uuid", "p_actor_email" "text", "p_group_id" "uuid", "p_group_name" "text") FROM PUBLIC;
