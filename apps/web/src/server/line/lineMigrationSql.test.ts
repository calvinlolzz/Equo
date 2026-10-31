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
const replacedBySql = readFileSync(join(MIGRATIONS_DIR, "20261101090000_expense_replaced_by.sql"), "utf8");
const entryActionsSql = readFileSync(join(MIGRATIONS_DIR, "20261101090100_line_entry_actions.sql"), "utf8");
const receiptsSql = readFileSync(join(MIGRATIONS_DIR, "20260826014823_expense_receipts_and_comments.sql"), "utf8");
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
    ["20261101090100_line_entry_actions.sql", entryActionsSql],
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

/**
 * expenses.replaced_by_expense_id: the forwarding address replace_expense
 * leaves on the row an edit retires. The patch is applied to the LIVE
 * function (anchor + hit count), so what is pinned here is the patch text
 * itself - the function body is not in the migration.
 */
describe("expense_replaced_by migration", () => {
  const anchor = "return jsonb_build_object('expense', v_next, 'previous', v_previous);";
  const patchStart = replacedBySql.indexOf("DO $patch$");
  const patchSql = replacedBySql.slice(patchStart);

  test("adds a nullable uuid column, re-runnable", () => {
    expect(replacedBySql).toContain("ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS replaced_by_expense_id uuid;");
    expect(replacedBySql).not.toMatch(/replaced_by_expense_id uuid NOT NULL/i);
  });

  // [MV]: ON DELETE SET NULL is what lets a hard delete (account deletion, retention, admin purge) of the newer row go through without dangling.
  test("the foreign key points at expenses(id) and SETs NULL on delete, guarded for re-runs", () => {
    expect(replacedBySql).toContain("FOREIGN KEY (replaced_by_expense_id) REFERENCES public.expenses(id) ON DELETE SET NULL");
    expect(replacedBySql).toContain("IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_replaced_by_expense_id_fkey')");
  });

  test("indexes the foreign key (deleting a parent row scans it)", () => {
    expect(replacedBySql).toContain(
      "CREATE INDEX IF NOT EXISTS expenses_replaced_by_expense_id_idx ON public.expenses (replaced_by_expense_id);",
    );
  });

  // [MV]: any other anchor (say, the start of the function) and the pointer is written before the new row exists.
  test("anchors on the final return of replace_expense, and the anchor exists exactly once in its source migration", () => {
    expect(patchSql).toContain(`v_anchor constant text := $anchor$${anchor}$anchor$;`);
    expect(receiptsSql.split(anchor).length - 1).toBe(1);
  });

  // [MV]: drop the hit-count check and a drifted function is patched blind.
  test("aborts unless the anchor appears exactly once", () => {
    expect(patchSql).toContain("v_hits <> 1");
    expect(patchSql).toContain("anchor appears % times in replace_expense (expected 1)");
  });

  test("is re-runnable: an already patched function is skipped", () => {
    const skip = patchSql.indexOf("replace_expense already patched, skipping");
    expect(skip).toBeGreaterThan(-1);
    expect(patchSql.indexOf("position('replaced_by_expense_id' in v_def) > 0")).toBeLessThan(skip);
    expect(skip).toBeLessThan(patchSql.indexOf("EXECUTE replace("));
  });

  // [MV]: put the insert after the anchor and the statement is unreachable; drop it and no edit leaves a forwarding address.
  test("inserts the pointer update immediately before the final return", () => {
    expect(patchSql).toContain("EXECUTE replace(v_def, v_anchor, v_insert || v_anchor);");
  });

  // [MV]: drop `group_id = p_group_id` and the update could touch another ledger's row with the same id; drop the where and every row is repointed.
  test("the insert writes the new id onto the retired row, inside the same group", () => {
    const insert = patchSql.slice(patchSql.indexOf("v_insert constant text := $repl$"), patchSql.indexOf("$repl$;"));
    expect(insert).toContain("update expenses set replaced_by_expense_id = (v_next ->> 'id')::uuid");
    expect(insert).toContain("where id = p_expense_id and group_id = p_group_id;");
  });

  test("re-reads the function afterwards: the patch landed, the comment move survived, nothing else changed", () => {
    expect(patchSql).toContain("patch did not land in replace_expense");
    expect(patchSql).toContain("position('update expense_comments' in v_patched) = 0");
    expect(patchSql).toContain("replace(v_patched, v_insert, '') <> v_def");
    expect(patchSql).toContain("replace_expense changed by more than the patch");
  });

  test("does not restate replace_expense: no CREATE FUNCTION anywhere in the migration", () => {
    expect(normalizeSql(replacedBySql)).not.toMatch(/create (or replace )?function/i);
  });

  test("carries the un-patch as comments only, undoing exactly the same insert at the same anchor", () => {
    const lines = replacedBySql.split("\n");
    const first = lines.findIndex((l) => l.startsWith("--   DO $unpatch$"));
    const last = lines.findIndex((l) => l.startsWith("--   $unpatch$;"));
    expect(first).toBeGreaterThan(-1);
    expect(last).toBeGreaterThan(first);

    const unpatch = lines.slice(first, last + 1).join("\n");
    expect(unpatch).toContain("v_anchor constant text := 'return jsonb_build_object(''expense'', v_next, ''previous'', v_previous);';");
    expect(unpatch).toContain("update expenses set replaced_by_expense_id = (v_next ->> ''id'')::uuid");
    expect(unpatch).toContain("where id = p_expense_id and group_id = p_group_id;");
    expect(unpatch).toContain("EXECUTE replace(v_def, v_insert || v_anchor, v_anchor);");
    // Nothing of it is executable.
    expect(replacedBySql.split("$unpatch$").length - 1).toBe(2);
    expect(normalizeSql(replacedBySql)).not.toContain("$unpatch$");
  });
});

/**
 * The record card's 編輯/刪除 and the mood card's streak. A card names its
 * entry by the LINE event key, which line_record_entry stored as
 * expenses.client_request_id = 'line:' || key. Everything a webhook can reach
 * resolves that key inside the SENDER's personal ledger only.
 */
describe("line_entry_actions migration", () => {
  const FUNCTIONS = [
    "line_personal_ledger_id",
    "line_entry_lookup",
    "line_entry_resolve",
    "line_entry_status",
    "line_delete_entry",
    "line_ledger_stats",
    "line_streak",
  ];
  const SIGNATURES: Record<string, string> = {
    line_personal_ledger_id: "(uuid)",
    line_entry_lookup: "(uuid, text)",
    line_entry_resolve: "(uuid, text)",
    line_entry_status: "(text, text)",
    line_delete_entry: "(text, text, text)",
    line_ledger_stats: "(uuid, date)",
    line_streak: "(text, date)",
  };
  const KEY_PATTERN = "'^[A-Za-z0-9:_-]{8,80}$'";

  const fn = (name: string) => functionSql(entryActionsSql, name);
  const body = (name: string) => normalizeSql(fn(name));

  test("defines exactly these seven functions - line_record_entry, line_undo_last and the 復原 tables are left alone", () => {
    const defined = [...entryActionsSql.matchAll(/CREATE OR REPLACE FUNCTION "public"\."(\w+)"/g)].map((m) => m[1]);
    expect(defined).toEqual(FUNCTIONS);
    // 復原 keeps its semantics: a card delete must not touch its bookkeeping.
    const code = normalizeSql(entryActionsSql);
    expect(code).not.toContain("line_bot_entries");
    expect(code).not.toContain("line_undo_events");
    expect(code).not.toContain("undone_at");
  });

  test.each(FUNCTIONS)("%s: definer, pinned search_path, owned by postgres, service_role only", (name) => {
    expect(fn(name)).toContain("SECURITY DEFINER");
    expect(fn(name)).toContain("SET search_path TO 'public'");
    const sig = `"public"."${name}"${SIGNATURES[name]}`;
    expect(entryActionsSql).toContain(`ALTER FUNCTION ${sig} OWNER TO postgres`);
    for (const role of ["PUBLIC", '"anon"', '"authenticated"']) {
      expect(entryActionsSql).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM ${role}`);
    }
    expect(entryActionsSql).toContain(`GRANT ALL ON FUNCTION ${sig} TO "service_role"`);
  });

  // [MV]: a STABLE function that calls ensure_personal_ledger would WRITE (it creates the ledger) from a read-only context.
  test("only line_delete_entry is volatile, and no STABLE function calls ensure_personal_ledger", () => {
    for (const name of FUNCTIONS) {
      if (name === "line_delete_entry") {
        expect(fn(name)).not.toContain("STABLE");
        continue;
      }
      expect(fn(name), `${name} should be STABLE`).toMatch(/LANGUAGE (sql|plpgsql) STABLE SECURITY DEFINER/);
      expect(body(name), `${name} must not create a ledger`).not.toContain("ensure_personal_ledger");
    }
  });

  // [MV]: add a p_group (or p_user) parameter to a bot-facing function and a crafted postback could name another ledger.
  test("the webhook-facing functions take a LINE user id and no group or user id", () => {
    for (const name of ["line_entry_status", "line_delete_entry", "line_streak"]) {
      expect(body(name), name).toContain('"p_line_user_id" text');
      expect(body(name), name).not.toMatch(/\bp_group\b|\bp_user\b/);
    }
  });

  test("the web-facing line_entry_resolve takes the session user id, never a LINE id or a group", () => {
    const sql = body("line_entry_resolve");
    expect(sql).toContain('"p_user" uuid');
    expect(sql).not.toMatch(/\bp_group\b|p_line_user_id/);
    expect(sql).toContain("line_personal_ledger_id(p_user)");
  });

  test("the personal ledger is found by owner and kind, never a deleted one", () => {
    const sql = body("line_personal_ledger_id");
    expect(sql).toContain("g.owner_id = p_user and g.kind = 'personal' and g.deleted_at is null");
  });

  test("the key pattern is the one line_record_entry enforces on the event id, in lookup and in delete (key and event)", () => {
    expect(fn("line_entry_lookup")).toContain(`p_entry_key !~ ${KEY_PATTERN}`);
    expect(fn("line_delete_entry")).toContain(`p_entry_key !~ ${KEY_PATTERN}`);
    expect(fn("line_delete_entry")).toContain(`p_event_id !~ ${KEY_PATTERN}`);
    expect(functionSql(botSql, "line_record_entry")).toContain(`p_event_id ~ ${KEY_PATTERN}`);
    expect(fn("line_delete_entry")).toContain("raise exception 'LINE_INVALID_ENTRY'");
  });

  describe("line_entry_lookup", () => {
    const sql = body("line_entry_lookup");

    // [MV]: drop the group filter from the first select and a key resolves in anyone's ledger.
    test("finds the entry by ledger and the 'line:' client_request_id", () => {
      expect(sql).toContain("where e.group_id = p_group and e.client_request_id = 'line:' || p_entry_key");
    });

    // [MV]: drop `and e.group_id = p_group` from the chain walk and a pointer can lead into another ledger.
    test("every hop of the chain stays inside the ledger", () => {
      expect(sql).toContain("where e.id = v_next and e.group_id = p_group");
      expect(sql.split("e.group_id = p_group").length - 1).toBe(2);
      // A hop that leaves the ledger ends the chain as 'not live', with no id to act on.
      expect(sql).toContain("jsonb_build_object('expense_id', null, 'live', false, 'edited', true)");
    });

    // [MV]: remove `v_hops < 50` and a pointer cycle spins forever.
    test("the chain walk is bounded, and only follows a retired row that has a successor", () => {
      expect(sql).toContain("while v_deleted is not null and v_next is not null and v_hops < 50 loop");
    });

    test("answers {expense_id, live, edited}, with edited meaning at least one hop", () => {
      expect(sql).toContain("jsonb_build_object('expense_id', v_id, 'live', v_deleted is null, 'edited', v_hops > 0)");
    });

    test("a malformed key or a missing ledger is 'no such entry', not an error", () => {
      expect(sql).toContain("if p_group is null or p_entry_key is null or p_entry_key !~");
    });
  });

  describe("line_delete_entry", () => {
    const sql = body("line_delete_entry");

    // [MV]: move the replay check below the lookup and a redelivered 確定刪除 finds the entry already gone and answers 'already gone' instead of 'deleted'.
    test("checks for this event's earlier outcome BEFORE resolving the entry", () => {
      const replay = sql.indexOf("from client_requests cr");
      const lookup = sql.indexOf("line_entry_lookup(");
      expect(replay).toBeGreaterThan(-1);
      expect(lookup).toBeGreaterThan(-1);
      expect(replay).toBeLessThan(lookup);
      expect(sql).toContain("cr.group_id = v_group and cr.client_request_id = 'line:' || p_event_id");
      expect(sql).toContain("'ok', true, 'replay', true, 'expense', expense_json(v_prior)");
    });

    // [MV]: drop `for update` and two taps (or a tap racing an app edit) both pass the check.
    test("locks the target row, then re-checks it, so two taps cannot both delete", () => {
      const lock = sql.indexOf("for update");
      expect(lock).toBeGreaterThan(-1);
      expect(sql).toContain("where e.id = v_target and e.group_id = v_group for update");
      expect(sql.indexOf("line_entry_lookup(")).toBeLessThan(lock);
      expect(sql).toContain("if not found or v_target_deleted is not null then");
      expect(lock).toBeLessThan(sql.indexOf("soft_delete_expense("));
    });

    test("deletes through soft_delete_expense in the sender's ledger, keyed by this event", () => {
      expect(sql).toContain("soft_delete_expense(v_group, v_user, v_target, 'line:' || p_event_id)");
      expect(sql).toContain("v_group := line_personal_ledger_id(v_user)");
    });

    test("every refusal is a reason, in the vocabulary the TypeScript result type declares", () => {
      for (const reason of ["not_linked", "account_disabled", "not_found", "already_gone"]) {
        expect(sql, reason).toContain(`'reason', '${reason}'`);
      }
      // An edited-away chain with no live end, or a retired entry, is 'already_gone' - never an exception.
      expect(sql).toContain("if v_target is null or not (v_found ->> 'live')::boolean then");
    });

    test("reports whether the card's row had been edited, so the caller can say so", () => {
      expect(sql).toContain("'edited', (v_found ->> 'edited')::boolean");
    });
  });

  describe("line_entry_status and line_entry_resolve", () => {
    test("status is read only and returns the CURRENT expense, not the card's", () => {
      const sql = body("line_entry_status");
      expect(sql).toContain("line_entry_lookup(line_personal_ledger_id(v_user), p_entry_key)");
      expect(sql).toContain("'expense', expense_json((v_found ->> 'expense_id')::uuid)");
      expect(sql).not.toMatch(/\b(insert|update|delete)\b/);
    });

    test("status refuses an unlinked or disabled account before looking anything up", () => {
      const sql = body("line_entry_status");
      expect(sql.indexOf("'not_linked'")).toBeLessThan(sql.indexOf("line_entry_lookup("));
      expect(sql.indexOf("'account_disabled'")).toBeLessThan(sql.indexOf("line_entry_lookup("));
    });

    test("resolve answers not_found / gone / live, and only a live entry reveals ids", () => {
      const sql = body("line_entry_resolve");
      expect(sql).toContain("jsonb_build_object('status', 'not_found')");
      expect(sql).toContain("jsonb_build_object('status', 'gone')");
      expect(sql.indexOf("'gone'")).toBeLessThan(sql.indexOf("'group_id'"));
      expect(sql).not.toMatch(/\b(insert|update|delete)\b/);
    });
  });

  describe("line_ledger_stats and line_streak", () => {
    const stats = body("line_ledger_stats");

    // [MV]: drop any one and the card counts rows it should not (someone else's, deleted, a transfer, a future-dated one).
    test.each([
      "e.group_id = p_group",
      "e.deleted_at is null",
      "e.kind in ('expense', 'income')",
      "e.expense_date <= p_today",
    ])("counts only rows with `%s`", (clause) => {
      expect(stats).toContain(clause);
    });

    test("the streak is the run of consecutive days ending today (none today = 0)", () => {
      expect(stats).toContain("row_number() over (order by d desc) as rn");
      expect(stats).toContain("count(*) from ranked r where r.d = p_today - (r.rn - 1)::integer");
    });

    test("looks back 400 days at most, and the week starts on Monday (ISO)", () => {
      expect(stats).toContain("l.expense_date > p_today - 400");
      expect(stats).toContain("date_trunc('week', p_today)::date + g.i");
      expect(stats).toContain("extract(isodow from p_today)::integer - 1");
    });

    test("returns the six keys the TypeScript side parses", () => {
      for (const key of ["streak_days", "week", "today_index", "month_days", "today_entries", "total_entries"]) {
        expect(stats, key).toContain(`'${key}'`);
      }
    });

    test("line_streak wraps it for the sender's ledger and never creates one", () => {
      const sql = body("line_streak");
      expect(sql).toContain("'ok', true, 'stats', line_ledger_stats(v_group, p_today)");
      expect(sql).toContain("'reason', 'no_ledger'");
      expect(sql).toContain("v_group := line_personal_ledger_id(v_user)");
    });
  });
});
