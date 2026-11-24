import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { LIMITS } from "@shared/config";
import { createDeps } from "../deps";
import { ContentArchive } from "./ContentArchive";
import { Encryptor } from "./Encryptor";
import { RetentionStore } from "./RetentionStore";

const deps = createDeps(env);
const encryptor = new Encryptor(env.RETENTION_KEY);
const storeAt = (now: number, retainAllContent = false) =>
  new RetentionStore(
    env.DB,
    encryptor,
    deps.hasher,
    () => now,
    retainAllContent,
    new ContentArchive(env.DB, env.ARCHIVE, encryptor, () => now),
  );

const connection = (userId: string, nickname: string, ip: string, joinedAt: number) => ({
  userId,
  deviceHash: "d",
  nickname,
  ip,
  country: "PH",
  detectedCountry: "JP",
  joinedAt,
});

async function count(table: string, column: string, value: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`)
    .bind(value)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe("RetentionStore", () => {
  it("finds a nickname by its hash without decrypting other records", async () => {
    const at = 7_777_000;
    const store = storeAt(at);
    await store.logConnection(connection("nh-1", "Nora", "9.9.9.9", at));
    await env.DB.prepare(
      "INSERT INTO connection_log (user_id, device_hash, nickname_hash, payload, joined_at) VALUES ('nh-junk', 'd', 'other', 'not-ciphertext', ?)",
    )
      .bind(at)
      .run();
    try {
      const records = await store.lookup({ nickname: "NORA", from: at - 1, to: at + 1 });
      expect(records.connections.map((c) => c.userId)).toEqual(["nh-1"]);
      const row = await env.DB.prepare(
        "SELECT nickname_hash FROM connection_log WHERE user_id = 'nh-1'",
      ).first<{ nickname_hash: string }>();
      expect(row?.nickname_hash).toBe(await deps.hasher.hash("nora"));
    } finally {
      await env.DB.prepare("DELETE FROM connection_log WHERE user_id = 'nh-junk'").run();
    }
  });

  it("looks up nicknames and users' chats through indexes", async () => {
    const plan = async (sql: string) => {
      const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).all<{
        detail: string;
      }>();
      return results.map((row) => row.detail).join(" | ");
    };
    expect(
      await plan(
        "SELECT * FROM connection_log WHERE joined_at BETWEEN 0 AND 1 AND nickname_hash = 'h'",
      ),
    ).toContain("connection_log_nickname");
    const chats = await plan(
      "SELECT * FROM chat_log WHERE started_at BETWEEN 0 AND 1 AND (user_a IN (SELECT value FROM json_each('[\"u\"]')) OR user_b IN (SELECT value FROM json_each('[\"u\"]')))",
    );
    expect(chats).toContain("chat_log_user_a");
    expect(chats).toContain("chat_log_user_b");
  });

  it("finds a chat by id and active holds through indexes", async () => {
    const plan = async (sql: string) => {
      const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).all<{
        detail: string;
      }>();
      return results.map((row) => row.detail).join(" | ");
    };
    expect(
      await plan("UPDATE chat_log SET ended_at = 1 WHERE chat_id = 'c' AND ended_at IS NULL"),
    ).toContain("chat_log_chat");
    for (const table of ["connection_log", "chat_log", "content_log", "content_archive"]) {
      expect(await plan(`SELECT * FROM ${table} WHERE hold_until > 1`)).toContain(`${table}_hold`);
    }
  });

  it("keeps identifiers only inside encrypted payloads", async () => {
    await deps.retention.logConnection({
      userId: "u1",
      deviceHash: "h1",
      nickname: "Mika",
      ip: "1.2.3.4",
      country: "PH",
      detectedCountry: "JP",
      joinedAt: 0,
    });
    const row = await env.DB.prepare("SELECT * FROM connection_log WHERE user_id = 'u1'").first();
    expect(JSON.stringify(row)).not.toContain("1.2.3.4");
    expect(JSON.stringify(row)).not.toContain("Mika");
    expect(JSON.stringify(row)).not.toContain('"PH"');
    expect(JSON.stringify(row)).not.toContain('"JP"');
    const records = await deps.retention.lookup({ nickname: "mika", from: 0, to: 1 });
    expect(records.connections[0]).toEqual({
      userId: "u1",
      nickname: "Mika",
      ip: "1.2.3.4",
      country: "PH",
      detectedCountry: "JP",
      joinedAt: 0,
      leftAt: null,
    });
  });

  it("closes many connections and chats with one statement each", async () => {
    const store = storeAt(100);
    for (const id of ["bk-a", "bk-b", "bk-c"]) {
      await store.logConnection(connection(id, "Ana", "5.5.5.5", 100));
    }
    await store.logChatStart("bk-1", "bk-a", "bk-b", 110);
    await store.logChatStart("bk-2", "bk-b", "bk-c", 110);
    const prepare = vi.spyOn(env.DB, "prepare");
    try {
      await store.logDisconnect(["bk-a", "bk-b", "bk-c"], 200);
      await store.logChatEnd(["bk-1", "bk-2"], 210);
      expect(prepare).toHaveBeenCalledTimes(2);
    } finally {
      prepare.mockRestore();
    }
    const left = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM connection_log WHERE user_id LIKE 'bk-%' AND left_at = 200",
    ).first<{ n: number }>();
    const ended = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM chat_log WHERE chat_id LIKE 'bk-%' AND ended_at = 210",
    ).first<{ n: number }>();
    expect([left?.n, ended?.n]).toEqual([3, 2]);
  });

  it("closes very large batches in chunks so one failure cannot lose them all", async () => {
    const store = storeAt(100);
    const ids = Array.from({ length: 1_200 }, (_, i) => `chunk-${String(i)}`);
    const prepare = vi.spyOn(env.DB, "prepare");
    try {
      await store.logDisconnect(ids, 200);
      await store.logChatEnd(ids, 200);
      expect(prepare).toHaveBeenCalledTimes(6);
    } finally {
      prepare.mockRestore();
    }
  });

  it("reads records written before the detected country was kept", async () => {
    const payload = await encryptor.encrypt({ nickname: "Legacy", ip: "9.9.9.9", country: "PH" });
    await env.DB.prepare(
      "INSERT INTO connection_log (user_id, device_hash, payload, joined_at) VALUES (?, ?, ?, ?)",
    )
      .bind("legacy-u", "d", payload, 7)
      .run();
    const records = await storeAt(7).lookup({ userId: "legacy-u", from: 7, to: 7 });
    expect(records.connections[0]?.detectedCountry).toBeNull();
  });

  it("records disconnects and chats, and looks them up by user and window", async () => {
    const store = storeAt(100);
    await store.logConnection(connection("lk-a", "Ana", "5.5.5.5", 100));
    await store.logConnection(connection("lk-b", "Ben", "6.6.6.6", 100));
    await store.logChatStart("lk-chat", "lk-a", "lk-b", 110);
    await store.logChatEnd(["lk-chat"], 150);
    await store.logDisconnect(["lk-a"], 200);
    await store.logChatStart("lk-other", "someone", "else", 120);

    const records = await store.lookup({ userId: "lk-a", from: 100, to: 300 });
    expect(records.connections).toEqual([
      {
        userId: "lk-a",
        nickname: "Ana",
        ip: "5.5.5.5",
        country: "PH",
        detectedCountry: "JP",
        joinedAt: 100,
        leftAt: 200,
      },
    ]);
    expect(records.chats).toEqual([
      { chatId: "lk-chat", userA: "lk-a", userB: "lk-b", startedAt: 110, endedAt: 150 },
    ]);
    expect((await store.lookup({ userId: "lk-a", from: 201, to: 300 })).connections).toEqual([]);
  });

  it("stores encrypted report snapshots and returns them with the chat", async () => {
    const store = storeAt(1_000);
    await store.logConnection(connection("rp-a", "Cara", "7.7.7.7", 1_000));
    await store.logChatStart("rp-chat", "rp-a", "rp-b", 1_000);
    const messages = [{ from: "rp-b", text: "hello there", sentAt: 1_001 }];
    await store.snapshotReport("rp-chat", "harassment", messages);
    const row = await env.DB.prepare("SELECT * FROM content_log WHERE chat_id = 'rp-chat'").first();
    expect(JSON.stringify(row)).not.toContain("hello there");
    const records = await store.lookup({ nickname: "cara", from: 1_000, to: 2_000 });
    expect(records.content).toEqual([
      {
        chatId: "rp-chat",
        kind: "report_snapshot",
        reason: "harassment",
        messages,
        createdAt: 1_000,
      },
    ]);
  });

  it("archiveMessages does nothing while RETAIN_ALL_CONTENT is off", async () => {
    await storeAt(1).archiveMessages("am-off", [{ from: "u", text: "hi", sentAt: 1 }]);
    expect(await count("content_archive", "chat_id", "am-off")).toBe(0);
  });

  it("chatRecords and lookup include archived messages as all_content", async () => {
    const at = 70_000;
    const store = storeAt(at, true);
    const early = [{ from: "a", text: "first", sentAt: at - 20 }];
    const late = [{ from: "b", text: "second", sentAt: at - 10 }];
    await store.logChatStart("am-on", "am-a", "am-b", at - 30);
    await store.archiveMessages("am-on", early);
    await store.snapshotReport("am-on", "spam", late);
    await storeAt(at + 1, true).archiveMessages("am-on", late);
    const archived = (messages: typeof early, createdAt: number) => ({
      chatId: "am-on",
      kind: "all_content",
      reason: null,
      messages,
      createdAt,
    });
    const report = { chatId: "am-on", kind: "report_snapshot", reason: "spam", messages: late };
    const expected = [archived(early, at), { ...report, createdAt: at }, archived(late, at + 1)];
    expect((await store.chatRecords("am-on")).content).toEqual(expected);
    const lookup = await store.lookup({ userId: "am-a", from: at - 30, to: at + 1 });
    expect(lookup.content).toEqual(expected);
    const byTime = await store.lookup({ from: at - 10, to: at - 10 });
    expect(byTime.content).toContainEqual(archived(late, at + 1));
  });

  it("counts archived bundles toward the row cap", async () => {
    const at = 80_000;
    const store = storeAt(at, true);
    await store.logChatStart("am-cap", "am-cap-a", "peer", at);
    for (let i = 0; i < 3; i++) {
      await store.archiveMessages("am-cap", [{ from: "p", text: `m${String(i)}`, sentAt: at + i }]);
    }
    await store.snapshotReport("am-cap", "spam", []);
    const capped = await store.lookup({ userId: "am-cap-a", from: at, to: at }, 2);
    expect(capped.content).toHaveLength(2);
    expect(capped.truncated).toBe(true);
  });

  it("marks a lookup cut short instead of loading archived messages past the export cap", async () => {
    const at = 85_000;
    const store = storeAt(at, true);
    await store.logChatStart("am-big", "am-big-a", "peer", at);
    const bundle = Math.ceil(LIMITS.exportMaxMessages / 2) + 100;
    const open = vi.spyOn(ContentArchive.prototype, "open");
    try {
      for (let b = 0; b < 3; b++) {
        await store.archiveMessages(
          "am-big",
          Array.from({ length: bundle }, (_, i) => ({ from: "p", text: "x", sentAt: at + i })),
        );
      }
      const result = await store.lookup({ userId: "am-big-a", from: at, to: at });
      expect(result.truncated).toBe(true);
      expect(open).toHaveBeenCalledTimes(2);
      const chat = await store.chatRecords("am-big");
      expect(chat.content).toHaveLength(2);
    } finally {
      open.mockRestore();
    }
  });

  it("a bundle saved after a takedown or hold inherits that chat's hold", async () => {
    const now = 95_000;
    const store = storeAt(now, true);
    await store.snapshotTakedown("ih-chat", []);
    await store.archiveMessages("ih-chat", [{ from: "x", text: "late", sentAt: now }]);
    const takedownHold = await env.DB.prepare(
      "SELECT hold_until FROM content_archive WHERE chat_id = 'ih-chat'",
    ).first<{ hold_until: number | null }>();
    expect(takedownHold?.hold_until).toBe(now + LIMITS.reportedContentRetentionMs);
    await store.logChatStart("ih-held", "x", "y", now);
    await store.setHold({ chatId: "ih-held" }, now * 9);
    await store.archiveMessages("ih-held", [{ from: "x", text: "late", sentAt: now }]);
    const chatHold = await env.DB.prepare(
      "SELECT hold_until FROM content_archive WHERE chat_id = 'ih-held'",
    ).first<{ hold_until: number | null }>();
    expect(chatHold?.hold_until).toBe(now * 9);
  });

  it("chatRecords splits a long chat into parts of saved messages", async () => {
    const at = 87_000;
    const store = storeAt(at, true);
    await store.logChatStart("pt-chat", "pt-a", "pt-b", at);
    await store.snapshotReport("pt-chat", "spam", [{ from: "pt-a", text: "r", sentAt: at }]);
    const bundle = LIMITS.exportPartMessages / 4;
    for (let b = 0; b < 9; b++) {
      await store.archiveMessages(
        "pt-chat",
        Array.from({ length: bundle }, (_, i) => ({
          from: "pt-b",
          text: `b${String(b)}`,
          sentAt: at + b * bundle + i,
        })),
      );
    }
    const kinds = (records: { content: { kind: string; messages: unknown[] }[] }) =>
      records.content.map((entry) => `${entry.kind}:${String(entry.messages.length)}`);
    const archived = `all_content:${String(bundle)}`;
    const first = await store.chatRecords("pt-chat");
    expect(first.parts).toBe(3);
    expect(kinds(first)).toEqual([...Array<string>(4).fill(archived), "report_snapshot:1"]);
    const second = await store.chatRecords("pt-chat", 2);
    expect(kinds(second)).toEqual(Array<string>(4).fill(archived));
    expect(second.chats).toHaveLength(1);
    expect(kinds(await store.chatRecords("pt-chat", 3))).toEqual([archived]);
    expect((await store.chatRecords("pt-chat", 4)).content).toEqual([]);
    expect((await store.chatRecords("pt-none")).parts).toBe(1);
  });

  it("opens at most a set number of archived bundles in one search", async () => {
    const at = 600_000_000;
    const store = storeAt(at, true);
    const open = vi.spyOn(ContentArchive.prototype, "open");
    try {
      for (let i = 0; i <= LIMITS.archiveLookupMaxBundles; i++) {
        await store.archiveMessages(`mb-${String(i)}`, [{ from: "p", text: "x", sentAt: at }]);
      }
      open.mockClear();
      const result = await store.lookup({ from: at, to: at });
      expect(result.truncated).toBe(true);
      expect(open).toHaveBeenCalledTimes(LIMITS.archiveLookupMaxBundles);
    } finally {
      open.mockRestore();
    }
  });

  it("a time-window search returns only the archived messages sent inside the window", async () => {
    const at = 700_000_000;
    const store = storeAt(at, true);
    await store.archiveMessages("tw-chat", [
      { from: "p", text: "before", sentAt: at + 100 },
      { from: "p", text: "inside", sentAt: at + 200 },
      { from: "p", text: "after", sentAt: at + 300 },
    ]);
    const found = await store.lookup({ from: at + 150, to: at + 250 });
    const entry = found.content.find((record) => record.chatId === "tw-chat");
    expect(entry?.messages.map((m) => m.text)).toEqual(["inside"]);
  });

  it("says a search was cut short when the archive holds more than exactly the cap", async () => {
    const at = 800_000_000;
    const store = storeAt(at, true);
    await store.logChatStart("ex-chat", "ex-a", "ex-b", at);
    const full = LIMITS.archiveFlushMessages;
    for (let b = 0; b <= LIMITS.exportMaxMessages / full; b++) {
      await store.archiveMessages(
        "ex-chat",
        Array.from({ length: full }, (_, i) => ({ from: "ex-a", text: "x", sentAt: at + i })),
      );
    }
    expect((await store.lookup({ userId: "ex-a", from: at, to: at })).truncated).toBe(true);
  });

  it("leaves out archived bundles with no message inside a time window", async () => {
    const at = 900_000_000;
    const store = storeAt(at, true);
    await store.archiveMessages("ew-chat", [
      { from: "p", text: "before", sentAt: at + 100 },
      { from: "p", text: "after", sentAt: at + 300 },
    ]);
    const found = await store.lookup({ from: at + 150, to: at + 250 });
    expect(found.content.filter((record) => record.chatId === "ew-chat")).toEqual([]);
  });

  it("a takedown also holds the chat record so later bundles inherit the hold", async () => {
    const now = 97_000;
    const store = storeAt(now, true);
    await store.logChatStart("tk-chat", "a", "b", now);
    await store.deleteContent("tk-chat", now);
    await store.archiveMessages("tk-chat", [{ from: "a", text: "late", sentAt: now }]);
    const row = await env.DB.prepare(
      "SELECT hold_until FROM content_archive WHERE chat_id = 'tk-chat'",
    ).first<{ hold_until: number | null }>();
    expect(row?.hold_until).toBe(now + LIMITS.reportedContentRetentionMs);
  });

  it("setHold, activeHolds and heldTargets cover archived bundles", async () => {
    const store = storeAt(0, true);
    const until = LIMITS.allContentRetentionMs * 3;
    await store.logChatStart("ah-chat", "ah-a", "ah-b", 0);
    await store.archiveMessages("ah-chat", [{ from: "ah-a", text: "t", sentAt: 0 }]);
    await store.archiveMessages("ah-chat", [{ from: "ah-b", text: "u", sentAt: 1 }]);
    expect(await store.setHold({ userId: "ah-b" }, until)).toBe(3);
    expect(await store.heldTargets(1)).toContain("ah-chat");
    expect(await store.activeHolds(1)).toContainEqual({
      table: "content",
      targetKind: "chat",
      target: "ah-chat",
      until,
      records: 2,
    });
    await store.purgeExpired(LIMITS.allContentRetentionMs * 2);
    expect(await count("content_archive", "chat_id", "ah-chat")).toBe(2);
    const other = storeAt(0, true);
    await other.archiveMessages("ah-chat2", [{ from: "x", text: "v", sentAt: 0 }]);
    expect(await other.setHold({ chatId: "ah-chat2" }, until)).toBe(1);
  });

  it("purgeExpired deletes archived bundles after 1 year and reports the count", async () => {
    const store = storeAt(0, true);
    await store.archiveMessages("ap-chat", [{ from: "x", text: "t", sentAt: 0 }]);
    const oneYear = LIMITS.allContentRetentionMs;
    await store.purgeExpired(oneYear);
    expect(await count("content_archive", "chat_id", "ap-chat")).toBe(1);
    const counts = await store.purgeExpired(oneYear + 1);
    expect(await count("content_archive", "chat_id", "ap-chat")).toBe(0);
    expect(counts.content_archive).toBeGreaterThanOrEqual(1);
  });

  it("a takedown keeps archived bundles as held evidence for 1 year from the takedown", async () => {
    const oneYear = LIMITS.allContentRetentionMs;
    await storeAt(0, true).archiveMessages("td-chat", [{ from: "x", text: "e", sentAt: 0 }]);
    const takedownAt = oneYear - 10;
    const store = storeAt(takedownAt, true);
    await store.snapshotReport("td-chat", "spam", []);
    expect(await store.deleteContent("td-chat", takedownAt)).toEqual({ deleted: 1, held: 1 });
    expect(await count("content_log", "chat_id", "td-chat")).toBe(0);
    await store.purgeExpired(takedownAt + LIMITS.reportedContentRetentionMs - 1);
    expect(await count("content_archive", "chat_id", "td-chat")).toBe(1);
    await store.purgeExpired(takedownAt + LIMITS.reportedContentRetentionMs);
    expect(await count("content_archive", "chat_id", "td-chat")).toBe(0);
  });

  it("purgeExpired honours retention periods and legal holds", async () => {
    const store = storeAt(0);
    await store.logConnection(connection("pg-old", "Old", "1.1.1.1", 0));
    await store.logConnection(connection("pg-held", "Held", "1.1.1.2", 0));
    await store.logChatStart("pg-chat", "pg-old", "x", 0);
    await store.snapshotReport("pg-content", "spam", [{ from: "x", text: "t", sentAt: 0 }]);
    const sixMonths = LIMITS.connectionRetentionMs;
    const oneYear = LIMITS.reportedContentRetentionMs;
    expect(await store.setHold({ userId: "pg-held" }, oneYear * 2)).toBe(1);

    await store.purgeExpired(sixMonths);
    expect(await count("connection_log", "user_id", "pg-old")).toBe(1);

    await store.purgeExpired(sixMonths + 1);
    expect(await count("connection_log", "user_id", "pg-old")).toBe(0);
    expect(await count("chat_log", "chat_id", "pg-chat")).toBe(0);
    expect(await count("content_log", "chat_id", "pg-content")).toBe(1);

    await store.purgeExpired(oneYear);
    expect(await count("content_log", "chat_id", "pg-content")).toBe(1);
    await store.purgeExpired(oneYear + 1);
    expect(await count("content_log", "chat_id", "pg-content")).toBe(0);
    expect(await count("connection_log", "user_id", "pg-held")).toBe(1);

    await store.purgeExpired(oneYear * 2 + 1);
    expect(await count("connection_log", "user_id", "pg-held")).toBe(0);
  });

  it("setHold by chat covers the chat and its content", async () => {
    const store = storeAt(0);
    const longAfter = LIMITS.reportedContentRetentionMs * 2;
    await store.logChatStart("hd-chat", "a", "b", 0);
    await store.snapshotReport("hd-chat", "other", [{ from: "a", text: "t", sentAt: 0 }]);
    expect(await store.setHold({ chatId: "hd-chat" }, longAfter + 1)).toBe(2);
    await store.purgeExpired(longAfter);
    expect(await count("chat_log", "chat_id", "hd-chat")).toBe(1);
    expect(await count("content_log", "chat_id", "hd-chat")).toBe(1);
  });

  it("setHold by user also covers that user's chats and their content", async () => {
    const store = storeAt(0);
    await store.logConnection(connection("hu-a", "Hu", "1.1.1.3", 0));
    await store.logChatStart("hu-chat", "hu-b", "hu-a", 0);
    await store.snapshotReport("hu-chat", "spam", [{ from: "hu-b", text: "t", sentAt: 0 }]);
    expect(await store.setHold({ userId: "hu-a" }, LIMITS.reportedContentRetentionMs * 3)).toBe(3);
  });

  it("a shorter hold never cuts an existing longer one", async () => {
    const store = storeAt(0);
    await store.logConnection(connection("hs-a", "Hs", "1.1.1.4", 0));
    const longHold = LIMITS.connectionRetentionMs * 4;
    await store.setHold({ userId: "hs-a" }, longHold);
    await store.setHold({ userId: "hs-a" }, 1);
    await store.purgeExpired(longHold - 1);
    expect(await count("connection_log", "user_id", "hs-a")).toBe(1);
  });

  it("looks up a nickname shared by more sessions than D1 allows bound parameters", async () => {
    const store = storeAt(50_000);
    const sessions = 120;
    for (let i = 0; i < sessions; i++) {
      await store.logConnection(connection(`many-${String(i)}`, "Popular", "2.2.2.2", 50_000));
      await store.logChatStart(`many-chat-${String(i)}`, `many-${String(i)}`, "peer", 50_000);
      await store.snapshotReport(`many-chat-${String(i)}`, "spam", []);
    }
    const records = await store.lookup({ nickname: "popular", from: 50_000, to: 50_000 });
    expect(records.connections).toHaveLength(sessions);
    expect(records.chats).toHaveLength(sessions);
    expect(records.content).toHaveLength(sessions);
  });

  it("stops at the row cap and says the results were cut short", async () => {
    const store = storeAt(60_000);
    for (let i = 0; i < 5; i++) {
      await store.logConnection(connection(`cap-${String(i)}`, "Capped", "3.3.3.3", 60_000));
      await store.logChatStart(`cap-chat-${String(i)}`, `cap-${String(i)}`, "peer", 60_000);
    }
    const decrypt = vi.spyOn(Encryptor.prototype, "decrypt");
    try {
      const capped = await store.lookup({ nickname: "capped", from: 60_000, to: 60_000 }, 3);
      expect(capped.connections).toHaveLength(3);
      expect(capped.chats).toHaveLength(3);
      expect(capped.truncated).toBe(true);
      expect(decrypt).toHaveBeenCalledTimes(3);
    } finally {
      decrypt.mockRestore();
    }
    const full = await store.lookup({ nickname: "capped", from: 60_000, to: 60_000 }, 5);
    expect(full.truncated).toBe(false);
  });
});
