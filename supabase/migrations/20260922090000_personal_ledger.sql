-- Personal ledger (個人帳本) stage 1: schema.
--
-- A personal ledger is an ordinary group with exactly one member (its owner)
-- and no invites - the same tables, the same RPCs, the same balance math, just
-- with the multi-member surface switched off. `groups.kind` is the tag that
-- turns it on, and everything below exists to keep that tag honest even on the
-- paths that never go through the server handlers: accept_invite, the admin
-- console, and any future write nobody has thought of yet.

-- ---------------------------------------------------------------------------
-- groups.kind
-- ---------------------------------------------------------------------------

ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'shared';
ALTER TABLE public.groups DROP CONSTRAINT IF EXISTS groups_kind_check;
ALTER TABLE public.groups ADD CONSTRAINT groups_kind_check CHECK (kind IN ('shared', 'personal'));

-- One LIVE ledger per owner. deleted_at is excluded so an admin-deleted ledger
-- is simply replaced by a fresh one on the owner's next list fetch, rather than
-- permanently blocking ensure_personal_ledger from ever making them another.
CREATE UNIQUE INDEX IF NOT EXISTS groups_one_personal_per_owner
  ON public.groups (owner_id) WHERE kind = 'personal' AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Guard triggers.
--
-- These are the backstop behind the handler guards in server/handlers/groups.ts
-- - they exist for the paths that never call a handler: accept_invite (an RPC
-- the server just proxies) and every admin console write. A handler guard that
-- is the only thing standing between a personal ledger and a second member is
-- one missed call site away from letting it happen.
-- ---------------------------------------------------------------------------

-- A shared group must never become a personal ledger (that identity is fixed
-- at creation by ensure_personal_ledger), and a personal ledger must never be
-- archived (archiving hides it from listGroups, which is how it gets
-- recreated - see the unique index comment above). The reverse direction,
-- personal -> shared, is allowed on purpose: the admin_console_merge_users
-- patch below uses it to fold a merged-away account's ledger into an ordinary
-- shared group before reassigning its ownership.
CREATE OR REPLACE FUNCTION public.guard_personal_ledger_group() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if OLD.kind = 'shared' and NEW.kind = 'personal' then
    raise exception 'PERSONAL_LEDGER: a shared group cannot become a personal ledger';
  end if;

  if NEW.kind = 'personal' and NEW.archived_at is not null then
    raise exception 'PERSONAL_LEDGER: a personal ledger cannot be archived';
  end if;

  return NEW;
end
$$;

ALTER FUNCTION public.guard_personal_ledger_group() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_personal_ledger_group() FROM PUBLIC;

CREATE OR REPLACE TRIGGER guard_personal_ledger_group
  BEFORE UPDATE ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.guard_personal_ledger_group();

-- A personal ledger's only member is its owner. INSERT refuses anything else
-- outright; UPDATE only refuses setting user_id to somebody who ISN'T the
-- owner - setting it to NULL is always allowed, so delete_my_account's detach
-- step (`update group_members set user_id = null ...`) can never be blocked by
-- this trigger no matter what order its live version runs its steps in.
CREATE OR REPLACE FUNCTION public.guard_personal_ledger_member() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  g public.groups%rowtype;
begin
  select * into g from public.groups where id = NEW.group_id;

  if g.id is null or g.kind <> 'personal' then
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    if NEW.user_id is null or NEW.user_id <> g.owner_id then
      raise exception 'PERSONAL_LEDGER: a personal ledger can only have its owner as a member';
    end if;
  elsif TG_OP = 'UPDATE' then
    if NEW.user_id is not null and NEW.user_id <> g.owner_id then
      raise exception 'PERSONAL_LEDGER: a personal ledger can only have its owner as a member';
    end if;
  end if;

  return NEW;
end
$$;

ALTER FUNCTION public.guard_personal_ledger_member() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_personal_ledger_member() FROM PUBLIC;

CREATE OR REPLACE TRIGGER guard_personal_ledger_member
  BEFORE INSERT OR UPDATE OF user_id, group_id ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_personal_ledger_member();

-- A personal ledger has nobody to invite.
CREATE OR REPLACE FUNCTION public.guard_personal_ledger_invite() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if exists (select 1 from public.groups where id = NEW.group_id and kind = 'personal') then
    raise exception 'PERSONAL_LEDGER: a personal ledger cannot have invites';
  end if;

  return NEW;
end
$$;

ALTER FUNCTION public.guard_personal_ledger_invite() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_personal_ledger_invite() FROM PUBLIC;

CREATE OR REPLACE TRIGGER guard_personal_ledger_invite
  BEFORE INSERT ON public.invites
  FOR EACH ROW EXECUTE FUNCTION public.guard_personal_ledger_invite();

-- ---------------------------------------------------------------------------
-- ensure_personal_ledger: get-or-create, called from GET /groups.
--
-- There is no separate create step and no login-time hook - a ledger is made
-- lazily, the first time a user's group list is fetched and none exists yet,
-- so existing users with a live 7-day session token still get one on their
-- very next list read. It is one transaction (unlike createGroup, which is
-- three separate PostgREST writes), and the advisory lock plus the partial
-- unique index above together make two browser tabs calling this at once safe:
-- the lock serialises them, and the index is the second guarantee if it didn't.
--
-- The stored name 我的帳本 is deliberate, not a placeholder: the admin console
-- and any old PWA client still on the shared-group code path render this raw
-- name, and the real client's own label (personalLedger.name) only ever
-- applies on top of it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_personal_ledger(p_user uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_group_id uuid;
  v_member_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('ensure_personal_ledger:' || p_user::text, 0));

  select id into v_group_id
    from groups
   where owner_id = p_user and kind = 'personal' and deleted_at is null
   limit 1;

  if v_group_id is null then
    -- groups.owner_id -> profiles(id): a user with no profiles row (should not
    -- happen, but this RPC must not 500 the whole group list over it) gets no
    -- ledger this call, quietly, rather than a foreign-key crash.
    if not exists (select 1 from profiles where id = p_user) then
      return null;
    end if;

    insert into groups (name, currency, owner_id, kind)
      values (
        '我的帳本',
        coalesce((select default_currency from profiles where id = p_user), 'TWD'),
        p_user,
        'personal'
      )
      returning id into v_group_id;

    insert into group_members (group_id, user_id, display_name, role, status, claimed_at)
      values (
        v_group_id,
        p_user,
        coalesce(nullif((select display_name from users where id = p_user), ''), '我'),
        'owner',
        'active',
        now()
      )
      returning id into v_member_id;

    update groups set owner_member_id = v_member_id, updated_at = now() where id = v_group_id;
  end if;

  return (
    select jsonb_build_object(
      'id', g.id,
      'name', g.name,
      'currency', g.currency,
      'owner_member_id', g.owner_member_id,
      'cover_image_url', g.cover_image_url,
      'monthly_budget_minor', g.monthly_budget_minor,
      'kind', g.kind
    )
    from groups g
   where g.id = v_group_id
  );
end
$$;

ALTER FUNCTION public.ensure_personal_ledger(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ensure_personal_ledger(uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ensure_personal_ledger(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Patch admin_console_merge_users: a merged-away account's own ledger, if it
-- had one, must not raise groups_one_personal_per_owner when its ownership
-- moves to the target account below. Anchor-and-hit-count patch rather than a
-- full restatement, same pattern as
-- 20260826014823_expense_receipts_and_comments.sql:272-290 - this function is
-- a hundred-plus lines and the change is two statements.
-- ---------------------------------------------------------------------------

DO $patch$
declare
  v_anchor constant text := $anchor$update group_members
  set user_id = p_target_user_id$anchor$;
  v_replacement constant text := $repl$update groups set kind = 'shared', name = '我的帳本（' || v_source.email || '）', updated_at = now()
   where owner_id = p_source_user_id and kind = 'personal';

  update group_members
  set user_id = p_target_user_id$repl$;
  v_def text;
  v_hits integer;
begin
  v_def := pg_get_functiondef('public.admin_console_merge_users'::regproc);

  v_hits := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception 'anchor appears % times in admin_console_merge_users (expected 1)', v_hits;
  end if;

  execute replace(v_def, v_anchor, v_replacement);

  v_def := pg_get_functiondef('public.admin_console_merge_users'::regproc);
  if position('kind = ''personal''' in v_def) = 0 then
    raise exception 'patch did not land in admin_console_merge_users';
  end if;
end
$patch$;
