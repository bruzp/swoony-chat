import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { resetLobby, uniqueName } from "../test/helpers";
import { lobbyStub } from "./lobbyStub";
import { UserTable, type UserRow } from "./userTable";

beforeEach(resetLobby);

function row(overrides: Partial<UserRow> = {}): UserRow {
  return {
    deviceId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    nickname: uniqueName(),
    gender: "male",
    age: 30,
    country: "PH",
    bio: "",
    ip: "10.0.0.1",
    joinedAt: 1,
    lastActiveAt: 1,
    disconnectedAt: null,
    ...overrides,
  };
}

it("stores, finds, updates and deletes users", async () => {
  await runInDurableObject(lobbyStub(env), (_instance, state) => {
    const table = new UserTable(state.storage.sql);
    const user = row();
    table.insert(user);
    expect(table.byDevice(user.deviceId)).toEqual(user);
    expect(table.byUserId(user.userId)).toEqual(user);

    const renamed = uniqueName("Re");
    table.update(user.deviceId, { bio: "hi", disconnectedAt: 5, nickname: renamed });
    expect(table.byDevice(user.deviceId)).toMatchObject({
      bio: "hi",
      disconnectedAt: 5,
      nickname: renamed,
    });
    expect(table.nicknameTaken(renamed.toLowerCase())).toBe(true);
    expect(table.nicknameTaken(user.nickname.toLowerCase())).toBe(false);

    table.delete(user.deviceId);
    expect(table.byDevice(user.deviceId)).toBeNull();
    expect(table.all()).toEqual([]);
  });
});

it("ignores fields that are not columns", async () => {
  await runInDurableObject(lobbyStub(env), (_instance, state) => {
    const table = new UserTable(state.storage.sql);
    const user = row();
    table.insert(user);
    table.update(user.deviceId, { deviceId: "other" });
    expect(table.byDevice(user.deviceId)).toEqual(user);
  });
});

it("hides users blocked in either direction", async () => {
  await runInDurableObject(lobbyStub(env), (_instance, state) => {
    const table = new UserTable(state.storage.sql);
    state.storage.sql.exec(
      "INSERT INTO blocks (blocker, blocked) VALUES ('me', 'they-blocked'), ('blocked-me', 'me'), ('x', 'y')",
    );
    expect(table.hiddenFor("me")).toEqual(new Set(["they-blocked", "blocked-me"]));
    expect(table.hiddenFor("nobody")).toEqual(new Set());
  });
});

it("records a block only while the blocker is still a user", async () => {
  await runInDurableObject(lobbyStub(env), (_instance, state) => {
    const table = new UserTable(state.storage.sql);
    const blocker = row();
    table.insert(blocker);
    table.insertBlock(blocker.userId, "someone");
    table.insertBlock(blocker.userId, "someone");
    table.insertBlock("departed", "someone");
    expect(table.hiddenFor("someone")).toEqual(new Set([blocker.userId]));
  });
});

it("finds a user's chats and who blocked them through indexes", async () => {
  await runInDurableObject(lobbyStub(env), (_instance, state) => {
    const plan = (sql: string) =>
      state.storage.sql
        .exec<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`)
        .toArray()
        .map((step) => step.detail)
        .join(" | ");
    expect(plan("SELECT * FROM blocks WHERE blocked = 'u'")).toContain("blocks_blocked");
    const chats = plan("SELECT * FROM chats WHERE user_a = 'u' OR user_b = 'u'");
    expect(chats).toContain("chats_user_a");
    expect(chats).toContain("chats_user_b");
  });
});

it("maps every block to both people involved", async () => {
  await runInDurableObject(lobbyStub(env), (_instance, state) => {
    const table = new UserTable(state.storage.sql);
    for (const userId of ["a", "b", "c"]) table.insert(row({ userId }));
    table.insertBlock("a", "b");
    table.insertBlock("c", "a");
    const hidden = table.hiddenByUser();
    expect(hidden.get("a")).toEqual(new Set(["b", "c"]));
    expect(hidden.get("b")).toEqual(new Set(["a"]));
    expect(hidden.get("c")).toEqual(new Set(["a"]));
  });
});

it("pages online users in SQL: own country first, newest first, filtered, after a cursor", async () => {
  await runInDurableObject(lobbyStub(env), (_instance, state) => {
    const table = new UserTable(state.storage.sql);
    const me = row({ userId: "me", country: "PH", joinedAt: 50 });
    const users = [
      me,
      row({ userId: "ph-old", country: "PH", joinedAt: 10 }),
      row({ userId: "ph-new", country: "PH", joinedAt: 30 }),
      row({ userId: "us-new", country: "US", joinedAt: 40 }),
      row({ userId: "us-old", country: "US", joinedAt: 20, gender: "female" }),
      row({ userId: "gone", country: "PH", joinedAt: 45, disconnectedAt: 46 }),
      row({ userId: "blocked", country: "PH", joinedAt: 44 }),
      row({ userId: "teen-ish", country: "PH", joinedAt: 43, age: 19 }),
    ];
    for (const user of users) table.insert(user);
    table.insertBlock("blocked", "me");
    const ids = (rows: UserRow[]) => rows.map((user) => user.userId);
    const viewer = { userId: "me", country: "PH" };

    expect(ids(table.listPage(viewer, { minAge: 20 }, null, 10))).toEqual([
      "ph-new",
      "ph-old",
      "us-new",
      "us-old",
    ]);
    expect(ids(table.listPage(viewer, { minAge: 20 }, null, 2))).toEqual(["ph-new", "ph-old"]);
    expect(
      ids(table.listPage(viewer, {}, { group: 0, joinedAt: 30, userId: "ph-new" }, 10)),
    ).toEqual(["ph-old", "us-new", "us-old"]);
    expect(
      ids(table.listPage(viewer, { genders: ["female"], countries: ["US"] }, null, 10)),
    ).toEqual(["us-old"]);
  });
});
