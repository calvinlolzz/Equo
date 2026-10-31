-- Editing an expense is "soft-delete the old row, create a new one"
-- (replace_expense), so an id handed out before the edit - a LINE card's
-- 編輯/刪除 buttons - stops pointing at the live entry after one typo fix.
-- old.replaced_by_expense_id = new.id records the hop; readers follow it from a
-- soft-deleted row to its successor. Always within one group.
--
-- Additive: a nullable column (metadata-only ALTER), an index for the FK, an
-- FK that SETs NULL (a hard delete of the newer row - account deletion,
-- retention, an admin purge - never blocks and never dangles), and a
-- one-statement anchor patch to the LIVE replace_expense (pg_get_functiondef,
-- not a restatement of a migration file - see the delete_my_account drift).
-- Same anchor-and-hit-count pattern as 20260929090100_line_merge_users.sql.
--
-- The idempotent-replay branch of replace_expense returns before the anchor, so
-- a replayed edit writes nothing twice.
--
-- Un-patch (only if replace_expense must go back; the column, index and FK can
-- stay). Run it as a one-off DO block, it is NOT part of this migration:
--
--   DO $unpatch$
--   DECLARE
--     v_sig constant regprocedure := 'public.replace_expense(uuid,uuid,uuid,jsonb)'::regprocedure;
--     v_anchor constant text := 'return jsonb_build_object(''expense'', v_next, ''previous'', v_previous);';
--     v_insert constant text :=
--       E'-- Forwarding address on the row this edit retired (20261101090000).\n'
--       || E'  update expenses set replaced_by_expense_id = (v_next ->> ''id'')::uuid\n'
--       || E'  where id = p_expense_id and group_id = p_group_id;\n\n  ';
--     v_def text;
--     v_hits integer;
--   BEGIN
--     v_def := pg_get_functiondef(v_sig);
--     IF position('replaced_by_expense_id' in v_def) = 0 THEN RETURN; END IF;
--     v_hits := (length(v_def) - length(replace(v_def, v_insert || v_anchor, ''))) / length(v_insert || v_anchor);
--     IF v_hits <> 1 THEN RAISE EXCEPTION 'patched anchor appears % times (expected 1)', v_hits; END IF;
--     EXECUTE replace(v_def, v_insert || v_anchor, v_anchor);
--     IF position('replaced_by_expense_id' in pg_get_functiondef(v_sig)) > 0 THEN
--       RAISE EXCEPTION 'un-patch did not land';
--     END IF;
--   END
--   $unpatch$;

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS replaced_by_expense_id uuid;

DO $fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_replaced_by_expense_id_fkey') THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_replaced_by_expense_id_fkey
      FOREIGN KEY (replaced_by_expense_id) REFERENCES public.expenses(id) ON DELETE SET NULL;
  END IF;
END
$fk$;

CREATE INDEX IF NOT EXISTS expenses_replaced_by_expense_id_idx ON public.expenses (replaced_by_expense_id);

DO $patch$
DECLARE
  v_sig constant regprocedure := 'public.replace_expense(uuid,uuid,uuid,jsonb)'::regprocedure;
  v_anchor constant text := $anchor$return jsonb_build_object('expense', v_next, 'previous', v_previous);$anchor$;
  v_insert constant text := $repl$-- Forwarding address on the row this edit retired (20261101090000).
  update expenses set replaced_by_expense_id = (v_next ->> 'id')::uuid
  where id = p_expense_id and group_id = p_group_id;

  $repl$;
  v_def text;
  v_patched text;
  v_hits integer;
BEGIN
  v_def := pg_get_functiondef(v_sig);

  IF position('replaced_by_expense_id' in v_def) > 0 THEN
    RAISE NOTICE 'replace_expense already patched, skipping';
    RETURN;
  END IF;

  v_hits := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'anchor appears % times in replace_expense (expected 1)', v_hits;
  END IF;

  EXECUTE replace(v_def, v_anchor, v_insert || v_anchor);

  -- The re-read must be the old definition plus the insert, nothing else: the
  -- patch landed, and the comment move and the rest of the body survived.
  v_patched := pg_get_functiondef(v_sig);
  IF position('set replaced_by_expense_id = (v_next ->> ''id'')::uuid' in v_patched) = 0 THEN
    RAISE EXCEPTION 'patch did not land in replace_expense';
  END IF;
  IF position('update expense_comments' in v_patched) = 0 THEN
    RAISE EXCEPTION 'replace_expense lost its comment move';
  END IF;
  IF replace(v_patched, v_insert, '') <> v_def THEN
    RAISE EXCEPTION 'replace_expense changed by more than the patch';
  END IF;
END
$patch$;
