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
const SRC_DIR = join(__dirname, "..");
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

/** Files whose only trace of the removed feature would be the adapter/fixture name, not combineLedgerMonth. */
const SHARES_ADAPTER_FILES = [
  { label: "cloudAdapters.ts", path: join(APP_DIR, "cloudAdapters.ts") },
  { label: "screenshot.tsx", path: join(SRC_DIR, "screenshot.tsx") },
];

/** Server files whose route/handler names would carry "GroupShares" rather than combineLedgerMonth. */
const SERVER_ROUTE_FILES = [
  { label: "server/routes/spendRoutes.ts", path: join(SERVER_DIR, "routes", "spendRoutes.ts") },
  { label: "server/handlers/spend.ts", path: join(SERVER_DIR, "handlers", "spend.ts") },
];

describe("[MV] ledger independence source guard", () => {
  test.each(CLIENT_FILES)("%s contains neither group-shares nor combineLedgerMonth", (file) => {
    const source = readFileSync(join(APP_DIR, file), "utf8");
    expect(source).not.toContain("group-shares");
    expect(source).not.toContain("combineLedgerMonth");
  });

  test.each(SHARES_ADAPTER_FILES)("$label contains neither group-shares nor toPersonalShares", ({ path }) => {
    const source = readFileSync(path, "utf8");
    expect(source).not.toContain("group-shares");
    expect(source).not.toContain("toPersonalShares");
  });

  test("server/http/runtime.ts contains no group-shares route", () => {
    const source = readFileSync(join(SERVER_DIR, "http", "runtime.ts"), "utf8");
    expect(source).not.toContain("group-shares");
  });

  test.each(SERVER_ROUTE_FILES)("$label contains neither group-shares nor GroupShares", ({ path }) => {
    const source = readFileSync(path, "utf8");
    expect(source).not.toContain("group-shares");
    expect(source).not.toContain("GroupShares");
  });

  test("server/repositories/supabaseSpendRepository.ts does not contain personal_month_group_shares", () => {
    const source = readFileSync(join(SERVER_DIR, "repositories", "supabaseSpendRepository.ts"), "utf8");
    expect(source).not.toContain("personal_month_group_shares");
  });
});
