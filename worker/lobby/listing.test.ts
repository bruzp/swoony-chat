import { describe, expect, it } from "vitest";
import { listUsers } from "./listing";
import type { UserRow } from "./userTable";

function makeRow(index: number, overrides: Partial<UserRow> = {}): UserRow {
  return {
    deviceId: `device-${String(index)}`,
    userId: `user-${String(index).padStart(3, "0")}`,
    nickname: `nick${String(index)}`,
    gender: index % 2 === 0 ? "female" : "male",
    age: 18 + (index % 40),
    country: index % 3 === 0 ? "US" : "PH",
    bio: "",
    ip: "10.0.0.1",
    joinedAt: 1_000 + index,
    lastActiveAt: 1_000 + index,
    disconnectedAt: null,
    ...overrides,
  };
}

function makeRows(count: number): UserRow[] {
  return Array.from({ length: count }, (_, index) => makeRow(index));
}

function nth<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at ${String(index)}`);
  return item;
}

const nobody = { userId: "x", country: "ZZ", hidden: new Set<string>() };

describe("listUsers", () => {
  it("filters, excludes viewer/hidden/disconnected and paginates newest first", () => {
    const rows = makeRows(65);
    const p1 = listUsers(
      rows,
      { userId: nth(rows, 64).userId, country: "ZZ", hidden: new Set([nth(rows, 63).userId]) },
      {},
      null,
      30,
    );
    expect(p1.users).toHaveLength(30);
    expect(nth(p1.users, 0).userId).toBe(nth(rows, 62).userId);
    const p2 = listUsers(
      rows,
      { userId: nth(rows, 64).userId, country: "ZZ", hidden: new Set<string>() },
      {},
      p1.nextCursor,
      30,
    );
    expect(p2.users.some((u) => p1.users.some((v) => v.userId === u.userId))).toBe(false);
  });

  it("returns null cursor on last page", () => {
    expect(listUsers(makeRows(3), nobody, {}, null, 30).nextCursor).toBeNull();
  });

  it("returns null cursor when the page ends exactly on the last user", () => {
    const page = listUsers(makeRows(30), nobody, {}, null, 30);
    expect(page.users).toHaveLength(30);
    expect(page.nextCursor).toBeNull();
  });

  it("walks every visible user exactly once across pages", () => {
    const rows = makeRows(65);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = listUsers(rows, nobody, {}, cursor, 30);
      seen.push(...page.users.map((user) => user.userId));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(seen).toEqual(rows.map((row) => row.userId).reverse());
  });

  it("breaks joinedAt ties by userId without skipping or repeating", () => {
    const rows = ["user-b", "user-d", "user-a", "user-c"].map((userId, index) =>
      makeRow(index, { userId, joinedAt: 5_000 }),
    );
    const first = listUsers(rows, nobody, {}, null, 2);
    const second = listUsers(rows, nobody, {}, first.nextCursor, 2);
    expect([...first.users, ...second.users].map((user) => user.userId)).toEqual([
      "user-d",
      "user-c",
      "user-b",
      "user-a",
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it("excludes disconnected users", () => {
    const rows = [makeRow(1), makeRow(2, { disconnectedAt: 9_000 })];
    expect(listUsers(rows, nobody, {}, null, 30).users.map((user) => user.userId)).toEqual([
      nth(rows, 0).userId,
    ]);
  });

  it("applies gender, age and country filters", () => {
    const rows = [
      makeRow(1, { gender: "male", age: 25, country: "PH" }),
      makeRow(2, { gender: "male", age: 40, country: "PH" }),
      makeRow(3, { gender: "female", age: 25, country: "PH" }),
      makeRow(4, { gender: "male", age: 25, country: "US" }),
    ];
    const page = listUsers(
      rows,
      nobody,
      { genders: ["male"], minAge: 20, maxAge: 30, countries: ["PH"] },
      null,
      30,
    );
    expect(page.users.map((user) => user.userId)).toEqual([nth(rows, 0).userId]);
  });

  it("returns only public profile fields", () => {
    const user = nth(listUsers(makeRows(1), nobody, {}, null, 30).users, 0);
    expect(Object.keys(user).sort()).toEqual([
      "age",
      "bio",
      "country",
      "gender",
      "nickname",
      "userId",
    ]);
  });

  it("starts from the beginning on a malformed cursor", () => {
    const rows = makeRows(3);
    expect(listUsers(rows, nobody, {}, "garbage", 30).users).toHaveLength(3);
  });

  it("lists users from the viewer's country first, newest first inside each group", () => {
    const rows = [
      makeRow(1, { country: "PH" }),
      makeRow(2, { country: "US" }),
      makeRow(3, { country: "PH" }),
      makeRow(4, { country: "JP" }),
    ];
    const viewer = { userId: "x", country: "PH", hidden: new Set<string>() };
    const page = listUsers(rows, viewer, {}, null, 30);
    expect(page.users.map((user) => user.userId)).toEqual(
      [2, 0, 3, 1].map((index) => nth(rows, index).userId),
    );
  });

  it("pages across the country boundary returning every user exactly once", () => {
    const rows = makeRows(70);
    const viewer = { userId: "x", country: "US", hidden: new Set<string>() };
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = listUsers(rows, viewer, {}, cursor, 7);
      seen.push(...page.users.map((user) => user.userId));
      cursor = page.nextCursor;
    } while (cursor !== null);
    const newest = [...rows].reverse();
    const expected = [
      ...newest.filter((row) => row.country === "US"),
      ...newest.filter((row) => row.country !== "US"),
    ].map((row) => row.userId);
    expect(seen).toEqual(expected);
  });

  it("never shows hidden or blocked users on either side of the country boundary", () => {
    const rows = [
      makeRow(1, { country: "PH" }),
      makeRow(2, { country: "PH" }),
      makeRow(3, { country: "US" }),
      makeRow(4, { country: "US" }),
    ];
    const hidden = new Set([nth(rows, 0).userId, nth(rows, 3).userId]);
    const viewer = { userId: "x", country: "PH", hidden };
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = listUsers(rows, viewer, {}, cursor, 1);
      seen.push(...page.users.map((user) => user.userId));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(seen).toEqual([nth(rows, 1).userId, nth(rows, 2).userId]);
  });

  it("returns only other countries when filtering for one other country", () => {
    const rows = [makeRow(1, { country: "PH" }), makeRow(2, { country: "US" })];
    const viewer = { userId: "x", country: "PH", hidden: new Set<string>() };
    const page = listUsers(rows, viewer, { countries: ["US"] }, null, 30);
    expect(page.users.map((user) => user.userId)).toEqual([nth(rows, 1).userId]);
  });

  it("writes cursors with the group first", () => {
    const rows = makeRows(3).map((row) => ({ ...row, country: "PH" }));
    const viewer = { userId: "x", country: "PH", hidden: new Set<string>() };
    expect(listUsers(rows, viewer, {}, null, 1).nextCursor).toBe(`0:1002:${nth(rows, 2).userId}`);
  });

  it("restarts at page 1 on an old two-part cursor", () => {
    const rows = makeRows(5);
    const page = listUsers(rows, nobody, {}, `1002:${nth(rows, 2).userId}`, 30);
    expect(page.users).toHaveLength(5);
  });
});
