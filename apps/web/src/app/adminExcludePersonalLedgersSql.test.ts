import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Static guard on the admin-console patch migration, mirroring
 * catalogSeed.test.ts's approach: this repo has no integration
 * test against a live database, so the invariants the migration's own
 * guards rely on are pinned as source text too.
 */
const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "..", "supabase", "migrations");
const sql = readFileSync(join(MIGRATIONS_DIR, "20260923090100_admin_exclude_personal_ledgers.sql"), "utf8");

describe("admin_exclude_personal_ledgers migration", () => {
  test("guards every anchor replacement with a hit-count check before executing (2 in overview, 1 in trends)", () => {
    expect(sql.match(/expected 1/g)?.length).toBe(3);
  });

  test("re-reads each of the two patched functions afterward and raises if the marker didn't land", () => {
    expect(sql.match(/patch did not land/g)?.length).toBe(2);
  });

  test("each patch block is idempotent - skips rather than re-applying when its marker is already present", () => {
    expect(sql.match(/already patched, skipping/g)?.length).toBe(2);
  });

  test("touches only overview and trends, never writes an audit log row", () => {
    expect(sql).toContain("admin_console_overview");
    expect(sql).toContain("admin_console_trends");
    expect(sql.toLowerCase()).not.toContain("insert into admin_audit_logs");
  });
});
