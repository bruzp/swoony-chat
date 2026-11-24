import { LIMITS } from "@shared/config";
import { CHAT_ENDED_CLOSE_CODE } from "@shared/protocol/chat";
import { REPLACED_CLOSE_CODE } from "@shared/protocol/lobby";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, expect, it, vi } from "vitest";
import { lobbyStub } from "../lobby/lobbyStub";
import { UserTable } from "../lobby/userTable";
import { IdentityHasher } from "../moderation/identityHash";
import {
  advanceChatClock,
  chatMessageCount,
  chatUpgrade,
  deps,
  deviceIdFrom,
  enter,
  fireChatAlarm,
  inLobby,
  openChat,
  openLobby,
  openPairChat,
  rawUpgrade,
  resetLobby,
  twoUsersInLobby,
} from "../test/helpers";
import { ChatRoom } from "./ChatRoom";
import { chatIdFor } from "./chatId";

beforeEach(resetLobby);

const PHONE_NUMBER = "call me 0917 123 4567";
const FAR_FUTURE = 8_640_000_000_000_000;

it("derives the chat id from the sorted pair of user ids", async () => {
  const forward = await chatIdFor("user-a", "user-b");
  expect(forward).toMatch(/^[0-9a-f]{64}$/);
  expect(await chatIdFor("user-b", "user-a")).toBe(forward);
  expect(await chatIdFor("user-a", "user-c")).not.toBe(forward);
});

it("opens a chat and relays a message to the peer via incomingChat", async () => {
  const { a, b, wa, wb } = await twoUsersInLobby();
  wa.send({ type: "openChat", userId: b.me.userId });
  const opened = await wa.next("chatOpened");
  expect(opened.peer.userId).toBe(b.me.userId);
  const ca = await openChat(a.cookie, opened.chatId);
  ca.send({ type: "send", clientId: "c1", text: "hey!" });
  const sent = await ca.next("message");
  expect(sent.clientId).toBe("c1");
  expect(sent.from).toBe(a.me.userId);
  const incoming = await wb.next("incomingChat");
  expect(incoming.chatId).toBe(opened.chatId);
  expect(incoming.from.userId).toBe(a.me.userId);
  const cb = await openChat(b.cookie, incoming.chatId);
  cb.send({ type: "resume", afterSeq: 0 });
  expect((await cb.next("history")).messages.map((m) => m.text)).toEqual(["hey!"]);
});

it("tells a peer who has not opened the chat about it once, not on every message", async () => {
  const { a, b, wa, wb } = await twoUsersInLobby();
  wa.send({ type: "openChat", userId: b.me.userId });
  const ca = await openChat(a.cookie, (await wa.next("chatOpened")).chatId);
  for (const [i, text] of ["hey", "you there", "hello again"].entries()) {
    ca.send({ type: "send", clientId: `c${String(i)}`, text });
    await ca.next("message");
  }
  await wb.next("incomingChat");
  await wb.expectNone("incomingChat");
});

it("delivers a message to the peer's open socket without the sender's clientId", async () => {
  const { a, ca, cb, wb } = await openPairChat();
  ca.send({ type: "send", clientId: "c1", text: "hello there" });
  const received = await cb.next("message");
  expect(received).toMatchObject({ from: a.me.userId, text: "hello there" });
  expect(received.clientId).toBeUndefined();
  await wb.expectNone("incomingChat");
});

it("cannot open a chat with yourself or an unknown user", async () => {
  const user = await inLobby();
  user.ws.send({ type: "openChat", userId: user.me.userId });
  expect((await user.ws.next("error")).code).toBe("user_unavailable");
  user.ws.send({ type: "openChat", userId: "nobody" });
  expect((await user.ws.next("error")).code).toBe("user_unavailable");
});

it("hello lists open chats after reconnect", async () => {
  const { a, b, chatId } = await openPairChat();
  const again = await openLobby(a.cookie);
  const hello = await again.next("hello");
  expect(hello.chats).toEqual([{ chatId, peer: b.me }]);
  const peerHello = await (await openLobby(b.cookie)).next("hello");
  expect(peerHello.chats.map((chat) => chat.chatId)).toEqual([chatId]);
});

it("opening the same chat twice returns the same chat", async () => {
  const { b, wa, chatId } = await openPairChat();
  wa.send({ type: "openChat", userId: b.me.userId });
  expect((await wa.next("chatOpened")).chatId).toBe(chatId);
});

it("reopening an existing chat does not hash anyone's ids again", async () => {
  const { b, wa, chatId } = await openPairChat();
  const hash = vi.spyOn(IdentityHasher.prototype, "hash");
  try {
    wa.send({ type: "openChat", userId: b.me.userId });
    expect((await wa.next("chatOpened")).chatId).toBe(chatId);
    expect(hash).not.toHaveBeenCalled();
  } finally {
    hash.mockRestore();
  }
});

it("does not recreate a chat when the peer blocks while it is being reopened", async () => {
  const { a, b, wa, chatId } = await openPairChat();
  const start = vi.spyOn(ChatRoom.prototype, "start").mockImplementation(async () => {
    await lobbyStub(env).chatClosed(chatId);
  });
  const users = await runInDurableObject(
    lobbyStub(env),
    (_instance, state) => new UserTable(state.storage.sql),
  );
  const hash = vi.spyOn(IdentityHasher.prototype, "hash").mockImplementationOnce(function (
    this: IdentityHasher,
    value: string,
  ) {
    users.insertBlock(b.me.userId, a.me.userId);
    hash.mockRestore();
    return this.hash(value);
  });
  try {
    wa.send({ type: "openChat", userId: b.me.userId });
    expect((await wa.next("error")).code).toBe("user_unavailable");
    const rows = await runInDurableObject(lobbyStub(env), (_instance, state) =>
      state.storage.sql.exec("SELECT 1 FROM chats WHERE chat_id = ?", chatId).toArray(),
    );
    expect(rows).toEqual([]);
  } finally {
    start.mockRestore();
    hash.mockRestore();
  }
});

it("3 contact-detail rejections in 10 minutes count as a strike", async () => {
  const { ca, wa } = await openPairChat();
  for (const clientId of ["p1", "p2"]) {
    ca.send({ type: "send", clientId, text: PHONE_NUMBER });
    expect(await ca.next("rejected")).toMatchObject({ clientId, reason: "contact" });
  }
  await wa.expectNone("notice");
  ca.send({ type: "send", clientId: "p3", text: PHONE_NUMBER });
  expect(await ca.next("rejected")).toMatchObject({ clientId: "p3", reason: "contact" });
  expect((await wa.next("notice")).code).toBe("slow_down");
});

it("rejects links without a strike and the 6th message within 5s with slow_down", async () => {
  const { ca, cb, wa } = await openPairChat();
  ca.send({ type: "send", clientId: "l1", text: "see example.com" });
  expect(await ca.next("rejected")).toMatchObject({ clientId: "l1", reason: "link" });
  await wa.expectNone("notice");
  for (const n of [2, 3, 4, 5]) ca.send({ type: "send", clientId: `m${String(n)}`, text: "hi" });
  for (let i = 0; i < 4; i++) await cb.next("message");
  ca.send({ type: "send", clientId: "m6", text: "hi" });
  expect(await ca.next("rejected")).toMatchObject({ clientId: "m6", reason: "slow_down" });
  expect((await wa.next("notice")).code).toBe("slow_down");
});

it("rejects malformed frames silently and keeps the socket open", async () => {
  const { ca, cb } = await openPairChat();
  ca.sendRaw("not json");
  ca.send({ type: "send", clientId: "", text: "x" });
  ca.sendRaw(JSON.stringify({ type: "send", clientId: "big", text: "a".repeat(5_000) }));
  ca.send({ type: "send", clientId: "ok", text: "still here" });
  expect((await cb.next("message")).text).toBe("still here");
  await ca.expectNone("rejected");
});

it("sends history once, when the client asks to resume, not also on connect", async () => {
  const { a, ca, chatId } = await openPairChat();
  ca.send({ type: "send", clientId: "1", text: "one" });
  await ca.next("message");
  const again = await openChat(a.cookie, chatId);
  await again.expectNone("history");
  again.send({ type: "resume", afterSeq: 0 });
  expect((await again.next("history")).messages.map((m) => m.text)).toEqual(["one"]);
  await again.expectNone("history");
});

it("resume returns only messages after afterSeq", async () => {
  const { a, ca, chatId } = await openPairChat();
  ca.send({ type: "send", clientId: "1", text: "one" });
  const first = await ca.next("message");
  ca.send({ type: "send", clientId: "2", text: "two" });
  await ca.next("message");
  const again = await openChat(a.cookie, chatId);
  again.send({ type: "resume", afterSeq: first.seq });
  expect((await again.next("history")).messages.map((m) => m.text)).toEqual(["two"]);
});

it("history clears the pending bubble of a message stored before the socket dropped", async () => {
  const { a, ca, chatId } = await openPairChat();
  ca.send({ type: "send", clientId: "pending-1", text: "did this arrive?" });
  await ca.next("message");
  const reconnected = await openChat(a.cookie, chatId);
  reconnected.send({ type: "resume", afterSeq: 0 });
  const history = await reconnected.next("history");
  expect(history.messages).toEqual([
    expect.objectContaining({ text: "did this arrive?", clientId: "pending-1" }),
  ]);
});

it("the peer never receives the sender's clientId in history", async () => {
  const { b, ca, chatId } = await openPairChat();
  ca.send({ type: "send", clientId: "secret-ish", text: "hi" });
  await ca.next("message");
  const peer = await openChat(b.cookie, chatId);
  peer.send({ type: "resume", afterSeq: 0 });
  const history = await peer.next("history");
  expect(history.messages).toHaveLength(1);
  expect(history.messages[0]).not.toHaveProperty("clientId");
});

it("third party cannot join a chat", async () => {
  const { chatId } = await openPairChat();
  const stranger = await inLobby();
  expect((await chatUpgrade(stranger.cookie, chatId)).status).toBe(403);
  expect((await chatUpgrade(null, chatId)).status).toBe(401);
});

it("ignores client-supplied identity header", async () => {
  const { b, chatId } = await openPairChat();
  const stranger = await inLobby();
  const res = await chatUpgrade(stranger.cookie, chatId, {
    "X-Swoony-User": b.me.userId,
    "X-Swoony-Peer": b.me.userId,
    "X-Swoony-Device": await deviceIdFrom(b.cookie),
  });
  expect(res.status).toBe(403);
});

it("rejects a chat upgrade from a foreign origin", async () => {
  const { a, chatId } = await openPairChat();
  const res = await rawUpgrade(`/api/chat/${chatId}`, a.cookie, "https://evil.example");
  expect(res.status).toBe(403);
});

it("blocked user cannot reconnect to the chat", async () => {
  const { a, b, chatId } = await openPairChat();
  await runInDurableObject(lobbyStub(env), (_instance, state) => {
    state.storage.sql.exec(
      "INSERT INTO blocks (blocker, blocked) VALUES (?, ?)",
      a.me.userId,
      b.me.userId,
    );
  });
  expect((await chatUpgrade(b.cookie, chatId)).status).toBe(403);
  expect((await chatUpgrade(a.cookie, chatId)).status).toBe(403);
});

it("peer leaving ends the chat and wipes it after the report window", async () => {
  const { ca, wa, wb, chatId } = await openPairChat();
  ca.send({ type: "send", clientId: "1", text: "bye soon" });
  await ca.next("message");
  wb.send({ type: "leave" });
  await ca.next("ended");
  expect((await ca.closed).code).toBe(CHAT_ENDED_CLOSE_CODE);
  expect((await wa.next("chatEnded")).chatId).toBe(chatId);
  expect(await chatMessageCount(chatId)).toBeGreaterThan(0);
  await advanceChatClock(chatId, LIMITS.chatReportWindowMs + 1);
  await fireChatAlarm(chatId);
  expect(await chatMessageCount(chatId)).toBe(0);
});

it("an ended chat refuses new sockets", async () => {
  const { a, ca, wb, chatId } = await openPairChat();
  wb.send({ type: "leave" });
  await ca.next("ended");
  expect((await chatUpgrade(a.cookie, chatId)).status).toBe(403);
});

it("chat start and end are recorded in the retention store", async () => {
  const { a, b, ca, wb, chatId } = await openPairChat();
  wb.send({ type: "leave" });
  await ca.next("ended");
  const records = await deps.retention.lookup({ userId: a.me.userId, from: 0, to: FAR_FUTURE });
  expect(records.chats).toHaveLength(1);
  const [chat] = records.chats;
  expect(chat).toMatchObject({ chatId, userA: a.me.userId, userB: b.me.userId });
  expect(chat?.startedAt).toBeGreaterThan(0);
  expect(chat?.endedAt).not.toBeNull();
});

it("chat self-wipes after both sockets are gone for 2 minutes", async () => {
  const { ca, cb, wa, wb, chatId } = await openPairChat();
  ca.send({ type: "send", clientId: "1", text: "brb" });
  await cb.next("message");
  await ca.close();
  await cb.close();
  await advanceChatClock(chatId, LIMITS.chatOrphanWipeMs - 1_000);
  await fireChatAlarm(chatId);
  await wa.expectNone("chatEnded");
  await advanceChatClock(chatId, 1_001);
  await fireChatAlarm(chatId);
  expect((await wa.next("chatEnded")).chatId).toBe(chatId);
  expect((await wb.next("chatEnded")).chatId).toBe(chatId);
  await advanceChatClock(chatId, LIMITS.chatReportWindowMs + 1);
  await fireChatAlarm(chatId);
  expect(await chatMessageCount(chatId)).toBe(0);
});

it("one remaining socket keeps the chat alive", async () => {
  const { ca, wa, chatId } = await openPairChat();
  await ca.close();
  await advanceChatClock(chatId, LIMITS.chatOrphanWipeMs + 1);
  await fireChatAlarm(chatId);
  await wa.expectNone("chatEnded");
});

it("chat self-wipes after 24 hours even with sockets", async () => {
  const { ca, cb, wa, chatId } = await openPairChat();
  ca.send({ type: "send", clientId: "1", text: "long chat" });
  await cb.next("message");
  await advanceChatClock(chatId, LIMITS.chatMaxLifetimeMs + 1);
  await fireChatAlarm(chatId);
  await ca.next("ended");
  expect((await cb.closed).code).toBe(CHAT_ENDED_CLOSE_CODE);
  expect((await wa.next("chatEnded")).chatId).toBe(chatId);
  expect(await chatMessageCount(chatId)).toBe(0);
});

it("reopening a self-wiped chat starts empty", async () => {
  const { a, b, ca, cb, wa, chatId } = await openPairChat();
  ca.send({ type: "send", clientId: "1", text: "old words" });
  await cb.next("message");
  await advanceChatClock(chatId, LIMITS.chatMaxLifetimeMs + 1);
  await fireChatAlarm(chatId);
  await wa.next("chatEnded");
  wa.send({ type: "openChat", userId: b.me.userId });
  expect((await wa.next("chatOpened")).chatId).toBe(chatId);
  const fresh = await openChat(a.cookie, chatId);
  fresh.send({ type: "resume", afterSeq: 0 });
  expect((await fresh.next("history")).messages).toEqual([]);
});

it("reopening an ended chat inside the report window hides but keeps the old text", async () => {
  const { a, b, ca, cb, wa, chatId } = await openPairChat();
  ca.send({ type: "send", clientId: "1", text: "evidence" });
  await cb.next("message");
  await ca.close();
  await cb.close();
  await advanceChatClock(chatId, LIMITS.chatOrphanWipeMs + 1);
  await fireChatAlarm(chatId);
  await wa.next("chatEnded");
  wa.send({ type: "openChat", userId: b.me.userId });
  await wa.next("chatOpened");
  const fresh = await openChat(a.cookie, chatId);
  fresh.send({ type: "resume", afterSeq: 0 });
  expect((await fresh.next("history")).messages).toEqual([]);
  fresh.send({ type: "send", clientId: "2", text: "new start" });
  await fresh.next("message");
  const room = env.CHAT_ROOM.getByName(chatId);
  expect((await room.snapshot()).map((m) => m.text)).toEqual(["evidence", "new start"]);
  await advanceChatClock(chatId, LIMITS.chatReportWindowMs + 1);
  await fireChatAlarm(chatId);
  expect((await room.snapshot()).map((m) => m.text)).toEqual(["new start"]);
  fresh.send({ type: "resume", afterSeq: 0 });
  expect((await fresh.next("history")).messages.map((m) => m.text)).toEqual(["new start"]);
});

it("blocks the 11th new chat within a minute", async () => {
  const opener = await inLobby();
  const others = await Promise.all(
    Array.from({ length: LIMITS.newChats.count + 1 }, () => enter()),
  );
  for (const other of others.slice(0, LIMITS.newChats.count)) {
    opener.ws.send({ type: "openChat", userId: other.me.userId });
    await opener.ws.next("chatOpened");
  }
  opener.ws.send({ type: "openChat", userId: others.at(-1)?.me.userId });
  expect((await opener.ws.next("error")).code).toBe("slow_down");
  expect((await opener.ws.next("notice")).code).toBe("slow_down");
});

it("caps the buffer at the configured size", async () => {
  const { ca, chatId } = await openPairChat();
  await runInDurableObject(env.CHAT_ROOM.getByName(chatId), (_instance, state) => {
    const sql = state.storage.sql;
    for (let i = 0; i < LIMITS.chatBufferMax; i++) {
      sql.exec("INSERT INTO messages (from_user, text, sent_at) VALUES ('x', 'filler', 0)");
    }
  });
  ca.send({ type: "send", clientId: "1", text: "newest" });
  await ca.next("message");
  expect(await chatMessageCount(chatId)).toBe(LIMITS.chatBufferMax);
});

it("caps chat sockets per user by closing the oldest", async () => {
  const { a, chatId, ca, cb } = await openPairChat();
  const extra = [];
  for (let socket = 1; socket <= LIMITS.socketsPerUser; socket++) {
    extra.push(await openChat(a.cookie, chatId));
  }
  expect((await ca.closed).code).toBe(REPLACED_CLOSE_CODE);
  for (const ws of [...extra, cb]) await ws.ping();
  await Promise.all([...extra, cb].map((ws) => ws.close()));
});

it("ignores resume requests beyond the per-user limit", async () => {
  const { ca } = await openPairChat();
  const { count } = LIMITS.chatResumesPerUser;
  for (let resume = 0; resume < count; resume++) ca.send({ type: "resume", afterSeq: 0 });
  for (let resume = 1; resume < count; resume++) await ca.next("history");
  ca.send({ type: "resume", afterSeq: 0 });
  await ca.expectNone("history");
  await ca.close();
});

it("relays typing to the peer only, never back to the typist", async () => {
  const { ca, cb } = await openPairChat();
  ca.send({ type: "typing" });
  await cb.next("typing");
  await ca.expectNone("typing");
});

it("relays seen to the peer and keeps it for the peer's next history", async () => {
  const { a, ca, cb, chatId } = await openPairChat();
  ca.send({ type: "send", clientId: "1", text: "hello" });
  const sent = await cb.next("message");
  cb.send({ type: "seen", seq: sent.seq });
  expect((await ca.next("seen")).seq).toBe(sent.seq);
  await cb.expectNone("seen");
  const again = await openChat(a.cookie, chatId);
  again.send({ type: "resume", afterSeq: 0 });
  expect((await again.next("history")).peerSeen).toBe(sent.seq);
});

it("ignores seen beyond the newest message, for own messages or going backwards", async () => {
  const { ca, cb } = await openPairChat();
  ca.send({ type: "send", clientId: "1", text: "one" });
  const first = await cb.next("message");
  cb.send({ type: "send", clientId: "2", text: "two" });
  const own = await cb.next("message");
  cb.send({ type: "seen", seq: own.seq + 50 });
  cb.send({ type: "seen", seq: own.seq });
  await ca.expectNone("seen");
  cb.send({ type: "seen", seq: first.seq });
  expect((await ca.next("seen")).seq).toBe(first.seq);
  cb.send({ type: "seen", seq: first.seq });
  await ca.expectNone("seen");
});

it("drops typing and seen signals beyond the per-user limit", async () => {
  const { ca, cb } = await openPairChat();
  for (let i = 0; i < LIMITS.chatSignalsPerUser.count + 5; i++) ca.send({ type: "typing" });
  for (let i = 0; i < LIMITS.chatSignalsPerUser.count; i++) await cb.next("typing");
  await cb.expectNone("typing");
});

it("a restarted chat forgets what was seen before", async () => {
  const { a, b, ca, cb, wa, chatId } = await openPairChat();
  ca.send({ type: "send", clientId: "1", text: "evidence" });
  const sent = await cb.next("message");
  cb.send({ type: "seen", seq: sent.seq });
  await ca.next("seen");
  await ca.close();
  await cb.close();
  await advanceChatClock(chatId, LIMITS.chatOrphanWipeMs + 1);
  await fireChatAlarm(chatId);
  await wa.next("chatEnded");
  wa.send({ type: "openChat", userId: b.me.userId });
  await wa.next("chatOpened");
  const fresh = await openChat(a.cookie, chatId);
  fresh.send({ type: "resume", afterSeq: 0 });
  expect((await fresh.next("history")).peerSeen).toBe(0);
});
