import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Static source guard: the personal ledger no longer folds group shares into
 * its home screen, its 分析, or any client/server plumbing. This repo has no
 * integration test against a live database, so the "it's really gone"
 * invariant is pinned as source text too, mirroring
 * catalogSeed.test.ts's approach.
 */
const APP_DIR = __dirname;
const SERVER_DIR = join(__dirname, "..", "server");

const CLIENT_FILES = [
  "App.tsx",
  "PersonalLedgerHome.tsx",
  "cloudStore.ts",
  "cloudCache.ts",
  "apiClient.ts",
  "personalLedger.ts",
];

describe("[MV] ledger independence source guard", () => {
  test.each(CLIENT_FILES)("%s contains neither group-shares nor combineLedgerMonth", (file) => {
    const source = readFileSync(join(APP_DIR, file), "utf8");
    expect(source).not.toContain("group-shares");
    expect(source).not.toContain("combineLedgerMonth");
  });

  test("server/http/runtime.ts contains neither group-shares nor combineLedgerMonth", () => {
    const source = readFileSync(join(SERVER_DIR, "http", "runtime.ts"), "utf8");
    expect(source).not.toContain("group-shares");
    expect(source).not.toContain("combineLedgerMonth");
  });

  test("server/repositories/supabaseSpendRepository.ts does not contain personal_month_group_shares", () => {
    const source = readFileSync(join(SERVER_DIR, "repositories", "supabaseSpendRepository.ts"), "utf8");
    expect(source).not.toContain("personal_month_group_shares");
  });
});
