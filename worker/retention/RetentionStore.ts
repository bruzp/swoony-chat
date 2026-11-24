import { LIMITS, type ReportReason } from "@shared/config";
import { nicknameKey } from "@shared/profile";
import type { ActiveHold } from "@shared/protocol/admin";
import type { ContentKind, LegalQuery, LegalRecords, RetainedMessage } from "@shared/legal/records";
import type { IdentityHasher } from "../moderation/identityHash";
import type { ArchiveRow, ContentArchive } from "./ContentArchive";
import type { Encryptor } from "./Encryptor";

export interface ConnectionLogEntry {
  userId: string;
  deviceHash: string;
  nickname: string;
  ip: string;
  country: string;
  detectedCountry: string | null;
  joinedAt: number;
}

interface ConnectionPayload {
  nickname: string;
  ip: string;
  country: string;
  detectedCountry?: string | null;
}

interface ConnectionRow {
  user_id: string;
  payload: string;
  joined_at: number;
  left_at: number | null;
}

interface ChatRow {
  chat_id: string;
  user_a: string;
  user_b: string;
  started_at: number;
  ended_at: number | null;
}

interface ContentRow {
  chat_id: string;
  kind: ContentKind;
  report_reason: ReportReason | null;
  payload: string;
  created_at: number;
}

function archivedMessages(rows: ArchiveRow[]): number {
  return rows.reduce((total, row) => total + row.message_count, 0);
}

function byCreatedAt(
  archiveRows: ArchiveRow[],
  contentRows: ContentRow[],
): (ArchiveRow | ContentRow)[] {
  return [...archiveRows, ...contentRows].sort((a, b) => a.created_at - b.created_at);
}

function toChat(row: ChatRow): LegalRecords["chats"][number] {
  return {
    chatId: row.chat_id,
    userA: row.user_a,
    userB: row.user_b,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

type RetainedTable = "connection_log" | "chat_log" | "content_log" | "content_archive";

type ContentRecord = LegalRecords["content"][number];

const LOG_UPDATE_CHUNK = 500;
const ACTIVE_HOLDS_SQL = `
  SELECT 'connections' AS tbl, 'user' AS target_kind, user_id AS target, MAX(hold_until) AS until, COUNT(*) AS records
    FROM connection_log WHERE hold_until > ?1 GROUP BY user_id
  UNION ALL
  SELECT 'chats', 'chat', chat_id, MAX(hold_until), COUNT(*)
    FROM chat_log WHERE hold_until > ?1 GROUP BY chat_id
  UNION ALL
  SELECT 'content', 'chat', chat_id, MAX(hold_until), COUNT(*)
    FROM (
      SELECT chat_id, hold_until FROM content_log WHERE hold_until > ?1
      UNION ALL
      SELECT chat_id, hold_until FROM content_archive WHERE hold_until > ?1
    ) GROUP BY chat_id
  ORDER BY until DESC LIMIT ?2`;

interface ActiveHoldRow {
  tbl: ActiveHold["table"];
  target_kind: ActiveHold["targetKind"];
  target: string;
  until: number;
  records: number;
}

const JSON_LIST_PARAM_3 = "(SELECT value FROM json_each(?3))";
const KEEP_LONGER_HOLD = "hold_until = MAX(COALESCE(hold_until, 0), ?2)";

export class RetentionStore {
  constructor(
    private readonly db: D1Database,
    private readonly encryptor: Encryptor,
    private readonly hasher: IdentityHasher,
    private readonly now: () => number,
    private readonly retainAllContent: boolean,
    private readonly archive: ContentArchive,
  ) {}

  get retainsAllContent(): boolean {
    return this.retainAllContent;
  }

  async logConnection(record: ConnectionLogEntry): Promise<void> {
    const payload: ConnectionPayload = {
      nickname: record.nickname,
      ip: record.ip,
      country: record.country,
      detectedCountry: record.detectedCountry,
    };
    const [nicknameHash, encrypted] = await Promise.all([
      this.hasher.hash(nicknameKey(record.nickname)),
      this.encryptor.encrypt(payload),
    ]);
    await this.db
      .prepare(
        "INSERT INTO connection_log (user_id, device_hash, nickname_hash, payload, joined_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(record.userId, record.deviceHash, nicknameHash, encrypted, record.joinedAt)
      .run();
  }

  async logDisconnect(userIds: readonly string[], leftAt: number): Promise<void> {
    await this.updateInChunks(
      `UPDATE connection_log SET left_at = ?1
       WHERE left_at IS NULL AND user_id IN (SELECT value FROM json_each(?2))`,
      leftAt,
      userIds,
    );
  }

  private async updateInChunks(sql: string, at: number, ids: readonly string[]): Promise<void> {
    const chunks: string[][] = [];
    for (let start = 0; start < ids.length; start += LOG_UPDATE_CHUNK) {
      chunks.push(ids.slice(start, start + LOG_UPDATE_CHUNK));
    }
    const results = await Promise.allSettled(
      chunks.map((chunk) => this.db.prepare(sql).bind(at, JSON.stringify(chunk)).run()),
    );
    const failed = results.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
  }

  async logChatStart(chatId: string, userA: string, userB: string, at: number): Promise<void> {
    await this.db
      .prepare("INSERT INTO chat_log (chat_id, user_a, user_b, started_at) VALUES (?, ?, ?, ?)")
      .bind(chatId, userA, userB, at)
      .run();
  }

  async logChatEnd(chatIds: readonly string[], at: number): Promise<void> {
    await this.updateInChunks(
      `UPDATE chat_log SET ended_at = ?1
       WHERE ended_at IS NULL AND chat_id IN (SELECT value FROM json_each(?2))`,
      at,
      chatIds,
    );
  }

  async snapshotReport(
    chatId: string,
    reason: ReportReason,
    messages: RetainedMessage[],
  ): Promise<void> {
    await this.insertContent(chatId, "report_snapshot", reason, messages);
  }

  async snapshotTakedown(chatId: string, messages: RetainedMessage[]): Promise<void> {
    const holdUntil = this.now() + LIMITS.reportedContentRetentionMs;
    await this.insertContent(chatId, "takedown_snapshot", null, messages, holdUntil);
  }

  async archiveMessages(
    chatId: string,
    messages: RetainedMessage[],
    batchKey?: string,
  ): Promise<void> {
    if (!this.retainAllContent) return;
    await this.archive.store(chatId, messages, batchKey);
  }

  async setHold(target: { userId?: string; chatId?: string }, until: number): Promise<number> {
    const statements: D1PreparedStatement[] = [];
    if (target.userId !== undefined) {
      const userChats = "SELECT chat_id FROM chat_log WHERE user_a = ?1 OR user_b = ?1";
      statements.push(
        this.db
          .prepare(`UPDATE connection_log SET ${KEEP_LONGER_HOLD} WHERE user_id = ?1`)
          .bind(target.userId, until),
        this.db
          .prepare(`UPDATE content_log SET ${KEEP_LONGER_HOLD} WHERE chat_id IN (${userChats})`)
          .bind(target.userId, until),
        this.db
          .prepare(`UPDATE content_archive SET ${KEEP_LONGER_HOLD} WHERE chat_id IN (${userChats})`)
          .bind(target.userId, until),
        this.db
          .prepare(`UPDATE chat_log SET ${KEEP_LONGER_HOLD} WHERE user_a = ?1 OR user_b = ?1`)
          .bind(target.userId, until),
      );
    }
    if (target.chatId !== undefined) {
      statements.push(
        this.db
          .prepare(`UPDATE chat_log SET ${KEEP_LONGER_HOLD} WHERE chat_id = ?1`)
          .bind(target.chatId, until),
        this.db
          .prepare(`UPDATE content_log SET ${KEEP_LONGER_HOLD} WHERE chat_id = ?1`)
          .bind(target.chatId, until),
        this.db
          .prepare(`UPDATE content_archive SET ${KEEP_LONGER_HOLD} WHERE chat_id = ?1`)
          .bind(target.chatId, until),
      );
    }
    if (statements.length === 0) return 0;
    const results = await this.db.batch(statements);
    return results.reduce((total, result) => total + result.meta.changes, 0);
  }

  async heldTargets(now: number): Promise<string[]> {
    const { results } = await this.db
      .prepare(
        `SELECT user_id AS target FROM connection_log WHERE hold_until > ?1
         UNION SELECT chat_id FROM chat_log WHERE hold_until > ?1
         UNION SELECT chat_id FROM content_log WHERE hold_until > ?1
         UNION SELECT chat_id FROM content_archive WHERE hold_until > ?1`,
      )
      .bind(now)
      .all<{ target: string }>();
    return results.map((row) => row.target);
  }

  async activeHolds(now: number): Promise<ActiveHold[]> {
    const { results } = await this.db
      .prepare(ACTIVE_HOLDS_SQL)
      .bind(now, LIMITS.activeHoldsShown)
      .all<ActiveHoldRow>();
    return results.map((row) => ({
      table: row.tbl,
      targetKind: row.target_kind,
      target: row.target,
      until: row.until,
      records: row.records,
    }));
  }

  async lookup(
    query: LegalQuery,
    cap: number = LIMITS.exportMaxRows,
  ): Promise<LegalRecords & { truncated: boolean }> {
    let truncated = false;
    const capped = <T>(rows: T[]): T[] => {
      if (rows.length <= cap) return rows;
      truncated = true;
      return rows.slice(0, cap);
    };
    const connections = await Promise.all(
      capped(await this.findConnections(query, cap + 1)).map((row) => this.toConnection(row)),
    );
    const filtersByUser = query.nickname !== undefined || query.userId !== undefined;
    const userIds = filtersByUser
      ? [...new Set([...connections.map((c) => c.userId), ...(query.userId ? [query.userId] : [])])]
      : null;
    const chats = capped(await this.findChats(query, userIds, cap + 1));
    const chatIds = userIds ? chats.map((chat) => chat.chatId) : null;
    const bundleLimit = LIMITS.archiveLookupMaxBundles + 1;
    const [contentRows, foundArchiveRows] = await Promise.all([
      this.findContent(query, chatIds, cap + 1),
      chatIds
        ? this.archive.rowsForChats(chatIds, LIMITS.exportMaxMessages + 1, bundleLimit)
        : this.archive.rowsBetween(query.from, query.to, LIMITS.exportMaxMessages + 1, bundleLimit),
    ]);
    const archiveRows = foundArchiveRows.slice(0, LIMITS.archiveLookupMaxBundles);
    if (
      foundArchiveRows.length > archiveRows.length ||
      archivedMessages(archiveRows) > LIMITS.exportMaxMessages
    ) {
      truncated = true;
    }
    const window = chatIds ? null : query;
    const content = (
      await Promise.all(
        capped(byCreatedAt(archiveRows, contentRows)).map((row) => this.toAnyContent(row, window)),
      )
    ).filter((record) => record.kind !== "all_content" || record.messages.length > 0);
    return { connections, chats, content, truncated };
  }

  async chatRecords(chatId: string, part = 1): Promise<LegalRecords & { parts: number }> {
    const [{ results: chatRows }, { results: contentRows }, archiveRows, total] = await Promise.all(
      [
        this.db
          .prepare("SELECT * FROM chat_log WHERE chat_id = ? ORDER BY started_at")
          .bind(chatId)
          .all<ChatRow>(),
        this.db
          .prepare("SELECT * FROM content_log WHERE chat_id = ?1 AND ?2 = 1 ORDER BY created_at")
          .bind(chatId, part)
          .all<ContentRow>(),
        this.archive.rowsForChatPart(chatId, part, LIMITS.exportPartMessages),
        this.archive.messageTotal(chatId),
      ],
    );
    const chats = chatRows.map(toChat);
    const userIds = [...new Set(chats.flatMap((chat) => [chat.userA, chat.userB]))];
    const { results: connectionRows } = await this.db
      .prepare(
        "SELECT * FROM connection_log WHERE user_id IN (SELECT value FROM json_each(?)) ORDER BY joined_at",
      )
      .bind(JSON.stringify(userIds))
      .all<ConnectionRow>();
    const [connections, content] = await Promise.all([
      Promise.all(connectionRows.map((row) => this.toConnection(row))),
      Promise.all(byCreatedAt(archiveRows, contentRows).map((row) => this.toAnyContent(row))),
    ]);
    const parts = Math.max(1, Math.ceil(total / LIMITS.exportPartMessages));
    return { connections, chats, content, parts };
  }

  async latestConnection(userId: string): Promise<{ deviceHash: string; ip: string } | null> {
    const row = await this.db
      .prepare(
        "SELECT device_hash, payload FROM connection_log WHERE user_id = ? ORDER BY joined_at DESC LIMIT 1",
      )
      .bind(userId)
      .first<{ device_hash: string; payload: string }>();
    if (!row) return null;
    const payload = await this.encryptor.decrypt<ConnectionPayload>(row.payload);
    return { deviceHash: row.device_hash, ip: payload.ip };
  }

  async deleteContent(chatId: string, now: number): Promise<{ deleted: number; held: number }> {
    const evidenceUntil = now + LIMITS.reportedContentRetentionMs;
    const [deleted, , , held] = await this.db.batch<{ n: number }>([
      this.db
        .prepare(
          "DELETE FROM content_log WHERE chat_id = ?1 AND (hold_until IS NULL OR hold_until <= ?2)",
        )
        .bind(chatId, now),
      this.db
        .prepare(`UPDATE content_archive SET ${KEEP_LONGER_HOLD} WHERE chat_id = ?1`)
        .bind(chatId, evidenceUntil),
      this.db
        .prepare(`UPDATE chat_log SET ${KEEP_LONGER_HOLD} WHERE chat_id = ?1`)
        .bind(chatId, evidenceUntil),
      this.db
        .prepare(
          `SELECT (SELECT COUNT(*) FROM content_log WHERE chat_id = ?1)
                + (SELECT COUNT(*) FROM content_archive WHERE chat_id = ?1) AS n`,
        )
        .bind(chatId),
    ]);
    return { deleted: deleted?.meta.changes ?? 0, held: held?.results[0]?.n ?? 0 };
  }

  async purgeExpired(now: number): Promise<Record<RetainedTable, number>> {
    const connectionCutoff = now - LIMITS.connectionRetentionMs;
    const contentCutoff = now - LIMITS.reportedContentRetentionMs;
    const notHeld = "(hold_until IS NULL OR hold_until <= ?2)";
    const [connections, chats, content] = await this.db.batch([
      this.db
        .prepare(`DELETE FROM connection_log WHERE joined_at < ?1 AND ${notHeld}`)
        .bind(connectionCutoff, now),
      this.db
        .prepare(`DELETE FROM chat_log WHERE started_at < ?1 AND ${notHeld}`)
        .bind(connectionCutoff, now),
      this.db
        .prepare(`DELETE FROM content_log WHERE created_at < ?1 AND ${notHeld}`)
        .bind(contentCutoff, now),
    ]);
    return {
      connection_log: connections?.meta.changes ?? 0,
      chat_log: chats?.meta.changes ?? 0,
      content_log: content?.meta.changes ?? 0,
      content_archive: await this.archive.purgeExpired(now),
    };
  }

  private async insertContent(
    chatId: string,
    kind: ContentKind,
    reason: ReportReason | null,
    messages: RetainedMessage[],
    holdUntil: number | null = null,
  ): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO content_log (chat_id, kind, report_reason, payload, created_at, hold_until) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(chatId, kind, reason, await this.encryptor.encrypt(messages), this.now(), holdUntil)
      .run();
  }

  private async findConnections(query: LegalQuery, limit: number): Promise<ConnectionRow[]> {
    let sql = "SELECT * FROM connection_log WHERE joined_at BETWEEN ? AND ?";
    const params: (string | number)[] = [query.from, query.to];
    if (query.userId !== undefined) {
      sql += " AND user_id = ?";
      params.push(query.userId);
    }
    if (query.nickname !== undefined) {
      sql += " AND nickname_hash = ?";
      params.push(await this.hasher.hash(nicknameKey(query.nickname)));
    }
    const { results } = await this.db
      .prepare(`${sql} ORDER BY joined_at LIMIT ?`)
      .bind(...params, limit)
      .all<ConnectionRow>();
    return results;
  }

  private async toConnection(row: ConnectionRow): Promise<LegalRecords["connections"][number]> {
    const payload = await this.encryptor.decrypt<ConnectionPayload>(row.payload);
    return {
      userId: row.user_id,
      nickname: payload.nickname,
      ip: payload.ip,
      country: payload.country,
      detectedCountry: payload.detectedCountry ?? null,
      joinedAt: row.joined_at,
      leftAt: row.left_at,
    };
  }

  private async findChats(
    query: LegalQuery,
    userIds: string[] | null,
    limit: number,
  ): Promise<LegalRecords["chats"]> {
    if (userIds?.length === 0) return [];
    let sql = "SELECT * FROM chat_log WHERE started_at BETWEEN ?1 AND ?2";
    const params: (string | number)[] = [query.from, query.to];
    if (userIds) {
      sql += ` AND (user_a IN ${JSON_LIST_PARAM_3} OR user_b IN ${JSON_LIST_PARAM_3})`;
      params.push(JSON.stringify(userIds));
    }
    params.push(limit);
    const { results } = await this.db
      .prepare(`${sql} ORDER BY started_at LIMIT ?${String(params.length)}`)
      .bind(...params)
      .all<ChatRow>();
    return results.map(toChat);
  }

  private async findContent(
    query: LegalQuery,
    chatIds: string[] | null,
    limit: number,
  ): Promise<ContentRow[]> {
    if (chatIds?.length === 0) return [];
    let sql = "SELECT * FROM content_log";
    const params: (string | number)[] = [];
    if (chatIds) {
      sql += " WHERE chat_id IN (SELECT value FROM json_each(?))";
      params.push(JSON.stringify(chatIds));
    } else {
      sql += " WHERE created_at BETWEEN ? AND ?";
      params.push(query.from, query.to);
    }
    const { results } = await this.db
      .prepare(`${sql} ORDER BY created_at LIMIT ?`)
      .bind(...params, limit)
      .all<ContentRow>();
    return results;
  }

  private async toAnyContent(
    row: ArchiveRow | ContentRow,
    window: { from: number; to: number } | null = null,
  ): Promise<ContentRecord> {
    if ("object_key" in row) {
      const messages = await this.archive.open(row);
      return {
        chatId: row.chat_id,
        kind: "all_content",
        reason: null,
        messages: window
          ? messages.filter((m) => m.sentAt >= window.from && m.sentAt <= window.to)
          : messages,
        createdAt: row.created_at,
      };
    }
    return this.toContent(row);
  }

  private async toContent(row: ContentRow): Promise<ContentRecord> {
    return {
      chatId: row.chat_id,
      kind: row.kind,
      reason: row.report_reason,
      messages: await this.encryptor.decrypt<RetainedMessage[]>(row.payload),
      createdAt: row.created_at,
    };
  }
}
