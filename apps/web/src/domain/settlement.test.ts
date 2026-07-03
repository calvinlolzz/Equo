import { describe, expect, test } from "vitest";
import { money } from "./money.js";
import { calculateSettlement } from "./settlement.js";

describe("calculateSettlement", () => {
  test("calculates minimal transfers", () => {
    const transfers = calculateSettlement([
      { memberId: "alice", balance: money(600, "TWD") },
      { memberId: "bob", balance: money(-200, "TWD") },
      { memberId: "cora", balance: money(-400, "TWD") },
    ]);

    expect(transfers).toEqual([
      { fromMemberId: "cora", toMemberId: "alice", amount: money(400, "TWD") },
      { fromMemberId: "bob", toMemberId: "alice", amount: money(200, "TWD") },
    ]);
  });

  test("throws when currencies differ", () => {
    expect(() =>
      calculateSettlement([
        { memberId: "alice", balance: money(600, "TWD") },
        { memberId: "bob", balance: money(-600, "USD") },
      ]),
    ).toThrow("All money values must use the same currency");
  });
});
