-- One active membership per person per group.
--
-- Nothing in the schema ever said so. group_members has no unique constraint on
-- (group_id, user_id), and acceptInvite used to insert a fresh member row every
-- time a link was redeemed - so the same person re-using an invite link ended up
-- with TWO active member rows in the group. Their balance then split across two
-- member ids: expenses charged to one, payments credited to the other, and the
-- settlement never reconciled.
--
-- accept_invite (20260714100000_transactional_write_rpcs.sql) now checks for an
-- existing membership and hands it back instead of minting a second one, which
-- closes the only path that produced this. This index is the backstop: it makes
-- the invariant true of the TABLE rather than of one function that happens to
-- respect it, so a future writer cannot reintroduce the bug without the database
-- refusing.
--
-- Scope of the partial index:
--   * user_id is not null - virtual members (an unclaimed placeholder for
--     someone without an account) legitimately have no user id, and a group can
--     hold many of them.
--   * status = 'active' - a removed row must not block the same person from
--     rejoining later, and two removed rows are harmless.
--
-- Verified against production before writing this: zero rows violate the
-- predicate, so the index builds cleanly.

create unique index if not exists group_members_active_user_per_group_key
  on public.group_members (group_id, user_id)
  where user_id is not null and status = 'active';
