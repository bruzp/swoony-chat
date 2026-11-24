import { LIMITS } from "@shared/config";
import { COUNTRY_CODES } from "@shared/countries";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { enter, openLobby, resetLobby, type TestSocket } from "../test/helpers";
import { lobbyStub } from "./lobbyStub";

beforeEach(resetLobby);

const PUBLIC_FIELDS = ["age", "bio", "country", "gender", "nickname", "userId"];

async function inLobby(profile: Parameters<typeof enter>[0] = {}) {
  const user = await enter(profile);
  const ws = await openLobby(user.cookie);
  await ws.next("hello");
  return { ...user, ws };
}

async function insertBlock(blocker: string, blocked: string): Promise<void> {
  await runInDurableObject(lobbyStub(env), (_instance, state) => {
    state.storage.sql.exec("INSERT INTO blocks (blocker, blocked) VALUES (?, ?)", blocker, blocked);
  });
}

async function listIds(ws: TestSocket, requestId: string, filter: object = {}) {
  ws.send({ type: "list", requestId, filter });
  const page = await ws.nextWhere("page", (message) => message.requestId === requestId);
  return page.users.map((user) => user.userId);
}

it("new user appears in others' presence and filtered list", async () => {
  const a = await enter();
  const wa = await openLobby(a.cookie);
  await wa.next("hello");
  const b = await enter({ gender: "male" });
  const wb = await openLobby(b.cookie);
  await wb.next("hello");
  expect((await wa.next("presence")).joined.map((u) => u.userId)).toContain(b.me.userId);
  wa.send({ type: "list", requestId: "r1", filter: { genders: ["male"] } });
  expect((await wa.next("page")).users.map((u) => u.userId)).toEqual([b.me.userId]);
});

it("batches several joins into one presence message", async () => {
  const a = await inLobby();
  const joined = [await enter(), await enter(), await enter()].map((user) => user.me.userId);
  const presence = await a.ws.next("presence");
  expect(presence.joined.map((user) => user.userId).sort()).toEqual([...joined].sort());
  expect(presence.online).toBe(3);
  await a.ws.expectNone("presence", LIMITS.presenceBatchMs + 300);
});

it("presence carries only public profile fields", async () => {
  const a = await inLobby();
  await enter({ bio: "hello" });
  const { joined } = await a.ws.next("presence");
  expect(joined).toHaveLength(1);
  expect(Object.keys(joined[0] ?? {}).sort()).toEqual(PUBLIC_FIELDS);
});

it("does not announce a user's own join to them", async () => {
  const a = await inLobby();
  const b = await inLobby();
  const presence = await b.ws.next("presence").catch(() => null);
  expect(presence?.joined.map((user) => user.userId) ?? []).not.toContain(b.me.userId);
  expect((await a.ws.next("presence")).joined.map((user) => user.userId)).toEqual([b.me.userId]);
});

it("setBio rejects links and broadcasts accepted bio", async () => {
  const a = await inLobby();
  const b = await inLobby();
  await a.ws.next("presence");

  b.ws.send({ type: "setBio", bio: "visit example.com" });
  expect(await b.ws.next("bioRejected")).toEqual({ type: "bioRejected", reason: "link" });

  b.ws.send({ type: "setBio", bio: "  hi there  " });
  const presence = await a.ws.next("presence");
  expect(presence.updated).toEqual([{ ...b.me, bio: "hi there" }]);
  expect(presence.joined).toEqual([]);
});

it("rejected bio leaves the stored bio unchanged", async () => {
  const a = await inLobby();
  const b = await inLobby({ bio: "original" });
  b.ws.send({ type: "setBio", bio: "add me on ig" });
  expect((await b.ws.next("bioRejected")).reason).toBe("contact");
  a.ws.send({ type: "list", requestId: "r", filter: {} });
  expect((await a.ws.next("page")).users[0]?.bio).toBe("original");
});

it("setBio with only whitespace clears the bio", async () => {
  const a = await inLobby();
  const b = await inLobby({ bio: "something" });
  await a.ws.next("presence");
  b.ws.send({ type: "setBio", bio: "   " });
  expect((await a.ws.next("presence")).updated).toEqual([{ ...b.me, bio: "" }]);
});

it("sends a user's own bio update to their other tabs", async () => {
  const a = await inLobby();
  const secondTab = await openLobby(a.cookie);
  await secondTab.next("hello");
  a.ws.send({ type: "setBio", bio: "new bio" });
  expect((await secondTab.next("presence")).updated).toEqual([{ ...a.me, bio: "new bio" }]);
});

it("merges a join and a bio change in one batch into the latest join", async () => {
  const a = await inLobby();
  const b = await enter();
  const wb = await openLobby(b.cookie);
  await wb.next("hello");
  wb.send({ type: "setBio", bio: "fresh" });
  const presence = await a.ws.next("presence");
  expect(presence.joined).toEqual([{ ...b.me, bio: "fresh" }]);
  expect(presence.updated).toEqual([]);
});

it("pages the list with cursor, online count and echoed requestId", async () => {
  const a = await inLobby();
  for (let index = 0; index < LIMITS.listPageSize + 2; index++) await enter();
  a.ws.send({ type: "list", requestId: "first", filter: {} });
  const first = await a.ws.next("page");
  expect(first.requestId).toBe("first");
  expect(first.users).toHaveLength(LIMITS.listPageSize);
  expect(first.online).toBe(LIMITS.listPageSize + 2);
  expect(first.nextCursor).not.toBeNull();
  a.ws.send({ type: "list", requestId: "second", filter: {}, cursor: first.nextCursor });
  const second = await a.ws.next("page");
  expect(second.users).toHaveLength(2);
  expect(second.nextCursor).toBeNull();
});

it("does not count people in the leave grace period as online", async () => {
  const a = await inLobby();
  const b = await inLobby();
  await b.ws.close();
  a.ws.send({ type: "list", requestId: "after-leave", filter: {} });
  const page = await a.ws.next("page");
  expect(page.users).toEqual([]);
  expect(page.online).toBe(0);
});

it("hides blocked users from the list and presence in both directions", async () => {
  const a = await inLobby();
  const b = await inLobby();
  const c = await inLobby();
  await insertBlock(a.me.userId, c.me.userId);
  await a.ws.next("presence");
  await c.ws.next("presence").catch(() => null);

  expect(await listIds(a.ws, "a")).toEqual([b.me.userId]);
  expect(await listIds(c.ws, "c")).toEqual([b.me.userId]);

  c.ws.send({ type: "setBio", bio: "from c" });
  b.ws.send({ type: "setBio", bio: "from b" });
  const seenByA = await a.ws.nextWhere("presence", (message) => message.updated.length > 0);
  expect(seenByA.updated.map((user) => user.userId)).toEqual([b.me.userId]);
  const seenByC = await c.ws.nextWhere("presence", (message) =>
    message.updated.some((user) => user.userId === b.me.userId),
  );
  expect(seenByC.updated.map((user) => user.userId).sort()).toEqual(
    [c.me.userId, b.me.userId].sort(),
  );
});

it("counts only the people each viewer can see as online", async () => {
  const a = await inLobby();
  const b = await inLobby();
  const c = await inLobby();
  await a.ws.next("presence");
  await insertBlock(a.me.userId, c.me.userId);
  a.ws.send({ type: "list", requestId: "a", filter: {} });
  expect((await a.ws.next("page")).online).toBe(1);
  b.ws.send({ type: "list", requestId: "b", filter: {} });
  expect((await b.ws.next("page")).online).toBe(2);
  c.ws.send({ type: "list", requestId: "c", filter: {} });
  expect((await c.ws.next("page")).online).toBe(1);

  const d = await enter();
  const joinedD = (m: { joined: { userId: string }[] }) =>
    m.joined.some((user) => user.userId === d.me.userId);
  expect((await a.ws.nextWhere("presence", joinedD)).online).toBe(2);
  expect((await b.ws.nextWhere("presence", joinedD)).online).toBe(3);
  expect((await c.ws.nextWhere("presence", joinedD)).online).toBe(2);
});

it("does not discount a block against someone who has gone offline", async () => {
  const a = await inLobby();
  const b = await inLobby();
  await inLobby();
  await a.ws.next("presence");
  await insertBlock(a.me.userId, b.me.userId);
  await b.ws.close();
  const d = await enter();
  const presence = await a.ws.nextWhere("presence", (m) =>
    m.joined.some((user) => user.userId === d.me.userId),
  );
  expect(presence.online).toBe(2);
});

it("skips presence entirely when every change is hidden from the recipient", async () => {
  const a = await inLobby();
  const b = await inLobby();
  await a.ws.next("presence");
  await insertBlock(b.me.userId, a.me.userId);
  b.ws.send({ type: "setBio", bio: "secret" });
  await a.ws.expectNone("presence", LIMITS.presenceBatchMs + 300);
});

it("malformed message yields bad_message error", async () => {
  const a = await inLobby();
  a.ws.sendRaw("{not json");
  expect(await a.ws.next("error")).toEqual({ type: "error", code: "bad_message" });
});

it.each([
  ["unknown type", { type: "launch" }],
  ["missing requestId", { type: "list", filter: {} }],
  ["filter age below 18", { type: "list", requestId: "r", filter: { minAge: 10 } }],
  ["unknown country", { type: "list", requestId: "r", filter: { countries: ["ZZ"] } }],
  ["malformed cursor", { type: "list", requestId: "r", filter: {}, cursor: "garbage" }],
  ["overlong requestId", { type: "list", requestId: "r".repeat(65), filter: {} }],
  ["bio not a string", { type: "setBio", bio: 42 }],
  ["json array", []],
  ["json null", null],
])("rejects %s with bad_message and keeps serving", async (_name, payload) => {
  const a = await inLobby();
  a.ws.sendRaw(JSON.stringify(payload));
  expect(await a.ws.next("error")).toEqual({ type: "error", code: "bad_message" });
  expect(await listIds(a.ws, "after")).toEqual([]);
});

it("limits list requests per user across all of their tabs", async () => {
  const a = await inLobby();
  const secondTab = await openLobby(a.cookie);
  await secondTab.next("hello");
  const perUser = LIMITS.listRequestsPerUser.count;
  for (let index = 0; index < perUser; index++) {
    (index % 2 === 0 ? a.ws : secondTab).send({
      type: "list",
      requestId: `r${String(index)}`,
      filter: {},
    });
  }
  secondTab.send({ type: "list", requestId: "over", filter: {} });
  expect(await secondTab.next("notice")).toEqual({ type: "notice", code: "slow_down" });
  expect(
    await secondTab.nextWhere("page", (page) => page.requestId === "over", 300).catch(() => null),
  ).toBeNull();
});

it("rejects filters with more genders or countries than exist", async () => {
  const a = await inLobby();
  a.ws.send({
    type: "list",
    requestId: "g",
    filter: { genders: ["male", "female", "other", "male"] },
  });
  expect(await a.ws.next("error")).toEqual({ type: "error", code: "bad_message" });
  a.ws.send({
    type: "list",
    requestId: "c",
    filter: { countries: Array.from({ length: COUNTRY_CODES.length + 1 }, () => "PH") },
  });
  expect(await a.ws.next("error")).toEqual({ type: "error", code: "bad_message" });
});

it("keeps delivering a presence batch when one socket fails to send", async () => {
  const brokenBefore = await inLobby();
  const healthy = await inLobby();
  const brokenAfter = await inLobby();
  await healthy.ws.nextWhere("presence", (message) =>
    message.joined.some((user) => user.userId === brokenAfter.me.userId),
  );
  await runInDurableObject(lobbyStub(env), (_instance, state) => {
    const brokenSockets = [brokenBefore, brokenAfter].flatMap((user) =>
      state.getWebSockets(user.me.userId),
    );
    for (const socket of brokenSockets) {
      socket.send = () => {
        throw new Error("socket closing");
      };
    }
  });
  const newcomer = await enter();
  const presence = await healthy.ws.nextWhere("presence", (message) =>
    message.joined.some((user) => user.userId === newcomer.me.userId),
  );
  expect(presence.joined.map((user) => user.userId)).toEqual([newcomer.me.userId]);
});
