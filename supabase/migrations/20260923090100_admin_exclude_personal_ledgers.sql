-- Admin console: exclude personal ledgers from overview counts and trends.
--
-- admin_console_overview's group_count/active_groups_7d and
-- admin_console_trends's new_groups counted every group indiscriminately,
-- including the personal ledger ensure_personal_ledger (20260922090000)
-- creates transparently for every account. A personal ledger is not
-- something an admin manages, invites members to, or would recognise as
-- "a group" in the dashboard's sense, so it is excluded here the same way
-- `kind = 'shared'` already gates it in personal_month_group_shares and
-- elsewhere.
--
-- Anchor-and-hit-count patch on the live function text, same pattern as
-- 20260922090000_personal_ledger.sql's admin_console_merge_users patch:
-- both functions are long, and each change here is one clause. Each block
-- is independently idempotent (skips if its own marker is already present),
-- so re-running this migration after a partial apply is safe.

-- ---------------------------------------------------------------------------
-- admin_console_overview: group_count, active_groups_7d
-- ---------------------------------------------------------------------------

DO $patch$
declare
  v_def text;
  v_a1 constant text := $anchor1$'group_count', (select count(*) from groups where deleted_at is null)$anchor1$;
  v_r1 constant text := $repl1$'group_count', (select count(*) from groups where deleted_at is null and kind <> 'personal')$repl1$;
  v_a2 constant text := $anchor2$count(distinct group_id) from expenses$anchor2$;
  -- Aliased back to `expenses` so the trailing `where deleted_at is null and
  -- created_at > now() - interval '7 days'` that follows this anchor in the
  -- live function keeps applying to the filtered subquery unchanged.
  v_r2 constant text := $repl2$count(distinct group_id) from (select x.* from expenses x where not exists (select 1 from groups pg where pg.id = x.group_id and pg.kind = 'personal')) expenses$repl2$;
  v_hits integer;
begin
  v_def := pg_get_functiondef('public.admin_console_overview()'::regprocedure);

  if position($$kind <> 'personal'$$ in v_def) > 0 then
    raise notice 'admin_console_overview already patched, skipping';
  else
    v_hits := (length(v_def) - length(replace(v_def, v_a1, ''))) / length(v_a1);
    if v_hits <> 1 then
      raise exception 'anchor 1 appears % times in admin_console_overview (expected 1)', v_hits;
    end if;
    v_def := replace(v_def, v_a1, v_r1);

    v_hits := (length(v_def) - length(replace(v_def, v_a2, ''))) / length(v_a2);
    if v_hits <> 1 then
      raise exception 'anchor 2 appears % times in admin_console_overview (expected 1)', v_hits;
    end if;
    v_def := replace(v_def, v_a2, v_r2);

    execute v_def;

    v_def := pg_get_functiondef('public.admin_console_overview()'::regprocedure);
    if position($$kind <> 'personal'$$ in v_def) = 0 then
      raise exception 'patch did not land in admin_console_overview';
    end if;
  end if;
end
$patch$;

-- ---------------------------------------------------------------------------
-- admin_console_trends: new_groups
-- ---------------------------------------------------------------------------

DO $patch$
declare
  v_def text;
  v_anchor constant text := $anchor$from groups$anchor$;
  v_replacement constant text := $repl$from (select * from groups where kind <> 'personal') groups$repl$;
  v_hits integer;
begin
  v_def := pg_get_functiondef('public.admin_console_trends(integer)'::regprocedure);

  if position($$kind <> 'personal'$$ in v_def) > 0 then
    raise notice 'admin_console_trends already patched, skipping';
  else
    v_hits := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
    if v_hits <> 1 then
      raise exception 'anchor appears % times in admin_console_trends (expected 1)', v_hits;
    end if;

    execute replace(v_def, v_anchor, v_replacement);

    v_def := pg_get_functiondef('public.admin_console_trends(integer)'::regprocedure);
    if position($$kind <> 'personal'$$ in v_def) = 0 then
      raise exception 'patch did not land in admin_console_trends';
    end if;
  end if;
end
$patch$;

-- ---------------------------------------------------------------------------
-- Verify after apply (read-only; run by hand):
--
-- select (admin_console_overview()->>'group_count')::int,
--        (select count(*) from groups where deleted_at is null and kind <> 'personal');
-- ---------------------------------------------------------------------------
