import { LIMITS } from "@shared/config";
import type { RetainedMessage } from "@shared/legal/records";
import { openBundle, sealBundle } from "./bundle";
import type { Encryptor } from "./Encryptor";

export interface ArchiveRow {
  chat_id: string;
  object_key: string;
  message_count: number;
  created_at: number;
}

const R2_DELETE_MAX_KEYS = 1_000;
const PURGE_MAX_ROUNDS = 1_000;
const ARCHIVE_ORDER = "created_at, first_sent_at, id";
const CHATS_FILTER = "chat_id IN (SELECT value FROM json_each(?1))";
const WINDOW_FILTER = "first_sent_at BETWEEN ?3 AND ?2 AND last_sent_at >= ?1";

const CLAIM_ROW_SQL = `INSERT INTO content_archive
    (chat_id, object_key, message_count, first_sent_at, last_sent_at, created_at, hold_until)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, (
    SELECT MAX(hold_until) FROM (
      SELECT hold_until FROM content_archive WHERE chat_id = ?1
      UNION ALL SELECT hold_until FROM content_log WHERE chat_id = ?1
      UNION ALL SELECT hold_until FROM chat_log WHERE chat_id = ?1
    )
  ))
  ON CONFLICT (object_key) DO UPDATE SET
    created_at = CASE WHEN stored = 0 THEN excluded.created_at ELSE created_at END
  RETURNING stored`;

const PURGEABLE = `((stored = 1 AND created_at < ?1 AND (hold_until IS NULL OR hold_until <= ?2))
  OR (stored = 0 AND created_at < ?3))`;

const PURGE_SELECT_SQL = `SELECT id FROM content_archive WHERE ${PURGEABLE} ORDER BY id LIMIT ?4`;

const PURGE_HIDE_SQL = `UPDATE content_archive SET stored = 0
  WHERE id IN (SELECT value FROM json_each(?4)) AND ${PURGEABLE}
  RETURNING id, object_key`;

function rowsStartingInMessageRange(filter: string, firstRangeParam: number): string {
  const from = `?${String(firstRangeParam)}`;
  const until = `?${String(firstRangeParam + 1)}`;
  const limit = `?${String(firstRangeParam + 2)}`;
  return `SELECT chat_id, object_key, message_count, created_at FROM (
    SELECT chat_id, object_key, message_count, created_at, first_sent_at, id,
      SUM(message_count) OVER (ORDER BY ${ARCHIVE_ORDER} ROWS UNBOUNDED PRECEDING) AS running
    FROM content_archive WHERE stored = 1 AND ${filter}
  ) WHERE running - message_count >= ${from} AND running - message_count < ${until}
    ORDER BY ${ARCHIVE_ORDER} LIMIT ${limit}`;
}

export class ContentArchive {
  constructor(
    private readonly db: D1Database,
    private readonly bucket: R2Bucket,
    private readonly encryptor: Encryptor,
    private readonly now: () => number,
    private readonly purgeBatchSize: number = R2_DELETE_MAX_KEYS,
  ) {}

  async store(
    chatId: string,
    messages: RetainedMessage[],
    batchKey: string = crypto.randomUUID(),
  ): Promise<void> {
    if (messages.length === 0) return;
    const sentAt = messages.map((message) => message.sentAt);
    const firstSentAt = Math.min(...sentAt);
    const lastSentAt = Math.max(...sentAt);
    const objectKey = `chats/${chatId}/${String(firstSentAt)}-${batchKey}`;
    const claimed = await this.db
      .prepare(CLAIM_ROW_SQL)
      .bind(chatId, objectKey, messages.length, firstSentAt, lastSentAt, this.now())
      .first<{ stored: number }>();
    if (claimed?.stored === 1) return;
    await this.bucket.put(objectKey, await sealBundle(this.encryptor, messages));
    const confirmed = await this.db
      .prepare("UPDATE content_archive SET stored = 1 WHERE object_key = ?")
      .bind(objectKey)
      .run();
    if (confirmed.meta.changes !== 1) throw new Error("Archive row vanished before confirming");
  }

  async open(row: ArchiveRow): Promise<RetainedMessage[]> {
    const object = await this.bucket.get(row.object_key);
    if (!object) throw new Error("Archived bundle missing");
    return openBundle(this.encryptor, new Uint8Array(await object.arrayBuffer()));
  }

  async rowsForChats(
    chatIds: readonly string[],
    maxMessages: number,
    limit: number,
  ): Promise<ArchiveRow[]> {
    if (chatIds.length === 0) return [];
    const { results } = await this.db
      .prepare(rowsStartingInMessageRange(CHATS_FILTER, 2))
      .bind(JSON.stringify(chatIds), 0, maxMessages, limit)
      .all<ArchiveRow>();
    return results;
  }

  async rowsForChatPart(chatId: string, part: number, partMessages: number): Promise<ArchiveRow[]> {
    const { results } = await this.db
      .prepare(rowsStartingInMessageRange(CHATS_FILTER, 2))
      .bind(
        JSON.stringify([chatId]),
        (part - 1) * partMessages,
        part * partMessages,
        Number.MAX_SAFE_INTEGER,
      )
      .all<ArchiveRow>();
    return results;
  }

  async messageTotal(chatId: string): Promise<number> {
    const row = await this.db
      .prepare(
        "SELECT COALESCE(SUM(message_count), 0) AS total FROM content_archive WHERE stored = 1 AND chat_id = ?",
      )
      .bind(chatId)
      .first<{ total: number }>();
    return row?.total ?? 0;
  }

  async rowsBetween(
    from: number,
    to: number,
    maxMessages: number,
    limit: number,
  ): Promise<ArchiveRow[]> {
    const { results } = await this.db
      .prepare(rowsStartingInMessageRange(WINDOW_FILTER, 4))
      .bind(from, to, from - LIMITS.archiveBundleMaxSpanMs, 0, maxMessages, limit)
      .all<ArchiveRow>();
    return results;
  }

  async purgeExpired(now: number): Promise<number> {
    const cutoff = now - LIMITS.allContentRetentionMs;
    const unconfirmedCutoff = now - LIMITS.archiveUnconfirmedMs;
    let deleted = 0;
    for (let round = 0; round < PURGE_MAX_ROUNDS; round++) {
      const { results: candidates } = await this.db
        .prepare(PURGE_SELECT_SQL)
        .bind(cutoff, now, unconfirmedCutoff, this.purgeBatchSize)
        .all<{ id: number }>();
      if (candidates.length === 0) break;
      const { results: hidden } = await this.db
        .prepare(PURGE_HIDE_SQL)
        .bind(cutoff, now, unconfirmedCutoff, JSON.stringify(candidates.map((row) => row.id)))
        .all<{ id: number; object_key: string }>();
      if (hidden.length > 0) {
        await this.bucket.delete(hidden.map((row) => row.object_key));
        await this.db
          .prepare(
            "DELETE FROM content_archive WHERE stored = 0 AND id IN (SELECT value FROM json_each(?))",
          )
          .bind(JSON.stringify(hidden.map((row) => row.id)))
          .run();
      }
      deleted += hidden.length;
      if (candidates.length < this.purgeBatchSize) break;
    }
    return deleted;
  }
}
