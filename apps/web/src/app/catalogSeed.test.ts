import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DEFAULT_CATALOG } from "./catalog";

/**
 * DEFAULT_CATALOG, pinned to the migrations that seed expense_categories.
 *
 * The bundled catalog exists so a failed /catalog fetch, an offline start, or
 * a cold first paint looks identical to a successful one - which only holds if
 * it actually matches what the database seeds. This reads the two migrations
 * that write category rows rather than hard-coding the expected list, so a
 * seed that drifts from the bundle (a colour typo, a re-ordered row, a key
 * that isn't there yet) fails on the commit that introduces the drift.
 */
const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "..", "supabase", "migrations");

type SeededRow = { key: string; label: string; color: string; sortOrder: number; scope: string };

/**
 * Pulls every `('key', 'label', '#hex', sort_order[, 'scope'])` tuple out of
 * an `INSERT INTO ... expense_categories ... VALUES (...)` statement. A row
 * with no scope column (the original 20260805120000 seed) defaults to
 * "shared" - the same default the scope column itself was given.
 */
function parseSeededCategories(sql: string): SeededRow[] {
  const rows: SeededRow[] = [];
  const rowPattern = /\('([a-z_]+)',\s*'([^']*)',\s*'(#[0-9A-Fa-f]{6})',\s*(\d+)(?:,\s*'([a-z]+)')?\)/g;

  for (const match of sql.matchAll(rowPattern)) {
    const [, key, label, color, sortOrder, scope] = match;
    rows.push({ key, label, color, sortOrder: Number(sortOrder), scope: scope ?? "shared" });
  }

  return rows;
}

function seededCategories(): SeededRow[] {
  const original = parseSeededCategories(
    readFileSync(join(MIGRATIONS_DIR, "20260805120000_app_catalog.sql"), "utf8"),
  );
  const personalLedger = parseSeededCategories(
    readFileSync(join(MIGRATIONS_DIR, "20260922090100_category_scope.sql"), "utf8"),
  );

  return [...original, ...personalLedger];
}

describe("DEFAULT_CATALOG matches what the migrations seed", () => {
  const seeded = seededCategories();

  test("the parser really does find rows in both migrations (guards the regex itself)", () => {
    expect(seeded.length).toBeGreaterThanOrEqual(15);
    expect(seeded.map((row) => row.key)).toContain("food");
    expect(seeded.map((row) => row.key)).toContain("other_income");
  });

  test("keys, in the same order the migrations insert them", () => {
    expect(DEFAULT_CATALOG.categories.map((entry) => entry.key)).toEqual(seeded.map((row) => row.key));
  });

  test("colours match exactly - a bundle default that drifts renders a category in the wrong colour", () => {
    for (const row of seeded) {
      const entry = DEFAULT_CATALOG.categories.find((candidate) => candidate.key === row.key);
      expect(entry?.color).toBe(row.color);
    }
  });

  test("scopes match - this is what keeps a personal-ledger category off the shared picker offline", () => {
    for (const row of seeded) {
      const entry = DEFAULT_CATALOG.categories.find((candidate) => candidate.key === row.key);
      expect(entry?.scope).toBe(row.scope);
    }
  });

  test("繁中 labels match the seed", () => {
    for (const row of seeded) {
      const entry = DEFAULT_CATALOG.categories.find((candidate) => candidate.key === row.key);
      expect(entry?.label).toBe(row.label);
    }
  });

  test("sort_order matches, which is what fixes the display order offline", () => {
    const bySortOrder = [...seeded].sort((a, b) => a.sortOrder - b.sortOrder).map((row) => row.key);
    expect(DEFAULT_CATALOG.categories.map((entry) => entry.key)).toEqual(bySortOrder);
  });
});
