import { describe, expect, test } from "vitest";
import type { Member } from "./appTypes";
import { heroBalanceMembers } from "./heroBalanceRows";

const members: Member[] = [
  { id: "m_alice", name: "Alice", role: "owner" },
  { id: "m_bob", name: "Bob" },
  { id: "m_cara", name: "Cara" },
  { id: "m_dan", name: "Dan" },
];

/** Alice is barely off; Cara is the furthest from settled; Dan owes the most. */
const balances = new Map<string, number>([
  ["m_alice", 100],
  ["m_bob", 200],
  ["m_cara", 9_000],
  ["m_dan", -12_000],
]);

const names = (picked: Member[]) => picked.map((member) => member.name);

describe("heroBalanceMembers", () => {
  test("puts you first even when you are last in the group", () => {
    expect(names(heroBalanceMembers(members, balances, "m_dan", 2))).toEqual(["Dan", "Cara"]);
  });

  test("the second row is whoever is furthest from settled, not the next in the array", () => {
    // Bob is members[1]; Cara is the one worth a row.
    expect(names(heroBalanceMembers(members, balances, "m_alice", 2))).toEqual(["Alice", "Dan"]);
  });

  test("owing and being owed are equally interesting - it ranks on distance from zero", () => {
    const owed = new Map<string, number>([
      ["m_alice", 0],
      ["m_bob", -8_000],
      ["m_cara", 500],
      ["m_dan", 0],
    ]);
    // Bob is the most negative and still wins the row.
    expect(names(heroBalanceMembers(members, owed, "m_alice", 2))).toEqual(["Alice", "Bob"]);
  });

  test("with no self to pin, it simply ranks everyone", () => {
    expect(names(heroBalanceMembers(members, balances, undefined, 2))).toEqual(["Dan", "Cara"]);
    // An id the group has never had behaves the same way, rather than throwing.
    expect(names(heroBalanceMembers(members, balances, "m_ghost", 2))).toEqual(["Dan", "Cara"]);
  });

  test("an all-settled group keeps the group's own order behind you", () => {
    const settled = new Map(members.map((member) => [member.id, 0] as const));
    expect(names(heroBalanceMembers(members, settled, "m_cara", 2))).toEqual(["Cara", "Alice"]);
  });

  test("never invents a row: a one-member group returns one", () => {
    const solo = [members[0]];
    expect(names(heroBalanceMembers(solo, balances, "m_alice"))).toEqual(["Alice"]);
    expect(heroBalanceMembers([], balances, "m_alice")).toEqual([]);
  });

  test("honours a larger limit without repeating you", () => {
    expect(names(heroBalanceMembers(members, balances, "m_bob", 4))).toEqual(["Bob", "Dan", "Cara", "Alice"]);
  });
});
