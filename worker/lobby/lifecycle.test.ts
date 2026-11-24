import { LIMITS } from "@shared/config";
import { KICKED_CLOSE_CODE, LEFT_CLOSE_CODE } from "@shared/protocol/lobby";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RetentionStore } from "../retention/RetentionStore";
import {
  advanceLobbyClock,
  enter,
  fireLobbyAlarm,
  hibernateLobby,
  lobbySession,
  lobbyUserCount,
  openLobby,
  resetLobby,
  simulateLobbyRestart,
} from "../test/helpers";
import { lobbyStub } from "./lobbyStub";
import { UserTable } from "./userTable";

beforeEach(resetLobby);
afterEach(() => {
  vi.restoreAllMocks();
});

const PAST_GRACE = LIMITS.leaveGraceMs + 1_000;
const PAST_IDLE = LIMITS.idleKickMs + 1;

async function inLobby() {
  const user = await enter();
  const ws = await openLobby(user.cookie);
  await ws.next("hello");
  return { ...user, ws };
}

function tableCount(table: "blocks" | "chats" | "contacts" | "users"): Promise<number> {
  return runInDurableObject(
    lobbyStub(env),
    (_instance, state) =>
      state.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).one().n,
  );
}

async function seedRelations(userId: string, otherId: string): Promise<void> {
  await runInDurableObject(lobbyStub(env), (_instance, state) => {
    const sql = state.storage.sql;
    sql.exec("INSERT INTO blocks (blocker, blocked) VALUES (?, ?)", userId, "someone");
    sql.exec("INSERT INTO blocks (blocker, blocked) VALUES (?, ?)", "someone", userId);
    sql.exec(
      "INSERT INTO chats (chat_id, user_a, user_b, created_at) VALUES (?, ?, ?, 0)",
      "chat-1",
      userId,
      otherId,
    );
    sql.exec(
      "INSERT INTO chats (chat_id, user_a, user_b, created_at) VALUES (?, ?, ?, 0)",
      "chat-2",
      otherId,
      userId,
    );
    sql.exec(
      "INSERT INTO contacts (owner, other, other_device_hash, other_network_hash) VALUES (?, ?, 'd', 'n')",
      userId,
      otherId,
    );
  });
}

async function leftAt(userId: string): Promise<number | null> {
  const row = await env.DB.prepare("SELECT left_at FROM connection_log WHERE user_id = ?")
    .bind(userId)
    .first<{ left_at: number | null }>();
  return row?.left_at ?? null;
}

it("closing one of two sockets keeps the user online", async () => {
  const a = await enter();
  const first = await openLobby(a.cookie);
  await first.next("hello");
  const second = await openLobby(a.cookie);
  await second.next("hello");
  await first.close();
  await advanceLobbyClock(PAST_GRACE);
  await fireLobbyAlarm();
  expect(await lobbySession(a.cookie)).not.toBeNull();
});

it("keeps user through a reconnect inside grace", async () => {
  const a = await enter();
  const s = await openLobby(a.cookie);
  await s.next("hello");
  await s.close();
  await advanceLobbyClock(59_000);
  await fireLobbyAlarm();
  expect((await (await openLobby(a.cookie)).next("hello")).me.userId).toBe(a.me.userId);
});

it("a reconnect inside grace clears the pending removal", async () => {
  const a = await enter();
  const s = await openLobby(a.cookie);
  await s.next("hello");
  await s.close();
  await advanceLobbyClock(30_000);
  await (await openLobby(a.cookie)).next("hello");
  await advanceLobbyClock(PAST_GRACE);
  await fireLobbyAlarm();
  expect(await lobbySession(a.cookie)).not.toBeNull();
});

it("removes user 60s after last socket closes and wipes their rows", async () => {
  const a = await enter();
  const s = await openLobby(a.cookie);
  await s.next("hello");
  await s.close();
  await advanceLobbyClock(61_000);
  await fireLobbyAlarm();
  expect(await lobbySession(a.cookie)).toBeNull();
  expect(await lobbyUserCount()).toBe(0);
});

it("a user who entered but never opened a socket is removed after grace", async () => {
  const a = await enter();
  await fireLobbyAlarm();
  await advanceLobbyClock(PAST_GRACE);
  await fireLobbyAlarm();
  expect(await lobbySession(a.cookie)).toBeNull();
});

it("removal wipes blocks both ways, chats and contacts the user owns", async () => {
  const a = await inLobby();
  const b = await inLobby();
  await seedRelations(a.me.userId, b.me.userId);
  a.ws.send({ type: "leave" });
  await a.ws.closed;
  expect(await tableCount("blocks")).toBe(0);
  expect(await tableCount("chats")).toBe(0);
  expect(await tableCount("contacts")).toBe(0);
  expect(await tableCount("users")).toBe(1);
});

it("removal records the disconnect time in the legal connection log", async () => {
  const a = await inLobby();
  expect(await leftAt(a.me.userId)).toBeNull();
  a.ws.send({ type: "leave" });
  await a.ws.closed;
  expect(await leftAt(a.me.userId)).toEqual(expect.any(Number));
});

it("orphan users without sockets are removed after a restart", async () => {
  const a = await enter();
  await (await openLobby(a.cookie)).next("hello");
  await simulateLobbyRestart();
  await fireLobbyAlarm();
  await advanceLobbyClock(61_000);
  await fireLobbyAlarm();
  expect(await lobbySession(a.cookie)).toBeNull();
});

it("treats a socket that stops pinging as gone and removes the user after grace", async () => {
  const a = await inLobby();
  await advanceLobbyClock(LIMITS.socketSilenceMs + 1_000);
  await fireLobbyAlarm();
  await a.ws.closed;
  await advanceLobbyClock(PAST_GRACE);
  await fireLobbyAlarm();
  expect(await lobbySession(a.cookie)).toBeNull();
});

it("also drops a silent socket opened before sockets recorded when they opened", async () => {
  const a = await inLobby();
  await runInDurableObject(lobbyStub(env), (_instance, state) => {
    for (const socket of state.getWebSockets()) {
      const legacy = { ...(socket.deserializeAttachment() as Record<string, unknown>) };
      delete legacy.openedAt;
      socket.serializeAttachment(legacy);
    }
  });
  await advanceLobbyClock(LIMITS.socketSilenceMs + 1_000);
  await fireLobbyAlarm();
  await a.ws.closed;
});

it("drops a silent socket even when the lobby just woke from hibernation", async () => {
  const a = await inLobby();
  await runInDurableObject(lobbyStub(env), (_instance, state) => {
    for (const socket of state.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as Record<string, unknown>;
      socket.serializeAttachment({
        ...attachment,
        openedAt: Date.now() - LIMITS.socketSilenceMs - 1_000,
      });
    }
  });
  await hibernateLobby();
  await fireLobbyAlarm();
  await a.ws.closed;
});

it("removes a user who is both gone and idle only once", async () => {
  const a = await inLobby();
  await a.ws.close();
  await advanceLobbyClock(PAST_IDLE);
  const logged = vi.spyOn(RetentionStore.prototype, "logDisconnect");
  await fireLobbyAlarm();
  const removed = logged.mock.calls.flatMap(([userIds]) => userIds);
  expect(removed).toEqual([a.me.userId]);
});

it("records activity at most every 30 seconds instead of on every frame", async () => {
  const a = await inLobby();
  await advanceLobbyClock(60_000);
  const touch = vi.spyOn(UserTable.prototype, "touch");
  for (let i = 0; i < 3; i++) {
    a.ws.send({ type: "openChat", userId: "nobody" });
    await a.ws.next("error");
  }
  expect(touch).toHaveBeenCalledTimes(1);
});

it("keeps a user whose socket keeps pinging", async () => {
  const a = await inLobby();
  for (let i = 0; i < 4; i++) {
    await advanceLobbyClock(LIMITS.socketSilenceMs - 10_000);
    await a.ws.ping();
    await fireLobbyAlarm();
  }
  expect(await lobbySession(a.cookie)).not.toBeNull();
});

it("kicks after 30 minutes idle even while the tab keeps pinging", async () => {
  const a = await inLobby();
  await advanceLobbyClock(PAST_IDLE);
  await a.ws.ping();
  await fireLobbyAlarm();
  expect(await a.ws.next("kicked")).toEqual({ type: "kicked", reason: "idle" });
  expect((await a.ws.closed).code).toBe(KICKED_CLOSE_CODE);
  expect(await lobbySession(a.cookie)).toBeNull();
});

it("loading a later page of the list counts as activity", async () => {
  const a = await inLobby();
  await advanceLobbyClock(LIMITS.idleKickMs - 60_000);
  a.ws.send({ type: "list", requestId: "r1", filter: {}, cursor: "1:0:someone" });
  await a.ws.next("page");
  await advanceLobbyClock(120_000);
  await fireLobbyAlarm();
  expect(await lobbySession(a.cookie)).not.toBeNull();
});

it("reloading the first page of the list does not count as activity", async () => {
  const a = await inLobby();
  await advanceLobbyClock(LIMITS.idleKickMs - 60_000);
  a.ws.send({ type: "list", requestId: "r1", filter: {} });
  await a.ws.next("page");
  await advanceLobbyClock(120_000);
  await a.ws.ping();
  await fireLobbyAlarm();
  expect(await a.ws.next("kicked")).toEqual({ type: "kicked", reason: "idle" });
});

it("touch counts as activity", async () => {
  const a = await inLobby();
  await advanceLobbyClock(LIMITS.idleKickMs - 60_000);
  await lobbyStub(env).touch(a.me.userId, Date.now() + LIMITS.idleKickMs - 60_000);
  await advanceLobbyClock(120_000);
  await fireLobbyAlarm();
  expect(await lobbySession(a.cookie)).not.toBeNull();
});

it("leave removes immediately and others see left", async () => {
  const a = await inLobby();
  const b = await inLobby();
  await a.ws.next("presence");
  b.ws.send({ type: "leave" });
  expect((await b.ws.closed).code).toBe(LEFT_CLOSE_CODE);
  expect(await lobbySession(b.cookie)).toBeNull();
  const presence = await a.ws.nextWhere("presence", (message) => message.left.length > 0);
  expect(presence.left).toContain(b.me.userId);
  expect(presence.online).toBe(0);
});

it("leave closes every tab of that user", async () => {
  const a = await enter();
  const first = await openLobby(a.cookie);
  await first.next("hello");
  const second = await openLobby(a.cookie);
  await second.next("hello");
  first.send({ type: "leave" });
  expect((await second.closed).code).toBe(LEFT_CLOSE_CODE);
});

it("others see left when a user is removed after grace", async () => {
  const a = await inLobby();
  const b = await inLobby();
  await a.ws.next("presence");
  await b.ws.close();
  await advanceLobbyClock(PAST_GRACE);
  await fireLobbyAlarm();
  const presence = await a.ws.nextWhere("presence", (message) => message.left.length > 0);
  expect(presence.left).toEqual([b.me.userId]);
});

it("keeps the cleanup alarm scheduled only while users exist", async () => {
  const a = await inLobby();
  expect(await fireLobbyAlarm()).toBe(true);
  expect(await fireLobbyAlarm()).toBe(true);
  a.ws.send({ type: "leave" });
  await a.ws.closed;
  await fireLobbyAlarm();
  expect(await fireLobbyAlarm()).toBe(false);
});

it("the alarm prunes expired entry rate events", async () => {
  await inLobby();
  await advanceLobbyClock(LIMITS.entriesPerDevice.windowMs + 1);
  await fireLobbyAlarm();
  const rows = await runInDurableObject(
    lobbyStub(env),
    (_instance, state) =>
      state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM rate_events").one().n,
  );
  expect(rows).toBe(0);
});

it("a session re-entered while the sweep waits on the legal log survives", async () => {
  const w = await enter();
  const x = await enter();
  await fireLobbyAlarm();
  await advanceLobbyClock(PAST_GRACE);
  const resolvers: Array<() => void> = [];
  const gate = new Promise<void>((resolve) => resolvers.push(resolve));
  const release = () => {
    for (const resolve of resolvers) resolve();
  };
  vi.spyOn(RetentionStore.prototype, "logDisconnect").mockImplementation(() => gate);
  const sweep = fireLobbyAlarm();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const again = await enter({}, { cookie: x.cookie });
  release();
  await sweep;
  expect(await lobbySession(w.cookie)).toBeNull();
  expect(await lobbySession(x.cookie)).toEqual(again.me);
});

it("removal still wipes and keeps the alarm when the legal log fails", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(RetentionStore.prototype, "logDisconnect").mockRejectedValue(new Error("d1 down"));
  const a = await inLobby();
  await inLobby();
  a.ws.send({ type: "leave" });
  await a.ws.closed;
  expect(await lobbySession(a.cookie)).toBeNull();
  expect(error).toHaveBeenCalledWith("disconnect_log_failed");
  expect(await fireLobbyAlarm()).toBe(true);
});

it("a late close from a previous session does not disconnect a re-entered user", async () => {
  const a = await inLobby();
  a.ws.send({ type: "leave" });
  const again = await enter({}, { cookie: a.cookie });
  const ws = await openLobby(again.cookie);
  await ws.next("hello");
  await a.ws.closed;
  await advanceLobbyClock(PAST_GRACE);
  await fireLobbyAlarm();
  expect(await lobbySession(a.cookie)).toEqual(again.me);
});

it("keeps contacts where the removed user is the other side", async () => {
  const a = await inLobby();
  const b = await inLobby();
  await runInDurableObject(lobbyStub(env), (_instance, state) => {
    state.storage.sql.exec(
      "INSERT INTO contacts (owner, other, other_device_hash, other_network_hash) VALUES (?, ?, 'd', 'n')",
      b.me.userId,
      a.me.userId,
    );
  });
  a.ws.send({ type: "leave" });
  await a.ws.closed;
  expect(await tableCount("contacts")).toBe(1);
});
