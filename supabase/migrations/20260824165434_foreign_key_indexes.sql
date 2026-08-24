-- Cover the eight foreign keys that had no index.
--
-- Worth being precise about what these are for, because it is NOT what the
-- advisor's name suggests. Checked against the migrations rather than assumed:
-- **not one of these columns is read by any query in the product.**
--
--   expenses.payer_id / created_by       legacy per-user columns from the
--                                        FloatPay era. create_expense does not
--                                        write them (the ledger keys off
--                                        expense_payments and *_member_id), so
--                                        only the 7 oldest of 68 rows have them
--                                        and nothing will ever set them again.
--   group_nudges.from/to_member_id       the cooldown query uses the composite
--                                        (group_id, to_member_id, created_at).
--   app_error_logs.user_id               console lists join users the other way.
--   app_feedback.user_id                 likewise.
--   admin_audit_logs.admin_id            likewise.
--   user_notifications.source_feedback_id  written, never filtered on.
--
-- What they are all for is the other direction: **enforcing the foreign key
-- when the PARENT row goes away.** Postgres has to prove no child references it,
-- and with no index that proof is a sequential scan of the whole child table.
--
-- One operation touches every one of them: deleting an account. delete_my_account
-- nulls expenses.payer_id/created_by and app_error_logs/app_feedback.user_id,
-- deletes group_members (group_nudges), and finally deletes auth.users
-- (admin_audit_logs). Today that is eight seq scans over a few dozen rows —
-- free. The reason to fix it now is that the cost scales with the SIZE OF THE
-- TABLES, not with how much data the departing user had: the tenth account
-- deletion is as slow as the whole ledger is big, and it stays invisible right
-- up until it is not.
--
-- Partial where the column is sparse BY DESIGN, which is most of them: an
-- equality lookup (`col = $1`) can never match a NULL, so excluding NULLs
-- costs nothing and keeps the index proportional to the rows that can actually
-- match. That matters most on expenses, the one table here that grows without
-- bound while payer_id stays frozen at 7 rows forever. Same shape the schema
-- already uses for expenses_group_client_request_id_key and
-- user_notifications_unread_idx.
--
-- Plain CREATE INDEX, not CONCURRENTLY: these tables are tiny, so the ACCESS
-- EXCLUSIVE lock is measured in microseconds, and CONCURRENTLY cannot run
-- inside the transaction a migration gets. Revisit that if any of these ever
-- gets large.


-- ============================================================
-- expenses — dead legacy columns, permanently sparse.
-- ============================================================
CREATE INDEX IF NOT EXISTS "expenses_payer_id_idx"
  ON "public"."expenses" USING "btree" ("payer_id")
  WHERE "payer_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "expenses_created_by_idx"
  ON "public"."expenses" USING "btree" ("created_by")
  WHERE "created_by" IS NOT NULL;


-- ============================================================
-- group_nudges — both columns are NOT NULL, so plain.
-- ============================================================
--
-- to_member_id already appears in group_nudges_target_idx, but as its SECOND
-- column behind group_id: that serves the cooldown lookup and cannot serve the
-- bare `to_member_id = $1` a foreign-key check does.
CREATE INDEX IF NOT EXISTS "group_nudges_from_member_idx"
  ON "public"."group_nudges" USING "btree" ("from_member_id");

CREATE INDEX IF NOT EXISTS "group_nudges_to_member_idx"
  ON "public"."group_nudges" USING "btree" ("to_member_id");


-- ============================================================
-- The log tables — nullable, and they accumulate NULLs.
-- ============================================================
--
-- Every account deletion nulls another batch of these rows, so the share of
-- NULLs only ever grows and a partial index only ever gets relatively cheaper.
CREATE INDEX IF NOT EXISTS "app_error_logs_user_idx"
  ON "public"."app_error_logs" USING "btree" ("user_id")
  WHERE "user_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "app_feedback_user_idx"
  ON "public"."app_feedback" USING "btree" ("user_id")
  WHERE "user_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "admin_audit_logs_admin_idx"
  ON "public"."admin_audit_logs" USING "btree" ("admin_id")
  WHERE "admin_id" IS NOT NULL;


-- ============================================================
-- user_notifications — set only on a reply to feedback.
-- ============================================================
CREATE INDEX IF NOT EXISTS "user_notifications_source_feedback_idx"
  ON "public"."user_notifications" USING "btree" ("source_feedback_id")
  WHERE "source_feedback_id" IS NOT NULL;
