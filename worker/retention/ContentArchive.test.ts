import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { LIMITS } from "@shared/config";
import type { RetainedMessage } from "@shared/legal/records";
import { archivedMessages } from "../test/archive";
import { ContentArchive } from "./ContentArchive";
import { Encryptor } from "./Encryptor";

const encryptor = new Encryptor(env.RETENTION_KEY);
const archiveAt = (now: number, db: D1Database = env.DB, bucket: R2Bucket = env.ARCHIVE) =>
  new ContentArchive(db, bucket, encryptor, () => now);

const message = (text: string, sentAt: number): RetainedMessage => ({ from: "u1", text, sentAt });

interface IndexRow {
  object_key: string;
  message_count: number;
  first_sent_at: number;
  created_at: number;
}

async function indexRows(chatId: string): Promise<IndexRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT object_key, message_count, first_sent_at, created_at FROM content_archive WHERE chat_id = ? ORDER BY id",
  )
    .bind(chatId)
    .all<IndexRow>();
  return results;
}

async function objectKeys(chatId: string): Promise<string[]> {
  const listed = await env.ARCHIVE.list({ prefix: `chats/${chatId}/` });
  return listed.objects.map((object) => object.key);
}

const failingDb = {
  prepare: () => ({
    bind: () => ({
      run: () => Promise.reject(new Error("d1 down")),
      first: () => Promise.reject(new Error("d1 down")),
    }),
  }),
} as unknown as D1Database;

const dbThatCommitsThenFails = {
  prepare: (sql: string) => {
    const statement = env.DB.prepare(sql);
    if (!sql.startsWith("UPDATE content_archive SET stored = 1")) return statement;
    return {
      bind: (...values: unknown[]) => ({
        run: async () => {
          await statement.bind(...values).run();
          throw new Error("timeout after commit");
        },
      }),
    };
  },
} as unknown as D1Database;

const texts = (count: number, sentAt: number) =>
  Array.from({ length: count }, (_, i) => message(`t${String(i)}`, sentAt + i));

const bucketFailingDeletes = {
  delete: () => Promise.reject(new Error("r2 down")),
} as unknown as R2Bucket;

const bucketFailingPuts = {
  put: () => Promise.reject(new Error("r2 down")),
} as unknown as R2Bucket;

async function visibleRows(chatId: string) {
  return archiveAt(1).rowsForChats([chatId], Number.MAX_SAFE_INTEGER, 100);
}

describe("ContentArchive", () => {
  it("stores a bundle in R2 and one index row in D1", async () => {
    const messages = [message("hello there", 50), message("hi back", 60)];
    await archiveAt(1_000).store("ca-store", messages);
    const rows = await indexRows("ca-store");
    expect(rows).toEqual([
      {
        object_key: expect.stringMatching(/^chats\/ca-store\/50-[0-9a-f-]{36}$/) as string,
        message_count: 2,
        first_sent_at: 50,
        created_at: 1_000,
      },
    ]);
    const object = await env.ARCHIVE.get(rows[0]?.object_key ?? "");
    const stored = new TextDecoder().decode(await object?.arrayBuffer());
    expect(stored).not.toContain("hello there");
  });

  it("stores nothing for an empty batch", async () => {
    await archiveAt(1).store("ca-empty", []);
    expect(await indexRows("ca-empty")).toEqual([]);
  });

  it("returns all bundles of a chat in sent order", async () => {
    const archive = archiveAt(1);
    await archive.store("ca-order", [message("third", 300), message("fourth", 400)]);
    await archive.store("ca-order", [message("first", 100), message("second", 200)]);
    expect((await archivedMessages(archive, "ca-order")).map((m) => m.text)).toEqual([
      "first",
      "second",
      "third",
      "fourth",
    ]);
  });

  it("writes nothing to R2 when the index row cannot be written", async () => {
    await expect(archiveAt(1, failingDb).store("ca-orphan", [message("lost?", 1)])).rejects.toThrow(
      "d1 down",
    );
    expect(await objectKeys("ca-orphan")).toEqual([]);
  });

  it("saving the same batch again after a reported error keeps one bundle", async () => {
    const batch = [message("kept", 7)];
    await expect(
      archiveAt(1, dbThatCommitsThenFails).store("ca-committed", batch, "1-1"),
    ).rejects.toThrow("timeout after commit");
    await archiveAt(2).store("ca-committed", batch, "1-1");
    await archiveAt(3).store("ca-committed", batch, "1-1");
    expect(await indexRows("ca-committed")).toHaveLength(1);
    expect(await objectKeys("ca-committed")).toHaveLength(1);
    expect((await archivedMessages(archiveAt(1), "ca-committed")).map((m) => m.text)).toEqual([
      "kept",
    ]);
  });

  it("hides a bundle whose file never saved and purges it after a day", async () => {
    const created = 20_000;
    await expect(
      archiveAt(created, env.DB, bucketFailingPuts).store("ca-unsaved", [message("u", 1)], "1-1"),
    ).rejects.toThrow("r2 down");
    expect(await indexRows("ca-unsaved")).toHaveLength(1);
    expect(await visibleRows("ca-unsaved")).toEqual([]);
    await archiveAt(created).purgeExpired(created + LIMITS.archiveUnconfirmedMs - 1);
    expect(await indexRows("ca-unsaved")).toHaveLength(1);
    await archiveAt(created).purgeExpired(created + LIMITS.archiveUnconfirmedMs + 1);
    expect(await indexRows("ca-unsaved")).toEqual([]);
  });

  it("a retry of a day-old unconfirmed batch is not taken by a purge running meanwhile", async () => {
    const created = 30_000;
    await expect(
      archiveAt(created, env.DB, bucketFailingPuts).store("ca-race", [message("r", 1)], "1-1"),
    ).rejects.toThrow("r2 down");
    const later = created + LIMITS.archiveUnconfirmedMs + 10;
    const purgingDuringPut = {
      put: async (key: string, value: Uint8Array) => {
        await archiveAt(later).purgeExpired(later);
        return env.ARCHIVE.put(key, value);
      },
    } as unknown as R2Bucket;
    await archiveAt(later, env.DB, purgingDuringPut).store("ca-race", [message("r", 1)], "1-1");
    expect(await visibleRows("ca-race")).toHaveLength(1);
    expect(await objectKeys("ca-race")).toHaveLength(1);
  });

  it("fails loudly when its row vanished before the save was confirmed", async () => {
    const deletingDuringPut = {
      put: async (key: string, value: Uint8Array) => {
        await env.DB.prepare("DELETE FROM content_archive WHERE object_key = ?").bind(key).run();
        return env.ARCHIVE.put(key, value);
      },
    } as unknown as R2Bucket;
    await expect(
      archiveAt(1, env.DB, deletingDuringPut).store("ca-vanish", [message("v", 1)], "1-1"),
    ).rejects.toThrow();
  });

  it("a time-window search skips bundles that started too long before the window", async () => {
    const span = LIMITS.archiveBundleMaxSpanMs;
    const archive = archiveAt(1);
    await archive.store("ca-span", [message("old", 1_000), message("late", 1_000 + span + 500)]);
    const found = async (from: number) =>
      (await archive.rowsBetween(from, from + 10, Number.MAX_SAFE_INTEGER, 100)).filter(
        (row) => row.chat_id === "ca-span",
      );
    expect(await found(1_000 + span - 10)).toHaveLength(1);
    expect(await found(1_000 + span + 100)).toEqual([]);
  });

  it("finds bundles in a time window by when their messages were sent, not when they were saved", async () => {
    const saved = 900_000;
    const archive = archiveAt(saved);
    await archive.store("ca-window", [message("a", 100_000), message("b", 200_000)]);
    await archive.store("ca-window", [message("c", 500_000)]);
    const keys = async (from: number, to: number) =>
      (await archive.rowsBetween(from, to, Number.MAX_SAFE_INTEGER, 100))
        .filter((row) => row.chat_id === "ca-window")
        .map((row) => row.message_count);
    expect(await keys(150_000, 160_000)).toEqual([2]);
    expect(await keys(200_001, 400_000)).toEqual([]);
    expect(await keys(saved, saved)).toEqual([]);
    expect(await keys(0, 600_000)).toEqual([2, 1]);
  });

  it("stops loading bundles once the message cap is passed", async () => {
    const archive = archiveAt(1);
    for (let i = 0; i < 3; i++) await archive.store("ca-cap", texts(2, i * 10));
    const counts = async (maxMessages: number) =>
      (await archive.rowsForChats(["ca-cap"], maxMessages, 100)).map((row) => row.message_count);
    expect(await counts(3)).toEqual([2, 2]);
    expect(await counts(4)).toEqual([2, 2]);
    expect(await counts(5)).toEqual([2, 2, 2]);
  });

  it("purgeExpired removes bundles older than 1 year, objects first, and skips held ones", async () => {
    const created = 5_000;
    await archiveAt(created).store("ca-old", [message("old", 1)]);
    await archiveAt(created).store("ca-held", [message("held", 1)]);
    await archiveAt(created + 10).store("ca-young", [message("young", 1)]);
    await env.DB.prepare("UPDATE content_archive SET hold_until = ? WHERE chat_id = 'ca-held'")
      .bind(Number.MAX_SAFE_INTEGER)
      .run();
    const now = created + LIMITS.allContentRetentionMs + 5;
    const deleted = await archiveAt(now).purgeExpired(now);
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await indexRows("ca-old")).toEqual([]);
    expect(await objectKeys("ca-old")).toEqual([]);
    expect(await indexRows("ca-held")).toHaveLength(1);
    expect(await objectKeys("ca-held")).toHaveLength(1);
    expect(await indexRows("ca-young")).toHaveLength(1);
    expect(await objectKeys("ca-young")).toHaveLength(1);
  });

  it("purgeExpired keeps going past 20 batches in one run", async () => {
    const created = 11_000;
    const small = new ContentArchive(env.DB, env.ARCHIVE, encryptor, () => created, 2);
    for (let i = 0; i < 45; i++) await small.store("ca-many", [message("x", i)]);
    const now = created + LIMITS.allContentRetentionMs + 1;
    await new ContentArchive(env.DB, env.ARCHIVE, encryptor, () => now, 2).purgeExpired(now);
    expect(await indexRows("ca-many")).toEqual([]);
    expect(await objectKeys("ca-many")).toEqual([]);
  });

  it("keeps the index row when deleting its object fails, so the next purge retries", async () => {
    const created = 9_000;
    await archiveAt(created).store("ca-retry", [message("retry", 1)]);
    const now = created + LIMITS.allContentRetentionMs + 1;
    await expect(archiveAt(now, env.DB, bucketFailingDeletes).purgeExpired(now)).rejects.toThrow(
      "r2 down",
    );
    expect(await indexRows("ca-retry")).toHaveLength(1);
    expect(await visibleRows("ca-retry")).toEqual([]);
    await archiveAt(now).purgeExpired(now + LIMITS.archiveUnconfirmedMs);
    expect(await indexRows("ca-retry")).toEqual([]);
    expect(await objectKeys("ca-retry")).toEqual([]);
  });
});
