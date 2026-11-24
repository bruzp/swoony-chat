import { LIMITS } from "@shared/config";
import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import {
  deps,
  deviceIdFrom,
  enter,
  inLobby,
  openChat,
  openLobby,
  openPairChat,
  resetLobby,
  type TestSocket,
} from "../test/helpers";
import { chatIdFor } from "../chat/chatId";
import { lobbyStub } from "./lobbyStub";

beforeEach(resetLobby);

type Entered = Awaited<ReturnType<typeof enter>>;

const NETWORKS = ["192.0.2.1", "198.51.100.1", "203.0.113.1", "192.0.2.77"];
const FAR_FUTURE = 8_640_000_000_000_000;

async function chatWith(
  target: Entered,
  reporterIp: string,
  { targetSpeaks = true, text = "hello" } = {},
): Promise<{ reporter: Entered; wr: TestSocket; chatId: string }> {
  const reporter = await enter({}, { ip: reporterIp });
  const wr = await openLobby(reporter.cookie);
  await wr.next("hello");
  wr.send({ type: "openChat", userId: target.me.userId });
  const { chatId } = await wr.next("chatOpened");
  if (targetSpeaks) {
    const ct = await openChat(target.cookie, chatId);
    ct.send({ type: "send", clientId: "x", text });
    await wr.next("incomingChat");
  } else {
    const cr = await openChat(reporter.cookie, chatId);
    cr.send({ type: "send", clientId: "x", text: "hello" });
    await cr.next("message");
  }
  return { reporter, wr, chatId };
}

async function report(wr: TestSocket, userId: string, reason = "harassment"): Promise<void> {
  wr.send({ type: "report", userId, reason });
  expect((await wr.next("reported")).userId).toBe(userId);
}

async function chattedReport(target: Entered, reporterIp: string): Promise<void> {
  const { wr } = await chatWith(target, reporterIp);
  await report(wr, target.me.userId);
}

async function deviceHashOf(user: Entered): Promise<string> {
  return deps.hasher.hash(await deviceIdFrom(user.cookie));
}

async function countedReports(user: Entered): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM reports WHERE reported_device = ? AND source = 'user'",
  )
    .bind(await deviceHashOf(user))
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function banCount(user: Entered): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM bans WHERE device_hash = ?")
    .bind(await deviceHashOf(user))
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function snapshotsFor(user: Entered) {
  const records = await deps.retention.lookup({ userId: user.me.userId, from: 0, to: FAR_FUTURE });
  return records.content.filter((entry) => entry.kind === "report_snapshot");
}

it("3 counted reports from 3 networks ban the target device and network", async () => {
  const target = await enter();
  const wt = await openLobby(target.cookie);
  await wt.next("hello");
  for (const ip of NETWORKS.slice(0, 3)) await chattedReport(target, ip);
  expect((await wt.next("kicked")).reason).toBe("banned");
  expect((await enter({}, { cookie: target.cookie })).res.status).toBe(403);
  expect(await banCount(target)).toBe(1);
});

it("reports from one network count once", async () => {
  const target = await enter();
  const wt = await openLobby(target.cookie);
  await wt.next("hello");
  for (let i = 0; i < 3; i++) await chattedReport(target, NETWORKS[0] ?? "");
  await wt.expectNone("kicked");
  expect(await countedReports(target)).toBe(3);
  expect(await banCount(target)).toBe(0);
});

it("report without a two-way chat does not count but still answers reported", async () => {
  const target = await enter();
  const wt = await openLobby(target.cookie);
  await wt.next("hello");
  for (const ip of NETWORKS.slice(0, 3)) {
    const { wr } = await chatWith(target, ip, { targetSpeaks: false });
    await report(wr, target.me.userId);
  }
  const stranger = await inLobby({}, { ip: NETWORKS[3] ?? "" });
  await report(stranger.ws, target.me.userId);
  await wt.expectNone("kicked");
  expect(await countedReports(target)).toBe(0);
  expect(await banCount(target)).toBe(0);
});

it("departed target can still be reported by someone who chatted with them", async () => {
  const target = await enter();
  const wt = await openLobby(target.cookie);
  await wt.next("hello");
  const { wr } = await chatWith(target, NETWORKS[0] ?? "");
  wt.send({ type: "leave" });
  await wr.next("chatEnded");
  await report(wr, target.me.userId);
  expect(await countedReports(target)).toBe(1);
});

it("reports after a ban only count toward a new ban", async () => {
  const target = await enter();
  const wt = await openLobby(target.cookie);
  await wt.next("hello");
  const late = await chatWith(target, NETWORKS[3] ?? "");
  for (const ip of NETWORKS.slice(0, 3)) await chattedReport(target, ip);
  expect((await wt.next("kicked")).reason).toBe("banned");
  await report(late.wr, target.me.userId);
  expect(await countedReports(target)).toBe(4);
  expect(await banCount(target)).toBe(1);
});

it("simultaneous counted reports issue a single ban", async () => {
  const target = await enter();
  const wt = await openLobby(target.cookie);
  await wt.next("hello");
  const ips = [...NETWORKS, "198.51.100.88"];
  const chats = [];
  const greetings = ["hello", "hi", "hey", "yo", "sup"];
  for (const [index, ip] of ips.entries()) {
    chats.push(await chatWith(target, ip, { text: greetings[index] ?? "hello" }));
  }
  for (const { wr } of chats.slice(0, 2)) await report(wr, target.me.userId);
  const burst = chats.slice(2);
  for (const { wr } of burst) wr.send({ type: "report", userId: target.me.userId, reason: "spam" });
  for (const { wr } of burst) await wr.next("reported");
  expect((await wt.next("kicked")).reason).toBe("banned");
  await expect.poll(() => countedReports(target)).toBe(ips.length);
  expect(await banCount(target)).toBe(1);
});

it("a burst of strikes records a single kick", async () => {
  const target = await enter();
  const ws = await openLobby(target.cookie);
  await ws.next("hello");
  const lobby = lobbyStub(env);
  const outcomes = await Promise.all(
    Array.from({ length: 6 }, () => lobby.reportStrike(target.me.userId, Date.now())),
  );
  expect(outcomes.filter((outcome) => outcome === "kicked").length).toBeGreaterThan(0);
  expect((await ws.next("kicked")).reason).toBe("abuse");
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM reports WHERE reported_device = ? AND source = 'system'",
  )
    .bind(await deviceHashOf(target))
    .first<{ n: number }>();
  expect(row?.n).toBe(1);
  expect(await banCount(target)).toBe(0);
});

it("cannot report yourself or a user never seen", async () => {
  const user = await inLobby();
  user.ws.send({ type: "report", userId: user.me.userId, reason: "spam" });
  expect((await user.ws.next("error")).code).toBe("user_unavailable");
  user.ws.send({ type: "report", userId: "nobody", reason: "spam" });
  expect((await user.ws.next("error")).code).toBe("user_unavailable");
  user.ws.send({ type: "report", userId: "nobody", reason: "rude" });
  expect((await user.ws.next("error")).code).toBe("bad_message");
});

it("block hides users both ways and ends their chat", async () => {
  const { a, b, wa, wb, cb, chatId } = await openPairChat();
  wa.send({ type: "block", userId: b.me.userId });
  expect((await wa.next("blocked")).userId).toBe(b.me.userId);
  await cb.next("ended");
  expect((await wb.next("chatEnded")).chatId).toBe(chatId);
  expect(await wb.nextWhere("presence", (m) => m.left.length > 0)).toMatchObject({
    left: [a.me.userId],
    online: 0,
  });
  expect(await wa.nextWhere("presence", (m) => m.left.length > 0)).toMatchObject({
    left: [b.me.userId],
    online: 0,
  });
  wb.send({ type: "list", requestId: "r1", filter: {} });
  expect((await wb.next("page")).users.map((u) => u.userId)).not.toContain(a.me.userId);
  wa.send({ type: "list", requestId: "r2", filter: {} });
  expect((await wa.next("page")).users.map((u) => u.userId)).not.toContain(b.me.userId);
  wb.send({ type: "openChat", userId: a.me.userId });
  expect((await wb.next("error")).code).toBe("user_unavailable");
});

it("reporting also blocks and ends the chat", async () => {
  const { a, b, wa, wb, cb } = await openPairChat();
  await report(wa, b.me.userId, "spam");
  await cb.next("ended");
  wb.send({ type: "openChat", userId: a.me.userId });
  expect((await wb.next("error")).code).toBe("user_unavailable");
});

it("11th report in an hour is rate limited", async () => {
  const reporter = await inLobby();
  const targets = await Promise.all(
    Array.from({ length: LIMITS.reportsPerDevice.count + 1 }, () => enter()),
  );
  for (const target of targets.slice(0, LIMITS.reportsPerDevice.count)) {
    await report(reporter.ws, target.me.userId);
  }
  reporter.ws.send({ type: "report", userId: targets.at(-1)?.me.userId, reason: "spam" });
  expect((await reporter.ws.next("error")).code).toBe("slow_down");
  expect((await reporter.ws.next("notice")).code).toBe("slow_down");
});

it("3 strikes kick for abuse and 3 system kicks in 24h ban the device", async () => {
  const target = await enter();
  for (let kick = 1; kick <= LIMITS.kicksForBan.count; kick++) {
    const session = await enter({}, { cookie: target.cookie });
    const ws = await openLobby(session.cookie);
    await ws.next("hello");
    const lobby = lobbyStub(env);
    for (let strike = 1; strike < LIMITS.strikesForKick.count; strike++) {
      expect(await lobby.reportStrike(session.me.userId, Date.now())).toBe("ok");
      expect((await ws.next("notice")).code).toBe("slow_down");
    }
    expect(await lobby.reportStrike(session.me.userId, Date.now())).toBe("kicked");
    const expected = kick === LIMITS.kicksForBan.count ? "banned" : "abuse";
    expect((await ws.next("kicked")).reason).toBe(expected);
  }
  expect((await enter({}, { cookie: target.cookie })).res.status).toBe(403);
});

it("sending the same text to 5 users in a minute is rejected as spam with a strike", async () => {
  const sender = await inLobby();
  const recipients = await Promise.all(
    Array.from({ length: LIMITS.duplicateText.users }, () => enter()),
  );
  const chats = [];
  for (const recipient of recipients) {
    sender.ws.send({ type: "openChat", userId: recipient.me.userId });
    const { chatId } = await sender.ws.next("chatOpened");
    chats.push(await openChat(sender.cookie, chatId));
  }
  const last = chats.pop();
  for (const chat of chats) {
    chat.send({ type: "send", clientId: "d", text: "Hi there, want to chat?" });
    await chat.next("message");
  }
  last?.send({ type: "send", clientId: "d", text: "hi there, want to chat?" });
  expect(await last?.next("rejected")).toMatchObject({ clientId: "d", reason: "spam" });
  expect((await sender.ws.next("notice")).code).toBe("slow_down");
});

async function chatsWithManyUsers(): Promise<TestSocket[]> {
  const sender = await inLobby();
  const recipients = await Promise.all(
    Array.from({ length: LIMITS.duplicateText.users }, () => enter()),
  );
  const chats = [];
  for (const recipient of recipients) {
    sender.ws.send({ type: "openChat", userId: recipient.me.userId });
    const { chatId } = await sender.ws.next("chatOpened");
    chats.push(await openChat(sender.cookie, chatId));
  }
  return chats;
}

const justUnderMinChars = LIMITS.duplicateText.minChars - 1;

it.each([
  ["letters", "x".repeat(justUnderMinChars)],
  ["emoji", "😀".repeat(justUnderMinChars)],
])("short text (%s) sent to 5 users in a minute is not treated as spam", async (_, text) => {
  for (const chat of await chatsWithManyUsers()) {
    chat.send({ type: "send", clientId: "g", text });
    expect((await chat.next("message")).text).toBe(text);
  }
});

it("text of exactly the minimum length sent to 5 users in a minute is spam", async () => {
  const chats = await chatsWithManyUsers();
  const last = chats.pop();
  const text = "x".repeat(LIMITS.duplicateText.minChars);
  for (const chat of chats) {
    chat.send({ type: "send", clientId: "b", text });
    await chat.next("message");
  }
  last?.send({ type: "send", clientId: "b", text });
  expect(await last?.next("rejected")).toMatchObject({ clientId: "b", reason: "spam" });
});

it("3 contact-detail rejections in bios count as a strike", async () => {
  const user = await inLobby();
  for (let attempt = 0; attempt < LIMITS.contactRejectionsForStrike.count; attempt++) {
    user.ws.send({ type: "setBio", bio: "text me 0917 123 4567" });
    expect((await user.ws.next("bioRejected")).reason).toBe("contact");
  }
  expect((await user.ws.next("notice")).code).toBe("slow_down");
});

it("strikes carry over when the user leaves and enters again", async () => {
  const target = await enter();
  const lobby = lobbyStub(env);
  for (let strike = 1; strike < LIMITS.strikesForKick.count; strike++) {
    expect(await lobby.reportStrike(target.me.userId, Date.now())).toBe("ok");
  }
  await lobby.removeUser(await deviceIdFrom(target.cookie), "left");
  const again = await enter({}, { cookie: target.cookie });
  const ws = await openLobby(again.cookie);
  await ws.next("hello");
  expect(await lobby.reportStrike(again.me.userId, Date.now())).toBe("kicked");
  expect((await ws.next("kicked")).reason).toBe("abuse");
});

it("contact-detail rejections carry over when the user leaves and enters again", async () => {
  const first = await inLobby();
  for (let attempt = 1; attempt < LIMITS.contactRejectionsForStrike.count; attempt++) {
    first.ws.send({ type: "setBio", bio: "text me 0917 123 4567" });
    await first.ws.next("bioRejected");
  }
  first.ws.send({ type: "leave" });
  await first.ws.closed;
  const again = await inLobby({}, { cookie: first.cookie });
  again.ws.send({ type: "setBio", bio: "text me 0917 123 4567" });
  await again.ws.next("bioRejected");
  expect((await again.ws.next("notice")).code).toBe("slow_down");
});

it("a report about someone never chatted with stores no snapshot", async () => {
  const reporter = await inLobby();
  const target = await enter();
  await report(reporter.ws, target.me.userId);
  const chatId = await chatIdFor(reporter.me.userId, target.me.userId);
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM content_log WHERE chat_id = ?")
    .bind(chatId)
    .first<{ n: number }>();
  expect(row?.n).toBe(0);
});

it("a report stores an encrypted snapshot of that chat", async () => {
  const target = await enter();
  await chattedReport(target, NETWORKS[0] ?? "");
  const snapshots = await snapshotsFor(target);
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]?.reason).toBe("harassment");
  expect(snapshots[0]?.messages.map((m) => m.text)).toEqual(["hello"]);
  const row = await env.DB.prepare("SELECT payload FROM content_log WHERE chat_id = ?")
    .bind(snapshots[0]?.chatId ?? "")
    .first<{ payload: string }>();
  expect(row?.payload).not.toContain("hello");
});

it("a report right after the peer left still captures the chat", async () => {
  const target = await enter();
  const wt = await openLobby(target.cookie);
  await wt.next("hello");
  const { wr } = await chatWith(target, NETWORKS[0] ?? "");
  wt.send({ type: "leave" });
  await wr.next("chatEnded");
  await report(wr, target.me.userId, "sexual");
  const snapshots = await snapshotsFor(target);
  expect(snapshots.map((s) => s.messages.map((m) => m.text))).toEqual([["hello"]]);
});
