-- Data repair: make group_members.role agree with groups.owner_member_id.
--
-- The app has two representations of "who owns this group": groups.owner_member_id
-- (a pointer) and group_members.role = 'owner' (a flag). Current group-creation
-- code writes both correctly, and every authorization check (backend
-- requireGroupOwner, frontend isGroupOwner) reads the role flag. But some
-- groups created by older code paths ended up with owner_member_id pointing at
-- a member whose role was still 'member', so the pointer and the flag disagreed
-- (see the review report's issue ⑥). On those rows the owner-only actions
-- (rename / archive / delete) would silently fail the role check.
--
-- This backfills role = 'owner' for exactly the member each group points to as
-- its owner. It is idempotent (the WHERE clause skips rows already correct) and
-- safe to re-run.
update public.group_members gm
set role = 'owner',
    updated_at = now()
from public.groups g
where g.owner_member_id = gm.id
  and gm.group_id = g.id
  and gm.role <> 'owner';

-- Defensive inverse: if a group points at member A as owner, no OTHER member of
-- that same group should still be flagged 'owner' (an old owner left dangling
-- after an ownership change). Demote any such stragglers so 'owner' is unique
-- per group and always the one owner_member_id names.
update public.group_members gm
set role = 'member',
    updated_at = now()
from public.groups g
where gm.group_id = g.id
  and gm.role = 'owner'
  and g.owner_member_id is not null
  and g.owner_member_id <> gm.id;
