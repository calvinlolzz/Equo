import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Static guard on the LINE bot migrations, mirroring
 * adminExcludePersonalLedgersSql.test.ts's approach: this repo has no
 * integration test against a live database, so the invariants the migrations
 * rely on are pinned as source text too.
 *
 * The nightly workflow must wire every purge function this migration defines.
 * It only merges after the migration is applied - otherwise the purge step
 * fails on functions that do not exist yet (see the plan's §8).
 */
const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "..", "..", "supabase", "migrations");
const botSql = readFileSync(join(MIGRATIONS_DIR, "20260929090000_line_bot.sql"), "utf8");
const mergeSql = readFileSync(join(MIGRATIONS_DIR, "20260929090100_line_merge_users.sql"), "utf8");
const budgetSql = readFileSync(join(MIGRATIONS_DIR, "20260930090000_line_set_budget.sql"), "utf8");
const categoriesSql = readFileSync(join(MIGRATIONS_DIR, "20261003090000_line_month_categories.sql"), "utf8");
const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const workflow = readFileSync(join(REPO_ROOT, ".github", "workflows", "db-backup.yml"), "utf8");

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
    for (const table of ["line_accounts", "line_link_requests", "line_bot_entries", "line_undo_events"]) {
      expect(botSql).toContain(`REVOKE ALL ON TABLE "public"."${table}" FROM "anon"`);
      expect(botSql).toContain(`REVOKE ALL ON TABLE "public"."${table}" FROM "authenticated"`);
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

  // [MV]: a link request already attached to a DIFFERENT user must be
  // refused, not silently reassigned - break the guard and this goes red.
  test("line_attach_link_request refuses a link request another user already attached to", () => {
    const start = botSql.indexOf('CREATE OR REPLACE FUNCTION "public"."line_attach_link_request"');
    const end = botSql.indexOf("\n$$;", start);
    const body = botSql.slice(start, end);

    expect(body).toMatch(/r\.user_id is not null and r\.user_id <> p_user/);
    expect(body).toContain("'reason', 'claimed'");
  });

  // [MV]: every exit path of line_undo_last must record its outcome, and the
  // very first thing the function does must be to check for a prior outcome -
  // otherwise a redelivered "復原" that first found nothing to undo would
  // re-run the lookup and could delete an entry recorded in between.
  test("line_undo_last checks line_undo_events first and records every outcome", () => {
    const start = botSql.indexOf('CREATE OR REPLACE FUNCTION "public"."line_undo_last"');
    const end = botSql.indexOf("\n$$;", start);
    const body = botSql.slice(start, end);

    const firstStatementIndex = body.indexOf("select result into v_prior_result from line_undo_events");
    expect(firstStatementIndex).toBeGreaterThan(-1);
    // Nothing that reads line_bot_entries or touches expenses may run before
    // the prior-outcome check.
    expect(body.indexOf("from line_bot_entries")).toBeGreaterThan(firstStatementIndex);

    const insertCount = (body.match(/insert into line_undo_events/g) ?? []).length;
    expect(insertCount).toBe(4); // not_linked, nothing_to_undo, already_gone, ok
    for (const result of ["not_linked", "nothing_to_undo", "already_gone", "ok"]) {
      expect(body).toContain(`'${result}'`);
    }
  });
});

/**
 * A SECURITY DEFINER function is callable by PUBLIC unless that is revoked, and
 * PostgREST exposes every function it can see under /rpc/ - so each line_ and
 * purge_line_ function must say, in the migration that creates it, that only
 * service_role may run it. Checked in every LINE migration, not just the first:
 * a function added later is exactly the one nobody re-reads.
 */
describe("every LINE migration function is callable by service_role only", () => {
  const LINE_MIGRATIONS: Array<[string, string]> = [
    ["20260929090000_line_bot.sql", botSql],
    ["20260930090000_line_set_budget.sql", budgetSql],
    ["20261003090000_line_month_categories.sql", categoriesSql],
  ];

  test.each(LINE_MIGRATIONS)("%s revokes PUBLIC, anon and authenticated and grants service_role", (file, sql) => {
    const defined = [...sql.matchAll(/CREATE OR REPLACE FUNCTION "public"\."((?:line|purge_line)_\w+)"\(([^)]*)\)/g)];
    expect(defined.length, `${file} should define at least one line_ function`).toBeGreaterThan(0);

    for (const match of defined) {
      const name = match[1];
      for (const role of ["PUBLIC", '"anon"', '"authenticated"']) {
        expect(sql, `${name} should REVOKE ALL FROM ${role}`).toMatch(
          new RegExp(`REVOKE ALL ON FUNCTION "public"\\."${name}"\\([^)]*\\) FROM ${role}`),
        );
      }
      expect(sql, `${name} should GRANT ALL TO "service_role"`).toMatch(
        new RegExp(`GRANT ALL ON FUNCTION "public"\\."${name}"\\([^)]*\\) TO "service_role"`),
      );
    }
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

describe("nightly retention wiring", () => {
  // [MV]
  test("db-backup.yml purges line_link_requests(1), line_bot_entries(90) and line_undo_events(2)", () => {
    expect(workflow).toContain("public.purge_line_link_requests(1)");
    expect(workflow).toContain("public.purge_line_bot_entries(90)");
    expect(workflow).toContain("public.purge_line_undo_events(2)");
  });

  test("every purge_line_ function the migration defines is called by the workflow", () => {
    const defined = [...botSql.matchAll(/CREATE OR REPLACE FUNCTION "public"\."(purge_line_\w+)"/g)].map((m) => m[1]);
    expect(defined.length).toBe(3);
    for (const name of defined) expect(workflow, `${name} should be wired`).toContain(`public.${name}(`);
  });
});

describe("line_undo_events does not outlive the link", () => {
  const fn = (name: string) => {
    const start = botSql.indexOf(`CREATE OR REPLACE FUNCTION "public"."${name}"`);
    return botSql.slice(start, botSql.indexOf("\n$$;", start));
  };

  // [MV]
  test("both unlink paths delete the LINE id's undo events", () => {
    expect(fn("line_unlink")).toContain("delete from line_undo_events where line_user_id = p_line_user_id");
    expect(fn("line_unlink_user")).toContain("delete from line_undo_events where line_user_id = v_line");
  });

  test("re-linking clears the undo events of the LINE id being displaced", () => {
    const body = fn("line_consume_link_nonce");
    expect(body).toContain("v_prev <> p_line_user_id");
    expect(body).toContain("delete from line_undo_events where line_user_id = v_prev");
  });

  test("purge_line_undo_events keeps two days by default with a one-day floor", () => {
    const body = fn("purge_line_undo_events");
    expect(body).toContain('"p_days" integer DEFAULT 2');
    expect(body).toContain("greatest(coalesce(p_days, 2), 1)");
  });
});

describe("line_set_budget migration", () => {
  const start = budgetSql.indexOf('CREATE OR REPLACE FUNCTION "public"."line_set_budget"');
  const body = budgetSql.slice(start, budgetSql.indexOf("\n$$;", start));

  test("security posture: definer, pinned search_path, service_role only", () => {
    expect(start).toBeGreaterThan(-1);
    expect(budgetSql).toContain("SECURITY DEFINER");
    expect(budgetSql).toContain("SET search_path TO 'public'");
    const sig = '"public"."line_set_budget"(text, integer, date)';
    expect(budgetSql).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC`);
    expect(budgetSql).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM "anon"`);
    expect(budgetSql).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM "authenticated"`);
    expect(budgetSql).toContain(`GRANT ALL ON FUNCTION ${sig} TO "service_role"`);
  });

  // [MV]: add a p_group parameter or drop the kind filter and this goes red.
  test("is ledger-only: no group parameter, resolves via ensure_personal_ledger, updates only a personal ledger", () => {
    expect(body).not.toMatch(/p_group\b/);
    expect(body).toContain("ensure_personal_ledger(");
    expect(body).toContain("id = v_group and kind = 'personal'");
  });

  // [MV]: loosen the lower bound to >= 0 and this goes red.
  test("range matches validateMonthlyBudgetMinor: above 0, at most 2,000,000,000", () => {
    expect(body).toContain("p_budget_minor > 0 and p_budget_minor <= 2000000000");
  });

  test("a no-op write does not touch the row", () => {
    expect(body).toContain("is distinct from p_budget_minor");
  });
});

/**
 * Strips `--` line comments and collapses whitespace, so two function bodies
 * compare by what they do and not by how they are laid out or commented.
 */
function normalizeSql(sql: string): string {
  return sql.replace(/--.*$/gm, "").replace(/\s+/g, " ").trim();
}

/** One function's definition: from its CREATE OR REPLACE up to (not including) the closing `$$;`. */
function functionSql(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION "public"."${name}"`);
  expect(start, `${name} should be defined`).toBeGreaterThan(-1);
  const end = sql.indexOf("\n$$;", start);
  expect(end, `${name} should end with $$;`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe("line_month_categories migration", () => {
  const helper = functionSql(categoriesSql, "line_ledger_month_categories");
  const summary = functionSql(categoriesSql, "line_month_summary");
  const totals = functionSql(botSql, "line_ledger_month_totals");

  test("security posture: definer, pinned search_path, owned by postgres, service_role only - for both functions", () => {
    expect(helper).toContain("LANGUAGE sql STABLE SECURITY DEFINER");
    expect(summary).toContain("LANGUAGE plpgsql SECURITY DEFINER");
    expect(helper).toContain("SET search_path TO 'public'");
    expect(summary).toContain("SET search_path TO 'public'");

    for (const sig of [
      '"public"."line_ledger_month_categories"(uuid, text, date, integer)',
      '"public"."line_month_summary"(text, date)',
    ]) {
      expect(categoriesSql).toContain(`ALTER FUNCTION ${sig} OWNER TO postgres`);
      expect(categoriesSql).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC`);
      expect(categoriesSql).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM "anon"`);
      expect(categoriesSql).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM "authenticated"`);
      expect(categoriesSql).toContain(`GRANT ALL ON FUNCTION ${sig} TO "service_role"`);
    }
  });

  // [MV]: loosen or drop any one of these in the helper (or in the totals helper it has to mirror) and this goes red.
  test.each([
    "e.group_id = p_group",
    "e.deleted_at is null",
    "e.currency = p_currency",
    "e.expense_date >= date_trunc('month', p_month_start)::date",
    "e.expense_date < (date_trunc('month', p_month_start) + interval '1 month')::date",
  ])("filters rows on `%s`, exactly like line_ledger_month_totals", (clause) => {
    expect(normalizeSql(totals), "line_ledger_month_totals").toContain(clause);
    expect(normalizeSql(helper), "line_ledger_month_categories").toContain(clause);
  });

  // [MV]: an income row counted as "spending" would make the breakdown add up to more than the month's expense total.
  test("counts expenses only", () => {
    expect(normalizeSql(helper)).toContain("e.kind = 'expense'");
  });

  // [MV]: the inner order decides WHICH categories survive the limit and how a tie breaks; the clamp keeps a caller-supplied limit in 1..20.
  test.each([
    ["the inner order that picks the survivors of the limit", "order by 2 desc, 1 asc"],
    ["the order of the returned array", "order by c.expense_minor desc, c.category asc"],
    ["the limit clamped to 1..20 with a default of 5", "least(greatest(coalesce(p_limit, 5), 1), 20)"],
    ["an empty category reading as general", "coalesce(nullif(e.category, ''), 'general')"],
    ["zero-total categories dropped", "having coalesce(sum(e.amount_minor), 0) > 0"],
  ])("the helper has %s", (_what, clause) => {
    expect(normalizeSql(helper)).toContain(clause);
  });

  // [MV]: any change to line_month_summary other than the new key - a changed guard, a dropped key, a reordered statement - makes the two normalised bodies differ.
  test("line_month_summary differs from the line_bot version only by the 'categories' key", () => {
    const before = normalizeSql(functionSql(botSql, "line_month_summary"));
    const after = normalizeSql(summary);
    const added = ", 'categories', line_ledger_month_categories(v_group, v_currency, p_month_start, 5)";

    // Without this the replace below is a no-op on a body that lost the key
    // altogether, and the comparison would pass for the wrong reason.
    expect(after).toContain(added);
    expect(after.replace(added, "")).toBe(before);
  });

  // [MV]: move the categories out of the final return expression (say, into a variable assigned earlier) and this goes red.
  test("line_month_summary takes the categories in the same return expression as the month totals, and still has no group parameter", () => {
    expect(summary).not.toMatch(/p_group\b/);

    const sql = normalizeSql(summary);
    const finalReturn = sql.lastIndexOf("return jsonb_build_object(");
    expect(finalReturn).toBeGreaterThan(-1);
    const tail = sql.slice(finalReturn);
    expect(tail).toContain("'month', line_ledger_month_totals(");
    expect(tail).toContain("'categories', line_ledger_month_categories(");
  });

  test("defines only the helper and line_month_summary - line_record_entry and line_set_budget are left alone", () => {
    const defined = [...categoriesSql.matchAll(/CREATE OR REPLACE FUNCTION "public"\."(\w+)"/g)].map((m) => m[1]);
    expect(defined).toEqual(["line_ledger_month_categories", "line_month_summary"]);
  });
});
