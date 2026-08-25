import { describe, expect, test } from "vitest";
import type { AdminHealthSummary } from "./apiClient";
import {
  brokenRecurringRules,
  pushTiles,
  scheduledJobTiles,
  inboxItems,
  healthTiles,
  adminRoleLabel,
  auditActionLabel,
  auditTargetText,
  describeLastSeen,
  expenseCategoryLabel,
  expenseImageUrl,
  expenseKindLabel,
  formatBytes,
  formatDate,
  formatDateTime,
  formatExpenseAmount,
  formatLatency,
  formatUsdMicros,
  inviteStatus,
  inviteStatusLabel,
  scanFailureRate,
  scanUsageTiles,
  overviewTiles,
  storageTiles,
  pageInfo,
  payerSummary,
  shareTypeLabel,
} from "./adminDashboard";

const overview = {
  user_count: 5,
  active_users_7d: 3,
  new_users_7d: 1,
  group_count: 27,
  active_groups_7d: 4,
  expense_count: 32,
  expenses_7d: 6,
};

describe("overviewTiles", () => {
  test("maps the overview payload into four labelled tiles", () => {
    const tiles = overviewTiles(overview);

    expect(tiles.map((tile) => tile.key)).toEqual(["users", "new_users", "groups", "expenses"]);
    expect(tiles[0]).toMatchObject({ value: 5, hint: "近 7 日活躍 3" });
    expect(tiles[2]).toMatchObject({ value: 27, hint: "近 7 日有記帳 4" });
    expect(tiles[3]).toMatchObject({ value: 32, hint: "近 7 日新增 6" });
  });
});

describe("pageInfo", () => {
  test("first page of a multi-page list", () => {
    expect(pageInfo(45, 20, 0, 20)).toEqual({
      page: 1,
      pageCount: 3,
      hasPrev: false,
      hasNext: true,
      rangeStart: 1,
      rangeEnd: 20,
    });
  });

  test("last partial page", () => {
    expect(pageInfo(45, 20, 40, 5)).toEqual({
      page: 3,
      pageCount: 3,
      hasPrev: true,
      hasNext: false,
      rangeStart: 41,
      rangeEnd: 45,
    });
  });

  test("empty result set", () => {
    expect(pageInfo(0, 20, 0, 0)).toEqual({
      page: 1,
      pageCount: 1,
      hasPrev: false,
      hasNext: false,
      rangeStart: 0,
      rangeEnd: 0,
    });
  });
});

describe("describeLastSeen", () => {
  const now = Date.parse("2026-07-11T12:00:00.000Z");

  test("buckets recent activity into zh-TW relative labels", () => {
    expect(describeLastSeen("2026-07-11T11:59:30.000Z", now)).toBe("剛剛");
    expect(describeLastSeen("2026-07-11T11:15:00.000Z", now)).toBe("45 分鐘前");
    expect(describeLastSeen("2026-07-11T04:00:00.000Z", now)).toBe("8 小時前");
    expect(describeLastSeen("2026-07-08T12:00:00.000Z", now)).toBe("3 天前");
  });

  test("falls back to the absolute date beyond 30 days", () => {
    expect(describeLastSeen("2026-05-01T00:00:00.000Z", now)).toBe("2026/05/01");
  });

  test("renders an em dash for invalid timestamps", () => {
    expect(describeLastSeen("not-a-date", now)).toBe("—");
  });
});

describe("audit helpers", () => {
  test("translates known actions and passes unknown ones through", () => {
    expect(auditActionLabel("user.disable")).toBe("停用帳號");
    expect(auditActionLabel("group.restore")).toBe("復原群組");
    expect(auditActionLabel("future.action")).toBe("future.action");
  });

  test("prefers the group name, falls back to email, then em dash", () => {
    expect(auditTargetText({ name: "東京旅行", group_id: "g1" })).toBe("東京旅行");
    expect(auditTargetText({ email: "alice@example.com" })).toBe("alice@example.com");
    expect(auditTargetText({})).toBe("—");
  });

  test("formatDateTime renders date and minutes, dash on invalid", () => {
    expect(formatDateTime("2026-07-11T08:05:00.000Z")).toMatch(/^2026\/07\/11 \d{2}:\d{2}$/);
    expect(formatDateTime("bogus")).toBe("—");
    expect(formatDateTime(null)).toBe("—");
  });
});

describe("formatDate", () => {
  test("formats ISO timestamps as YYYY/MM/DD", () => {
    expect(formatDate("2026-07-01T08:30:00.000Z")).toMatch(/^2026\/0[67]\/\d{2}$/);
  });

  test("renders an em dash for null or invalid input", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("nope")).toBe("—");
  });
});

describe("expense labels", () => {
  test("translates known kinds and share types, passing unknown ones through", () => {
    expect(expenseKindLabel("expense")).toBe("支出");
    expect(expenseKindLabel("transfer")).toBe("轉帳");
    expect(expenseKindLabel("future_kind")).toBe("future_kind");
    expect(shareTypeLabel("equal")).toBe("均分");
    expect(shareTypeLabel("percent")).toBe("百分比");
    expect(shareTypeLabel("future_type")).toBe("future_type");
  });

  test("reuses the app's category dictionary, passing unknown categories through", () => {
    expect(expenseCategoryLabel("food")).toBe("餐飲");
    expect(expenseCategoryLabel("lodging")).toBe("住宿");
    expect(expenseCategoryLabel("crypto")).toBe("crypto");
  });
});

describe("expenseImageUrl", () => {
  test("prefers image_url but falls back to the legacy receipt column", () => {
    expect(expenseImageUrl({ image_url: "https://cdn/a.jpg", receipt_image_url: "https://cdn/b.jpg" })).toBe(
      "https://cdn/a.jpg",
    );
    expect(expenseImageUrl({ image_url: null, receipt_image_url: "https://cdn/b.jpg" })).toBe("https://cdn/b.jpg");
  });

  test("returns null when neither column has a usable url", () => {
    expect(expenseImageUrl({ image_url: null, receipt_image_url: null })).toBeNull();
    expect(expenseImageUrl({ image_url: "", receipt_image_url: "" })).toBeNull();
  });
});

describe("payerSummary", () => {
  test("names a single payer but collapses multi-payer expenses to a count", () => {
    const payer = { member_id: "m1", display_name: "Alice", amount_minor: 1000, currency: "TWD" };

    expect(payerSummary([payer])).toBe("Alice");
    expect(payerSummary([payer, { ...payer, member_id: "m2", display_name: "Bob" }])).toBe("2 人分攤付款");
  });

  test("renders an em dash for no payers or a nameless one", () => {
    expect(payerSummary([])).toBe("—");
    expect(payerSummary([{ member_id: "m1", display_name: null, amount_minor: 1000, currency: "TWD" }])).toBe("—");
  });
});

describe("formatExpenseAmount", () => {
  test("formats a real amount but renders legacy null amounts as an em dash, not $0", () => {
    expect(formatExpenseAmount(12_000, "TWD")).toBe("$120");
    expect(formatExpenseAmount(0, "TWD")).toBe("$0");
    expect(formatExpenseAmount(null, "TWD")).toBe("—");
  });
});

describe("formatBytes", () => {
  test("scales to binary units and drops the decimal on whole values", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(861938)).toBe("842 KB");
    expect(formatBytes(1024 * 1024)).toBe("1 MB");
    expect(formatBytes(1.4 * 1024 * 1024)).toBe("1.4 MB");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3 GB");
  });

  test("guards against negative or non-finite sizes", () => {
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
});

describe("storageTiles", () => {
  test("with no orphans, the orphan tile is calm and reassuring", () => {
    const tiles = storageTiles({ object_count: 13, total_bytes: 861938, orphan_count: 0, orphan_bytes: 0 });
    const orphan = tiles.find((t) => t.key === "orphans");

    expect(tiles.map((t) => t.value)).toEqual(["13", "842 KB", "0"]);
    expect(orphan?.danger).toBe(false);
    expect(orphan?.hint).toBe("沒有未引用的圖片");
  });

  test("with orphans, the orphan tile flags danger and reports the wasted size", () => {
    const orphan = storageTiles({
      object_count: 20,
      total_bytes: 2_000_000,
      orphan_count: 3,
      orphan_bytes: 500_000,
    }).find((t) => t.key === "orphans");

    expect(orphan?.value).toBe("3");
    expect(orphan?.danger).toBe(true);
    expect(orphan?.hint).toBe("占用 488 KB");
  });
});

describe("inviteStatus", () => {
  const now = Date.parse("2026-07-18T00:00:00.000Z");
  const base = {
    id: "inv1",
    max_uses: 5,
    use_count: 0,
    expires_at: null,
    revoked_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    created_by_name: "Alice",
  };

  test("a fresh, unexpired, unused invite is live", () => {
    expect(inviteStatus(base, now)).toBe("live");
  });

  test("revoked wins over every other state", () => {
    expect(
      inviteStatus({ ...base, revoked_at: "2026-07-10T00:00:00.000Z", use_count: 99, expires_at: "2020-01-01T00:00:00.000Z" }, now),
    ).toBe("revoked");
  });

  test("expiry beats exhausted uses", () => {
    expect(inviteStatus({ ...base, expires_at: "2026-07-17T00:00:00.000Z", use_count: 99 }, now)).toBe("expired");
  });

  test("use_count reaching max_uses is used up", () => {
    expect(inviteStatus({ ...base, use_count: 5 }, now)).toBe("used_up");
    expect(inviteStatus({ ...base, use_count: 4 }, now)).toBe("live");
  });

  test("labels every status in zh-TW", () => {
    expect(inviteStatusLabel("live")).toBe("有效");
    expect(inviteStatusLabel("revoked")).toBe("已撤銷");
    expect(inviteStatusLabel("expired")).toBe("已過期");
    expect(inviteStatusLabel("used_up")).toBe("已用完");
  });
});

describe("adminRoleLabel", () => {
  test("labels known roles in zh-TW and passes unknown ones through", () => {
    expect(adminRoleLabel("owner")).toBe("擁有者");
    expect(adminRoleLabel("admin")).toBe("管理員");
    expect(adminRoleLabel("support")).toBe("客服");
    expect(adminRoleLabel("future_role")).toBe("future_role");
  });

  test("labels the new admin.* audit actions", () => {
    expect(auditActionLabel("admin.grant")).toBe("新增管理員");
    expect(auditActionLabel("admin.role_change")).toBe("變更管理員角色");
    expect(auditActionLabel("admin.remove")).toBe("移除管理員");
  });
});

describe("the receipt-scan usage panel", () => {
  const summary = {
    scans: 100,
    recognised: 80,
    unrecognised: 12,
    failed: 8,
    users: 5,
    cost_micros: 285_000,
    p50_ms: 4400,
    p95_ms: 11800,
    latest_at: "2026-08-24T01:00:00.000Z",
  };
  const usage = { days: 30, summary, by_day: [], by_model: [], top_users: [], recent_failures: [] };

  test("keeps a sub-cent total readable instead of rounding it to nothing", () => {
    // One Haiku scan. "$0.00" would read as "this feature is free", which is
    // the one conclusion this panel exists to prevent.
    expect(formatUsdMicros(2850)).toBe("$0.0029");
    expect(formatUsdMicros(285_000)).toBe("$0.285");
    expect(formatUsdMicros(4_120_000)).toBe("$4.12");
    expect(formatUsdMicros(0)).toBe("$0");
  });

  test("reads latency in the unit it is measured in", () => {
    expect(formatLatency(430)).toBe("430 ms");
    expect(formatLatency(4400)).toBe("4.4 s");
    // Nothing scanned yet is not "0 ms".
    expect(formatLatency(null)).toBe("—");
  });

  test("counts only real failures, so a blurry photo is not an outage", () => {
    expect(scanFailureRate(summary)).toBe(8);
    // 12 unrecognised scans are the model working correctly.
    expect(scanFailureRate({ ...summary, unrecognised: 50 })).toBe(8);
    expect(scanFailureRate({ ...summary, scans: 0, failed: 0 })).toBe(0);
  });

  test("flags the failure tile only once failures stop looking like bad photos", () => {
    const calm = scanUsageTiles(usage).find((tile) => tile.key === "failed");
    expect(calm).toMatchObject({ value: "8%", danger: false });

    const alarming = scanUsageTiles({ ...usage, summary: { ...summary, failed: 30 } }).find(
      (tile) => tile.key === "failed",
    );
    expect(alarming).toMatchObject({ value: "30%", danger: true });
  });

  test("shows dashes rather than 0% when nothing has been scanned", () => {
    const empty = { ...usage, summary: { ...summary, scans: 0, recognised: 0, unrecognised: 0, failed: 0 } };
    const tiles = scanUsageTiles(empty);

    expect(tiles.find((tile) => tile.key === "recognised")?.value).toBe("—");
    expect(tiles.find((tile) => tile.key === "failed")?.value).toBe("—");
  });
});

describe("scheduled job heartbeats", () => {
  const now = Date.parse("2026-08-24T03:00:00.000Z");
  const fresh = "2026-08-23T18:30:00.000Z"; // last night's 02:30 Taipei run

  const health = {
    backup: { last_success_at: fresh, detail: { bytes: 77_904 } },
    jobs: [
      { kind: "db_backup", last_success_at: fresh, detail: { bytes: 77_904 } },
      { kind: "recurring_expenses", last_success_at: fresh, detail: { created: 2, failed: 0, skipped: 0 } },
      { kind: "retention", last_success_at: fresh, detail: { invites: { deleted: 3 }, error_logs: { logs_deleted: 4 } } },
    ],
    rate_limit: { active_buckets: 0, blocked_24h: 0 },
    errors: { last_24h: 0, last_7d: 0, latest_at: null, open_groups: 0 },
    feedback: { open: 0 },
  };

  test("a job that has never run reads as bad, not as absent", () => {
    // THE case this exists for: a failed dump aborts the workflow before the
    // recurring step, so ops_heartbeats simply has no row - and until now that
    // showed as nothing at all while somebody's rent quietly never appeared.
    const tiles = scheduledJobTiles({ ...health, jobs: [health.jobs[0]] }, now);
    const recurring = tiles.find((tile) => tile.key === "job:recurring_expenses");

    expect(recurring).toMatchObject({ value: "從未", tone: "bad" });
  });

  test("a fresh run is ok and says what it did", () => {
    const tiles = scheduledJobTiles(health, now);

    expect(tiles.find((tile) => tile.key === "job:recurring_expenses")).toMatchObject({
      tone: "ok",
      hint: "上次新增 2 筆",
    });
    expect(tiles.find((tile) => tile.key === "job:retention")?.hint).toBe("上次清理 7 列");
  });

  test("a run older than a day and a half has stopped, not run late", () => {
    const stale = [{ kind: "recurring_expenses", last_success_at: "2026-08-20T18:30:00.000Z", detail: {} }];
    const tiles = scheduledJobTiles({ ...health, jobs: stale }, now);

    expect(tiles.find((tile) => tile.key === "job:recurring_expenses")?.tone).toBe("warn");
  });

  test("a fresh run that deactivated a rule still warns", () => {
    // The rule is switched off with its error stored, so it stops producing
    // expenses silently. A green tile over that would be a lie.
    const jobs = [{ kind: "recurring_expenses", last_success_at: fresh, detail: { created: 1, failed: 2 } }];
    const tiles = scheduledJobTiles({ ...health, jobs }, now);

    expect(tiles.find((tile) => tile.key === "job:recurring_expenses")).toMatchObject({
      tone: "warn",
      hint: "新增 1 筆・2 條規則失敗",
    });
  });

  test("an absent jobs field says nothing, an empty one says never-run", () => {
    // These mean opposite things. `undefined` is an API that predates the
    // field and knows nothing about heartbeats - claiming every job has never
    // run would be a false alarm on every old deployment. `[]` is an API that
    // does report them and has none, which is the real failure.
    expect(scheduledJobTiles({ ...health, jobs: undefined }, now)).toEqual([]);
    expect(inboxItems({ ...health, jobs: undefined }, now)).toEqual([]);

    const empty = scheduledJobTiles({ ...health, jobs: [] }, now);
    expect(empty).toHaveLength(2);
    expect(empty.every((tile) => tile.tone === "bad")).toBe(true);
    expect(inboxItems({ ...health, jobs: [] }, now)).toHaveLength(2);
  });

  test("the health tiles carry the jobs alongside the backup", () => {
    const keys = healthTiles(health, now).map((tile) => tile.key);

    expect(keys).toContain("backup");
    expect(keys).toContain("job:recurring_expenses");
    expect(keys).toContain("job:retention");
  });

  test("a stopped job becomes something to do, not just a colour", () => {
    const items = inboxItems({ ...health, jobs: [health.jobs[0]] }, now);

    expect(items.map((item) => item.label)).toContain("循環支出從未執行");
  });

  test("a good night leaves the inbox empty", () => {
    expect(inboxItems(health, now)).toEqual([]);
  });
});

describe("push health", () => {
  const base = {
    backup: null,
    rate_limit: { active_buckets: 0, blocked_24h: 0 },
    errors: { last_24h: 0, last_7d: 0, latest_at: null, open_groups: 0 },
    feedback: { open: 0 },
  };

  function withPush(push: Partial<NonNullable<AdminHealthSummary["push"]>>) {
    return {
      ...base,
      push: {
        subscriptions: 4,
        subscribed_users: 2,
        admins: 2,
        subscribed_admins: 2,
        sent_7d: 20,
        failed_7d: 0,
        pruned_7d: 1,
        last_delivery_at: "2026-08-25T00:00:00.000Z",
        ...push,
      },
    } as AdminHealthSummary;
  }

  test("clean delivery is green, and pruned endpoints are not failures", () => {
    // A reinstalled app is SUPPOSED to be dropped; counting it as a failure
    // would make a healthy week look broken.
    const tile = pushTiles(withPush({ pruned_7d: 5 })).find((t) => t.key === "push_delivery");

    expect(tile).toMatchObject({ value: "0%", tone: "ok" });
    expect(tile?.hint).toContain("清掉失效 5");
  });

  test("a broken key shows as a high failure rate, not as silence", () => {
    const tile = pushTiles(withPush({ sent_7d: 2, failed_7d: 18 })).find((t) => t.key === "push_delivery");

    expect(tile).toMatchObject({ value: "90%", tone: "bad" });
  });

  test("an occasional failure warns rather than alarms", () => {
    const tile = pushTiles(withPush({ sent_7d: 19, failed_7d: 1 })).find((t) => t.key === "push_delivery");

    expect(tile?.tone).toBe("warn");
  });

  test("no traffic is not a failure rate", () => {
    const tile = pushTiles(withPush({ sent_7d: 0, failed_7d: 0 })).find((t) => t.key === "push_delivery");

    expect(tile).toMatchObject({ value: "—", tone: "ok" });
  });

  test("alerting that can reach nobody is the loudest tile on the card", () => {
    // The whole reason this exists: an operator with no subscription makes
    // error alerting look healthy while it shouts into a void.
    const tile = pushTiles(withPush({ subscribed_admins: 0 })).find((t) => t.key === "push_admins");

    expect(tile).toMatchObject({ value: "0/2", tone: "bad", hint: "沒有人收得到錯誤告警" });
  });

  test("some operators reachable is a warning, not an all-clear", () => {
    const tile = pushTiles(withPush({ admins: 3, subscribed_admins: 1 })).find((t) => t.key === "push_admins");

    expect(tile).toMatchObject({ value: "1/3", tone: "warn", hint: "2 位沒開推播" });
  });

  test("an API without the field renders nothing rather than inventing zeros", () => {
    expect(pushTiles(base as AdminHealthSummary)).toEqual([]);
  });

  test("unreachable operators become something to do", () => {
    const items = inboxItems(withPush({ subscribed_admins: 0 }), Date.parse("2026-08-25T01:00:00.000Z"));

    expect(items.map((item) => item.label)).toContain("沒有管理員收得到錯誤告警");
  });

  test("no admins configured at all is not reported as unreachable", () => {
    // A deployment with no owner/admin rows has nobody to page by definition;
    // 0/0 is not a fault to shout about.
    const items = inboxItems(withPush({ admins: 0, subscribed_admins: 0 }), Date.parse("2026-08-25T01:00:00.000Z"));

    expect(items.map((item) => item.label)).not.toContain("沒有管理員收得到錯誤告警");
  });
});

describe("broken 循環支出 rules", () => {
  const base = {
    backup: null,
    rate_limit: { active_buckets: 0, blocked_24h: 0 },
    errors: { last_24h: 0, last_7d: 0, latest_at: null, open_groups: 0 },
    feedback: { open: 0 },
  } as unknown as AdminHealthSummary;

  function withRecurring(rules: Array<Record<string, unknown>>, broken = rules.length) {
    return {
      ...base,
      recurring: { rules: rules.length, active: 0, broken, broken_rules: rules },
    } as unknown as AdminHealthSummary;
  }

  const rule = {
    id: "rule_1",
    title: "每月房租",
    group_id: "group_1",
    group_name: "室友",
    last_error: "INVALID_MEMBER:某位成員已離開群組",
    last_run_at: "2026-08-25T00:00:00.000Z",
    active: false,
  };

  test("carries what an operator needs to act: which rule, whose group, why", () => {
    expect(brokenRecurringRules(withRecurring([rule]))[0]).toEqual({
      id: "rule_1",
      title: "每月房租",
      groupId: "group_1",
      groupName: "室友",
      error: "INVALID_MEMBER:某位成員已離開群組",
      lastRunAt: "2026-08-25T00:00:00.000Z",
    });
  });

  test("a rule whose group is gone still reads as a row", () => {
    const [mapped] = brokenRecurringRules(withRecurring([{ ...rule, group_name: null }]));

    expect(mapped.groupName).toBe("(群組已刪除)");
  });

  test("a failure with no stored reason says so rather than rendering blank", () => {
    const [mapped] = brokenRecurringRules(withRecurring([{ ...rule, last_error: "  " }]));

    expect(mapped.error).toBe("（沒有記錄原因）");
  });

  test("nothing broken renders nothing", () => {
    expect(brokenRecurringRules(withRecurring([], 0))).toEqual([]);
    expect(brokenRecurringRules(base)).toEqual([]);
  });

  test("a stopped rule becomes something to do, counted", () => {
    const items = inboxItems(withRecurring([rule]), Date.parse("2026-08-26T00:00:00.000Z"));
    const entry = items.find((item) => item.key === "recurring:broken");

    expect(entry).toMatchObject({ label: "循環支出規則已停用", count: 1, tone: "warn" });
  });

  test("a healthy recurring setup adds nothing to the inbox", () => {
    // Asserting on the recurring key specifically: this fixture has no backup
    // heartbeat, so the inbox is legitimately non-empty for another reason.
    const healthy = {
      ...base,
      recurring: { rules: 5, active: 5, broken: 0, broken_rules: [] },
    } as unknown as AdminHealthSummary;

    const items = inboxItems(healthy, Date.parse("2026-08-26T00:00:00.000Z"));

    expect(items.some((item) => item.key === "recurring:broken")).toBe(false);
  });
});
