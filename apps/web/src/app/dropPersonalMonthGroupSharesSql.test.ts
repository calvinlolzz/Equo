import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Static guard on the drop migration, mirroring catalogSeed.test.ts's
 * approach: this repo has no integration test against a live database, so
 * the one thing that must be in this file - the DROP itself, with the exact
 * signature the function was created with - is pinned as source text.
 */
const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "..", "supabase", "migrations");
const sql = readFileSync(join(MIGRATIONS_DIR, "20260923120000_drop_personal_month_group_shares.sql"), "utf8");

describe("[MV] drop_personal_month_group_shares migration", () => {
  test("drops personal_month_group_shares(uuid, text)", () => {
    expect(sql).toContain("DROP FUNCTION IF EXISTS public.personal_month_group_shares(uuid, text)");
  });
});
