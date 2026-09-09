import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ADMIN_AUDIT_ACTIONS, ADMIN_AUDIT_ACTION_LABELS } from "./adminAuditActions";
import { auditActionLabel, auditActionOptions } from "./adminDashboard";
import { AUDIT_ACTIONS, normalizeAuditActionFilter } from "../server/handlers/admin";

/**
 * The console's audit filter, pinned to the database that writes the rows.
 *
 * This test exists because the drift it checks for already happened, silently,
 * for months: the label map had 22 actions, the API's allowlist had a different
 * 22, and the migrations wrote 31. Six real actions — 以使用者身分檢視 among
 * them — could not be named or filtered for, and asking for one came back as
 * the entire log because an unrecognised filter degrades to "any".
 *
 * Reading the migrations rather than hard-coding the expected list is the whole
 * point: a new audit action arrives as a new migration, and this fails on the
 * commit that adds it rather than whenever somebody next opens 稽核記錄.
 */
const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "..", "supabase", "migrations");

/**
 * Every action literal that a migration inserts into admin_audit_logs.
 *
 * Scoped to the statement rather than the file: these files also carry ordinary
 * dotted strings (search_path values, column defaults), and matching every
 * quoted `a.b` in a 6,000-line baseline dump would be matching noise.
 */
function actionsWrittenByMigrations(): Set<string> {
  const found = new Set<string>();

  for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql"))) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");

    // `insert into admin_audit_logs (...) values (...)` — take the window from
    // the insert to the end of its values list and pull the dotted literals out
    // of it. 2,000 characters comfortably covers the longest of these inserts
    // (the jsonb_build_object metadata payloads run long) without spilling into
    // the next statement.
    for (const match of sql.matchAll(/insert\s+into\s+admin_audit_logs\b/gi)) {
      const window = sql.slice(match.index ?? 0, (match.index ?? 0) + 2000);
      for (const literal of window.matchAll(/'([a-z_]+(?:\.[a-z_]+)+)'/g)) {
        found.add(literal[1]);
      }
    }
  }

  return found;
}

describe("audit action coverage", () => {
  const written = actionsWrittenByMigrations();

  test("the migrations really do write a spread of actions", () => {
    // Guards the parser itself: a regex that quietly matched nothing would make
    // every assertion below vacuously true, which is the failure mode this
    // whole file exists to avoid.
    expect(written.size).toBeGreaterThanOrEqual(29);
    expect(written).toContain("user.view_as");
    expect(written).toContain("group.delete");
  });

  test("every action the database writes has a label", () => {
    const unlabelled = [...written].filter((action) => !(action in ADMIN_AUDIT_ACTION_LABELS)).sort();
    expect(unlabelled).toEqual([]);
  });

  test("no label invents an action the database never writes", () => {
    const invented = ADMIN_AUDIT_ACTIONS.filter((action) => !written.has(action)).sort();
    expect(invented).toEqual([]);
  });

  test("the API allowlist and the console's dropdown are the same list", () => {
    expect([...AUDIT_ACTIONS]).toEqual([...ADMIN_AUDIT_ACTIONS]);
    expect(auditActionOptions().map((option) => option.value)).toEqual([...ADMIN_AUDIT_ACTIONS]);
  });

  test("every action the database writes survives the API's filter", () => {
    // The regression in its exact shape: normalizeAuditActionFilter turns an
    // action it does not recognise into "", which the RPC reads as "any". So a
    // dropped action does not fail loudly — it answers with the whole log.
    const swallowed = [...written].filter((action) => normalizeAuditActionFilter(action) !== action).sort();
    expect(swallowed).toEqual([]);
  });

  test("每個動作在後台都顯示中文，不是原始字串", () => {
    for (const action of written) {
      const label = auditActionLabel(action);
      expect(label).not.toBe(action);
      expect(label).not.toMatch(/[a-z_]+\.[a-z_]+/);
    }
  });

  test("以使用者身分檢視 is filterable — the reason this file exists", () => {
    expect(auditActionLabel("user.view_as")).toBe("以使用者身分檢視");
    expect(auditActionOptions().map((option) => option.value)).toContain("user.view_as");
    expect(normalizeAuditActionFilter("user.view_as")).toBe("user.view_as");
  });

  test("an action nobody has heard of is still refused", () => {
    expect(normalizeAuditActionFilter("user.definitely_not_real")).toBe("");
    expect(normalizeAuditActionFilter(undefined)).toBe("");
  });
});
