import { LIMITS } from "@shared/config";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, expect, it, vi } from "vitest";
import { ContentArchive } from "../retention/ContentArchive";
import { Encryptor } from "../retention/Encryptor";
import { RetentionStore } from "../retention/RetentionStore";
import { archivedMessages } from "../test/archive";
import {
  advanceChatClock,
  chatMessageCount,
  deps,
  fireChatAlarm,
  openChat,
  openPairChat,
  resetLobby,
  type TestSocket,
} from "../test/helpers";

beforeEach(resetLobby);

const encryptor = new Encryptor(env.RETENTION_KEY);
const archive = new ContentArchive(env.DB, env.ARCHIVE, encryptor, () => Date.now());

const quietAlerts = { notify: vi.fn(() => Promise.resolve(true)) };

async function retainAllIn(chatId: string): Promise<RetentionStore> {
  const retention = new RetentionStore(
    env.DB,
    encryptor,
    deps.hasher,
    () => Date.now(),
    true,
    archive,
  );
  await runInDurableObject(env.CHAT_ROOM.getByName(chatId), (instance) => {
    Object.assign(instance, {
      deps: { ...deps, retention, alerts: quietAlerts },
      messageLimiter: { hit: () => true },
    });
  });
  return retention;
}

async function sendMany(socket: TestSocket, count: number, prefix = "m"): Promise<void> {
  for (let i = 0; i < count; i++) {
    socket.send({ type: "send", clientId: `${prefix}${String(i)}`, text: `${prefix}${String(i)}` });
    await socket.next("message");
  }
}

async function bundleSizes(chatId: string): Promise<number[]> {
  const { results } = await env.DB.prepare(
    "SELECT message_count FROM content_archive WHERE chat_id = ? ORDER BY id",
  )
    .bind(chatId)
    .all<{ message_count: number }>();
  return results.map((row) => row.message_count);
}

async function pendingCount(chatId: string): Promise<number> {
  return runInDurableObject(env.CHAT_ROOM.getByName(chatId), (_instance, state) => {
    const sql = state.storage.sql;
    const tables = sql
      .exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'archive_pending'")
      .toArray();
    if (tables.length === 0) return 0;
    return sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM archive_pending").one().n;
  });
}

it("archives in one bundle every 100 messages", async () => {
  const { ca, chatId } = await openPairChat();
  await retainAllIn(chatId);
  await sendMany(ca, LIMITS.archiveFlushMessages);
  await vi.waitFor(async () => {
    expect(await bundleSizes(chatId)).toEqual([LIMITS.archiveFlushMessages]);
  });
  await sendMany(ca, 1, "extra");
  expect(await bundleSizes(chatId)).toEqual([LIMITS.archiveFlushMessages]);
  expect(await pendingCount(chatId)).toBe(1);
});

it("flushes the remaining messages when the chat ends", async () => {
  const { ca, wa, wb, chatId } = await openPairChat();
  await retainAllIn(chatId);
  await sendMany(ca, 3);
  wb.send({ type: "leave" });
  await wa.next("chatEnded");
  await vi.waitFor(async () => {
    expect(await bundleSizes(chatId)).toEqual([3]);
  });
  expect((await archivedMessages(archive, chatId)).map((m) => m.text)).toEqual(["m0", "m1", "m2"]);
});

it("flushes pending messages when the chat ends at the 24h cap", async () => {
  const { ca, wa, chatId } = await openPairChat();
  await retainAllIn(chatId);
  await sendMany(ca, 2);
  await advanceChatClock(chatId, LIMITS.chatMaxLifetimeMs + 1);
  await fireChatAlarm(chatId);
  await wa.next("chatEnded");
  expect(await bundleSizes(chatId)).toEqual([2]);
  expect(await chatMessageCount(chatId)).toBe(0);
});

it("archives all 250 messages of a chat longer than the live buffer", async () => {
  const { ca, wa, wb, chatId } = await openPairChat();
  await retainAllIn(chatId);
  await sendMany(ca, 250);
  wb.send({ type: "leave" });
  await wa.next("chatEnded");
  await vi.waitFor(async () => {
    expect(await bundleSizes(chatId)).toEqual([100, 100, 50]);
  });
  const texts = (await archivedMessages(archive, chatId)).map((m) => m.text);
  expect(texts).toHaveLength(250);
  expect(texts[0]).toBe("m0");
  expect(texts.at(-1)).toBe("m249");
});

it("keeps pending messages after a failed flush and archives them before the wipe", async () => {
  const { ca, wa, wb, chatId } = await openPairChat();
  const retention = await retainAllIn(chatId);
  const archiveMessages = vi
    .spyOn(retention, "archiveMessages")
    .mockRejectedValueOnce(new Error("r2 down"));
  await sendMany(ca, 2);
  wb.send({ type: "leave" });
  await wa.next("chatEnded");
  expect(await bundleSizes(chatId)).toEqual([]);
  expect(await pendingCount(chatId)).toBe(2);
  await advanceChatClock(chatId, LIMITS.chatReportWindowMs + 1);
  await fireChatAlarm(chatId);
  expect(archiveMessages).toHaveBeenCalledTimes(2);
  expect(await bundleSizes(chatId)).toEqual([2]);
  expect(await pendingCount(chatId)).toBe(0);
  expect(await chatMessageCount(chatId)).toBe(0);
});

it("drops the live text but keeps retrying the archive when it keeps failing at wipe time", async () => {
  const { ca, wa, wb, chatId } = await openPairChat();
  const retention = await retainAllIn(chatId);
  const archiveMessages = vi
    .spyOn(retention, "archiveMessages")
    .mockRejectedValue(new Error("r2 down"));
  await sendMany(ca, 2);
  wb.send({ type: "leave" });
  await wa.next("chatEnded");
  await advanceChatClock(chatId, LIMITS.chatReportWindowMs + 1);
  await fireChatAlarm(chatId);
  expect(await chatMessageCount(chatId)).toBe(0);
  expect(await pendingCount(chatId)).toBe(2);
  archiveMessages.mockRestore();
  await advanceChatClock(chatId, LIMITS.archiveRetryMs);
  expect(await fireChatAlarm(chatId)).toBe(true);
  expect(await bundleSizes(chatId)).toEqual([2]);
  expect(await pendingCount(chatId)).toBe(0);
});

it("a takedown archives pending messages before wiping the chat", async () => {
  const { ca, chatId } = await openPairChat();
  await retainAllIn(chatId);
  await sendMany(ca, 4);
  await env.CHAT_ROOM.getByName(chatId).takedown();
  expect(await bundleSizes(chatId)).toEqual([4]);
  expect(await chatMessageCount(chatId)).toBe(0);
});

it("stores nothing while RETAIN_ALL_CONTENT is off", async () => {
  const { ca, wa, wb, chatId } = await openPairChat();
  ca.send({ type: "send", clientId: "1", text: "not kept" });
  await ca.next("message");
  expect(await pendingCount(chatId)).toBe(0);
  wb.send({ type: "leave" });
  await wa.next("chatEnded");
  expect(await bundleSizes(chatId)).toEqual([]);
});

it("waits before retrying a failed archive instead of retrying on every message", async () => {
  const { ca, chatId } = await openPairChat();
  const retention = await retainAllIn(chatId);
  const archiveMessages = vi
    .spyOn(retention, "archiveMessages")
    .mockRejectedValue(new Error("r2 down"));
  await sendMany(ca, LIMITS.archiveFlushMessages + 5);
  await vi.waitFor(() => {
    expect(archiveMessages).toHaveBeenCalledTimes(1);
  });
  archiveMessages.mockRestore();
  await advanceChatClock(chatId, LIMITS.archiveRetryMs);
  await sendMany(ca, 1, "late");
  await vi.waitFor(async () => {
    expect(await bundleSizes(chatId)).toEqual([LIMITS.archiveFlushMessages, 6]);
  });
  expect(await pendingCount(chatId)).toBe(0);
});

it("a chat reopened while a retry is still archiving starts fresh and stays open", async () => {
  const { a, b, ca, cb, wa, chatId } = await openPairChat();
  const retention = await retainAllIn(chatId);
  let release: () => void = () => undefined;
  const slowArchive = new Promise<void>((resolve) => {
    release = resolve;
  });
  const archiveMessages = vi
    .spyOn(retention, "archiveMessages")
    .mockRejectedValueOnce(new Error("r2 down"))
    .mockRejectedValueOnce(new Error("r2 down"))
    .mockImplementationOnce(() => slowArchive);
  await sendMany(ca, 2);
  await ca.close();
  await cb.close();
  await advanceChatClock(chatId, LIMITS.chatOrphanWipeMs + 1);
  await fireChatAlarm(chatId);
  await wa.next("chatEnded");
  await advanceChatClock(chatId, LIMITS.chatReportWindowMs + 1);
  await fireChatAlarm(chatId);
  expect(await pendingCount(chatId)).toBe(2);
  await advanceChatClock(chatId, LIMITS.archiveRetryMs);
  const retry = fireChatAlarm(chatId);
  await vi.waitFor(() => {
    expect(archiveMessages).toHaveBeenCalledTimes(3);
  });
  wa.send({ type: "openChat", userId: b.me.userId });
  await new Promise((resolve) => setTimeout(resolve, 50));
  release();
  await retry;
  expect((await wa.next("chatOpened")).chatId).toBe(chatId);
  const fresh = await openChat(a.cookie, chatId);
  fresh.send({ type: "resume", afterSeq: 0 });
  expect((await fresh.next("history")).messages).toEqual([]);
  fresh.send({ type: "send", clientId: "n1", text: "hello again" });
  expect((await fresh.next("message")).text).toBe("hello again");
});

it("retries a failed batch under the same batch key", async () => {
  const { ca, wa, wb, chatId } = await openPairChat();
  const retention = await retainAllIn(chatId);
  const archiveMessages = vi
    .spyOn(retention, "archiveMessages")
    .mockRejectedValueOnce(new Error("r2 down"));
  await sendMany(ca, 3);
  wb.send({ type: "leave" });
  await wa.next("chatEnded");
  await advanceChatClock(chatId, LIMITS.chatReportWindowMs + 1);
  await fireChatAlarm(chatId);
  const keys = archiveMessages.mock.calls.map((call) => call[2]);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toMatch(/^\d+-\d+$/);
  expect(keys[1]).toBe(keys[0]);
});

it("emails the owner when messages have waited over an hour to be archived", async () => {
  const { ca, wa, wb, chatId } = await openPairChat();
  const retention = await retainAllIn(chatId);
  vi.spyOn(retention, "archiveMessages").mockRejectedValue(new Error("r2 down"));
  quietAlerts.notify.mockClear();
  await sendMany(ca, LIMITS.archiveFlushMessages);
  await vi.waitFor(() => {
    expect(quietAlerts.notify).not.toHaveBeenCalled();
  });
  await advanceChatClock(chatId, LIMITS.archiveStuckAlertMs + 1);
  wb.send({ type: "leave" });
  await wa.next("chatEnded");
  await vi.waitFor(() => {
    expect(quietAlerts.notify).toHaveBeenCalledWith(
      "archive_stuck",
      expect.any(String) as string,
      expect.any(String) as string,
    );
  });
});

it("splits a backlog so no bundle spans more than the time-window search allows", async () => {
  const { ca, wa, wb, chatId } = await openPairChat();
  await retainAllIn(chatId);
  await sendMany(ca, 1);
  await runInDurableObject(env.CHAT_ROOM.getByName(chatId), (_instance, state) => {
    const later = Date.now() + LIMITS.archiveBundleMaxSpanMs + 1_000;
    state.storage.sql.exec(
      "INSERT INTO archive_pending (from_user, text, sent_at) VALUES ('x', 'late', ?)",
      later,
    );
  });
  wb.send({ type: "leave" });
  await wa.next("chatEnded");
  await vi.waitFor(async () => {
    expect(await bundleSizes(chatId)).toEqual([1, 1]);
  });
});
