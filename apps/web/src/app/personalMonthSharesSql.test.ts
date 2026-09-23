import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Static guard on the personal_month_group_shares migration, mirroring
 * catalogSeed.test.ts's approach: this repo has no integration test against a
 * live database, so the invariants D1 relies on (kind filters, the currency
 * guard, the function's execute grants) are pinned as source text instead of
 * left to be re-verified by hand every time the file changes.
 */
const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "..", "supabase", "migrations");
const sql = readFileSync(join(MIGRATIONS_DIR, "20260923090000_personal_month_group_shares.sql"), "utf8");

describe("personal_month_group_shares migration", () => {
  test("is a stable, security-definer function", () => {
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("STABLE");
  });

  // [MV: delete the kind filter]
  test("only counts shared groups", () => {
    expect(sql).toContain("g.kind = 'shared'");
  });

  test("only counts expense-kind rows, not income or settlements", () => {
    expect(sql).toContain("e.kind = 'expense'");
  });

  test("only counts the caller's active membership", () => {
    expect(sql).toContain("m.status = 'active'");
  });

  test("only counts rows in the group's own currency", () => {
    expect(sql).toContain("e.currency = mi.currency");
  });

  test("is off the public API surface except for service_role", () => {
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.personal_month_group_shares(uuid, text) FROM PUBLIC");
    expect(sql).toContain("GRANT ALL ON FUNCTION public.personal_month_group_shares(uuid, text) TO service_role");
  });
});
