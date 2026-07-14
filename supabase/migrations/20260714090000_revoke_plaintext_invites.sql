-- Invite tokens were never actually hashed: createTokenHash() returned
-- `sha256:<token>`, so invites.token_hash held the bearer token itself in
-- plain text, and the token was generated from Math.random() (predictable,
-- ~6 base36 characters). Both are fixed in the application layer
-- (supabaseGroupRepository.ts: randomBytes + a real SHA-256 digest).
--
-- Every pre-existing row is therefore a plain-text credential that a real
-- digest can never match again - the invite is dead either way. Revoke them
-- explicitly so the database state says so, rather than leaving rows that
-- look live but silently fail every lookup, and so the leaked tokens stop
-- working even if some other path were to read them.
--
-- New invites must be issued for any group still sharing an old link.

update public.invites
set revoked_at = now()
where revoked_at is null
  and token_hash like 'sha256:%';
