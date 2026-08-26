-- Show how close the free plan's two hard limits are.
--
-- Not a cost warning — a cliff. Supabase Free puts the database into READ-ONLY
-- MODE at 500 MB ("cannot execute INSERT in a read-only transaction"), which
-- means the app stops accepting expenses entirely. Storage has a 1 GB quota.
-- Neither is visible from the console today: the storage card reports bytes
-- with nothing to compare them against, and the database's own size is
-- reported nowhere at all.
--
-- Measured with the query Supabase's own docs point at — the SUM over
-- pg_database, not pg_database_size(current_database()) — so the number here is
-- the number the platform enforces. That sum includes template0/template1,
-- roughly 15 MB of baseline nobody can remove; the point is that it counts
-- against the limit, so the console has to count it too.
--
-- The LIMITS deliberately live in the console, not here: they are a property of
-- the billing plan, not of this database. Postgres reports what is used; one
-- constant in adminDashboard.ts says what is allowed.
--
-- Patching the live definition rather than restating it. admin_console_health
-- is 109 lines and this adds one key; every restatement is a chance to drop
-- something (the push_health migration silently lost a comment that way, and
-- only the line-by-line diff caught it). The anchor is verified to occur
-- exactly once and a miss raises rather than leaving the quota unreported.
DO $do$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'admin_console_health';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'admin_console_health is missing; cannot report plan quota';
  END IF;

  -- Re-runnable: a second application is a no-op rather than a duplicate key.
  IF v_def LIKE '%''quota''%' THEN
    RETURN;
  END IF;

  v_new := replace(
    v_def,
    $anchor$    'rate_limit', jsonb_build_object($anchor$,
    $anchor$    'quota', jsonb_build_object(
      -- Matches the docs' query, and therefore the dashboard's number.
      'database_bytes', (select sum(pg_database_size(datname))::bigint from pg_database),
      'storage_bytes', (
        select coalesce(sum((metadata->>'size')::bigint), 0)::bigint from storage.objects
      )
    ),
    'rate_limit', jsonb_build_object($anchor$
  );

  IF v_new = v_def THEN
    RAISE EXCEPTION 'admin_console_health: rate_limit anchor not found; refusing to leave plan quota unreported';
  END IF;

  EXECUTE v_new;
END
$do$;
