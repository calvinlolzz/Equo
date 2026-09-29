import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Static guard on the LINE bot migrations, mirroring
 * adminExcludePersonalLedgersSql.test.ts's approach: this repo has no
 * integration test against a live database, so the invariants the migrations
 * rely on are pinned as source text too.
 *
 * The workflow-file assertions (db-backup.yml wiring the two purge RPCs) are
 * deliberately NOT here - that lands with the separate workflow commit, after
 * the migration has been applied to production (see the plan's §12, commit 7).
 */
const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "..", "..", "supabase", "migrations");
const botSql = readFileSync(join(MIGRATIONS_DIR, "20260929090000_line_bot.sql"), "utf8");
const mergeSql = readFileSync(join(MIGRATIONS_DIR, "20260929090100_line_merge_users.sql"), "utf8");

describe("line_bot migration", () => {
  test("every table foreign key cascades", () => {
    for (const fk of [
      "line_accounts_user_id_fkey",
      "line_link_requests_user_id_fkey",
      "line_bot_entries_user_id_fkey",
      "line_bot_entries_group_id_fkey",
      "line_bot_entries_expense_id_fkey",
    ]) {
      const fkIndex = botSql.indexOf(fk);
      expect(fkIndex, `${fk} should appear in the migration`).toBeGreaterThan(-1);
      const nextComma = botSql.indexOf(",\n", fkIndex);
      const nextParen = botSql.indexOf("\n)", fkIndex);
      const end = nextComma === -1 ? nextParen : nextComma;
      const clause = botSql.slice(fkIndex, end === -1 ? undefined : end);
      expect(clause).toContain("ON DELETE CASCADE");
    }
  });

  test("every table revokes anon and authenticated", () => {
    for (const table of ["line_accounts", "line_link_requests", "line_bot_entries"]) {
      expect(botSql).toContain(`REVOKE ALL ON TABLE "public"."${table}" FROM "anon"`);
      expect(botSql).toContain(`REVOKE ALL ON TABLE "public"."${table}" FROM "authenticated"`);
    }
  });

  test("every line_/purge_line_ function revokes PUBLIC", () => {
    const defined = [...botSql.matchAll(/CREATE OR REPLACE FUNCTION "public"\."((?:line|purge_line)_\w+)"\(([^)]*)\)/g)];
    expect(defined.length).toBeGreaterThan(0);

    for (const match of defined) {
      const name = match[1];
      expect(botSql, `${name} should REVOKE ALL FROM PUBLIC`).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION "public"\\."${name}"\\([^)]*\\) FROM PUBLIC`),
      );
    }
  });

  test("line_record_entry is ledger-only: no group parameter, resolves via ensure_personal_ledger, idempotent on event id", () => {
    const start = botSql.indexOf('CREATE OR REPLACE FUNCTION "public"."line_record_entry"');
    expect(start).toBeGreaterThan(-1);
    const end = botSql.indexOf("\n$$;", start);
    const body = botSql.slice(start, end);

    expect(body).not.toMatch(/p_group\b/);
    expect(body).toContain("'line:' || p_event_id");
    expect(body).toContain("ensure_personal_ledger(");
    expect(body).toContain("on conflict (webhook_event_id) do nothing");
  });
});

describe("line_merge_users migration", () => {
  test("anchors on the exact push_subscriptions delete line and checks the hit count", () => {
    expect(mergeSql).toContain(
      "$anchor$delete from push_subscriptions where user_id = p_source_user_id;$anchor$",
    );
    expect(mergeSql).toContain("v_hits <> 1");
  });

  test("is idempotent - skips rather than re-applying when already patched", () => {
    expect(mergeSql).toContain("already patched, skipping");
  });

  test("re-reads the function afterward and raises if the marker didn't land", () => {
    expect(mergeSql).toContain("patch did not land");
  });

  test("deletes the source account's LINE link rather than moving it", () => {
    expect(mergeSql).toContain("delete from line_accounts where user_id = p_source_user_id;");
    expect(mergeSql).toContain("delete from line_link_requests where user_id = p_source_user_id;");
  });
});
