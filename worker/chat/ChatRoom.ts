import { LIMITS } from "@shared/config";
import {
  CHAT_ENDED_CLOSE_CODE,
  chatClientMessageSchema,
  type ChatClientMessage,
  type ChatMessage,
  type ChatMessageForViewer,
  type ChatServerMessage,
} from "@shared/protocol/chat";
import { moderateText } from "@shared/text/moderateText";
import { normalizeForChecks } from "@shared/text/normalize";
import { DurableObject } from "cloudflare:workers";
import { createDeps, type AppDeps } from "../deps";
import { lobbyStub } from "../lobby/lobbyStub";
import type { RetainedMessage } from "@shared/legal/records";
import { sha256Hex } from "../support/hash";
import { MemoryRateLimiter } from "../support/rateLimit";
import { closeQuietly, frameBytes, isOpen, makeRoomForSocket, parseFrame } from "../support/socket";

export const USER_HEADER = "X-Swoony-User";
export const PEER_HEADER = "X-Swoony-Peer";

const TOUCH_INTERVAL_MS = 60_000;
const RENOTIFY_INTERVAL_MS = 30_000;

const graphemes = new Intl.Segmenter();

function visibleLength(text: string): number {
  return Array.from(graphemes.segment(text)).length;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user TEXT NOT NULL,
  client_id TEXT,
  text TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  wipe_at INTEGER
);
CREATE TABLE IF NOT EXISTS meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  created_at INTEGER NOT NULL,
  user_a TEXT NOT NULL,
  user_b TEXT NOT NULL,
  sent_a INTEGER NOT NULL DEFAULT 0,
  sent_b INTEGER NOT NULL DEFAULT 0,
  orphaned_at INTEGER,
  ended_at INTEGER
);
CREATE TABLE IF NOT EXISTS seen (
  user_id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS archive_pending (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user TEXT NOT NULL,
  text TEXT NOT NULL,
  sent_at INTEGER NOT NULL
);`;

type Meta = {
  created_at: number;
  user_a: string;
  user_b: string;
  sent_a: number;
  sent_b: number;
  orphaned_at: number | null;
  ended_at: number | null;
};

type MessageRecord = {
  seq: number;
  from_user: string;
  client_id: string | null;
  text: string;
  sent_at: number;
};

type PendingRecord = {
  seq: number;
  from_user: string;
  text: string;
  sent_at: number;
};

interface ChatSocket {
  userId: string;
  openedAt?: number;
}

function toChatMessage(record: MessageRecord): ChatMessage {
  return { seq: record.seq, from: record.from_user, text: record.text, sentAt: record.sent_at };
}

function toMessageFor(viewer: string, record: MessageRecord): ChatMessageForViewer {
  const message = toChatMessage(record);
  return record.from_user === viewer && record.client_id !== null
    ? { ...message, clientId: record.client_id }
    : message;
}

function newMessageLimiter(): MemoryRateLimiter {
  return new MemoryRateLimiter(LIMITS.messagesPerChat.count, LIMITS.messagesPerChat.windowMs);
}

function newResumeLimiter(): MemoryRateLimiter {
  return new MemoryRateLimiter(LIMITS.chatResumesPerUser.count, LIMITS.chatResumesPerUser.windowMs);
}

function newSignalLimiter(): MemoryRateLimiter {
  return new MemoryRateLimiter(LIMITS.chatSignalsPerUser.count, LIMITS.chatSignalsPerUser.windowMs);
}

export class ChatRoom extends DurableObject<Env> {
  private readonly deps: AppDeps;
  private readonly messageLimiter = newMessageLimiter();
  private readonly resumeLimiter = newResumeLimiter();
  private readonly signalLimiter = newSignalLimiter();
  private readonly lastTouchAt = new Map<string, number>();
  private readonly lastNotifiedAt = new Map<string, number>();
  private tablesExist = false;
  private clockOffsetMs = 0;
  private archiveFlush: Promise<boolean> | null = null;
  private archiveRetryAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.deps = createDeps(env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async start(userA: string, userB: string): Promise<void> {
    const meta = this.meta();
    if (meta && meta.ended_at === null) return;
    if (meta && this.clock() >= this.wipeAt(meta) && !(await this.wipeStorage())) {
      this.dropLiveData();
    }
    if (this.meta()) {
      this.ctx.storage.sql.exec(
        `UPDATE meta SET created_at = ?, user_a = ?, user_b = ?, sent_a = 0, sent_b = 0,
           orphaned_at = NULL, ended_at = NULL`,
        this.clock(),
        userA,
        userB,
      );
      this.ctx.storage.sql.exec(SCHEMA);
      this.ctx.storage.sql.exec("DELETE FROM seen");
      this.lastTouchAt.clear();
      this.lastNotifiedAt.clear();
      await this.scheduleAlarm();
      return;
    }
    this.ctx.storage.sql.exec(SCHEMA);
    this.ctx.storage.sql.exec(
      "INSERT INTO meta (id, created_at, user_a, user_b) VALUES (1, ?, ?, ?)",
      this.clock(),
      userA,
      userB,
    );
    await this.scheduleAlarm();
  }

  async end(): Promise<void> {
    const meta = this.meta();
    if (!meta || meta.ended_at !== null) return;
    const endedAt = this.clock();
    this.ctx.storage.sql.exec("UPDATE meta SET ended_at = ?", endedAt);
    this.ctx.storage.sql.exec(
      "UPDATE messages SET wipe_at = ? WHERE wipe_at IS NULL",
      this.wipeAt({ ...meta, ended_at: endedAt }),
    );
    for (const socket of this.ctx.getWebSockets()) {
      this.send(socket, { type: "ended" });
      closeQuietly(socket, CHAT_ENDED_CLOSE_CODE, "ended");
    }
    await this.flushAllArchive();
    await this.scheduleAlarm();
  }

  async takedown(): Promise<void> {
    await this.end();
    await this.ctx.storage.deleteAlarm();
    await this.wipeOrRetry();
  }

  snapshot(): RetainedMessage[] {
    if (!this.meta()) return [];
    return this.ctx.storage.sql
      .exec<MessageRecord>("SELECT * FROM messages ORDER BY seq")
      .toArray()
      .map((record) => ({ from: record.from_user, text: record.text, sentAt: record.sent_at }));
  }

  advanceClockForTests(ms: number): void {
    if (this.env.ALLOW_TEST_RESET !== "1") throw new Error("test clock is disabled");
    this.clockOffsetMs += ms;
  }

  override async alarm(): Promise<void> {
    const meta = this.meta();
    if (!meta) return;
    const now = this.clock();
    this.ctx.storage.sql.exec("DELETE FROM messages WHERE wipe_at <= ?", now);
    if (meta.ended_at !== null) {
      if (now >= this.wipeAt(meta)) await this.wipeOrRetry();
      else await this.scheduleAlarm();
      return;
    }
    if (now < this.endAt(meta)) {
      await this.scheduleAlarm();
      return;
    }
    await this.end();
    await this.notifyLobbyEnded();
  }

  override fetch(request: Request): Response {
    const userId = request.headers.get(USER_HEADER);
    const peerId = request.headers.get(PEER_HEADER);
    const meta = this.meta();
    const members = meta ? [meta.user_a, meta.user_b] : [];
    if (
      !meta ||
      meta.ended_at !== null ||
      !userId ||
      !peerId ||
      userId === peerId ||
      !members.includes(userId) ||
      !members.includes(peerId)
    ) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    makeRoomForSocket(this.ctx.getWebSockets(userId));
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, [userId]);
    this.lastNotifiedAt.delete(userId);
    const attachment: ChatSocket = { userId, openedAt: this.clock() };
    server.serializeAttachment(attachment);
    if (meta.orphaned_at !== null) this.ctx.storage.sql.exec("UPDATE meta SET orphaned_at = NULL");
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (frameBytes(message) > LIMITS.maxFrameBytes) return;
    const attachment = ws.deserializeAttachment() as ChatSocket | null;
    const meta = this.meta();
    if (!attachment || !meta || meta.ended_at !== null) return;
    const parsed = parseFrame(message, chatClientMessageSchema);
    if (!parsed) return;
    if (parsed.type === "resume") {
      if (!this.resumeLimiter.hit(attachment.userId, this.clock())) return;
      this.send(ws, {
        type: "history",
        messages: this.messages(parsed.afterSeq, attachment.userId),
        peerSeen: this.seenBy(this.peerOf(meta, attachment.userId)),
      });
      return;
    }
    if (parsed.type === "typing" || parsed.type === "seen") {
      if (!this.signalLimiter.hit(attachment.userId, this.clock())) return;
      const peer = this.peerOf(meta, attachment.userId);
      if (parsed.type === "typing") this.sendTo(peer, { type: "typing" });
      else if (this.recordSeen(attachment.userId, peer, parsed.seq)) {
        this.sendTo(peer, { type: "seen", seq: parsed.seq });
      }
      return;
    }
    await this.handleSend(ws, attachment.userId, meta, parsed);
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    closeQuietly(ws, 1000, "closed");
    await this.markOrphanedIfLastSocket(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.markOrphanedIfLastSocket(ws);
  }

  private async handleSend(
    ws: WebSocket,
    sender: string,
    meta: Meta,
    request: Extract<ChatClientMessage, { type: "send" }>,
  ): Promise<void> {
    const now = this.clock();
    const { clientId } = request;
    const lobby = lobbyStub(this.env);
    if (!this.messageLimiter.hit(sender, now)) {
      this.send(ws, { type: "rejected", clientId, reason: "slow_down" });
      await lobby.reportStrike(sender, now);
      return;
    }
    const moderated = moderateText(request.text, LIMITS.messageMax);
    if (!moderated.ok) {
      this.send(ws, { type: "rejected", clientId, reason: moderated.reason });
      if (moderated.reason === "contact") await lobby.contactRejected(sender, now);
      return;
    }
    const senderIsA = sender === meta.user_a;
    const peer = this.peerOf(meta, sender);
    const sentBefore = senderIsA ? meta.sent_a : meta.sent_b;
    const checkedText = normalizeForChecks(moderated.text);
    if (
      sentBefore < LIMITS.duplicateText.checkedMessagesPerChat &&
      visibleLength(checkedText) >= LIMITS.duplicateText.minChars
    ) {
      const textHash = await sha256Hex(checkedText);
      if (await lobby.checkDuplicate(sender, peer, textHash, now)) {
        this.send(ws, { type: "rejected", clientId, reason: "spam" });
        await lobby.reportStrike(sender, now);
        return;
      }
    }
    if (this.meta()?.ended_at !== null) return;

    const stored = this.append(sender, senderIsA, clientId, moderated.text, now);
    for (const socket of this.ctx.getWebSockets()) {
      const owner = (socket.deserializeAttachment() as ChatSocket | null)?.userId;
      this.send(
        socket,
        owner === sender
          ? { type: "message", ...stored, clientId }
          : { type: "message", ...stored },
      );
    }
    await this.queueForArchive(stored);
    if (sentBefore === 0) await lobby.markSpoke(this.chatId(), sender);
    if (
      !this.ctx.getWebSockets(peer).some(isOpen) &&
      now - (this.lastNotifiedAt.get(peer) ?? 0) >= RENOTIFY_INTERVAL_MS
    ) {
      this.lastNotifiedAt.set(peer, now);
      await lobby.notifyIncoming(peer, this.chatId(), sender);
    }
    if (now - (this.lastTouchAt.get(sender) ?? 0) >= TOUCH_INTERVAL_MS) {
      this.lastTouchAt.set(sender, now);
      await lobby.touch(sender, now);
    }
  }

  private append(
    sender: string,
    senderIsA: boolean,
    clientId: string,
    text: string,
    now: number,
  ): ChatMessage {
    const sql = this.ctx.storage.sql;
    const { seq } = sql
      .exec<{ seq: number }>(
        "INSERT INTO messages (from_user, client_id, text, sent_at) VALUES (?, ?, ?, ?) RETURNING seq",
        sender,
        clientId,
        text,
        now,
      )
      .one();
    sql.exec("DELETE FROM messages WHERE wipe_at IS NULL AND seq <= ?", seq - LIMITS.chatBufferMax);
    sql.exec(
      senderIsA ? "UPDATE meta SET sent_a = sent_a + 1" : "UPDATE meta SET sent_b = sent_b + 1",
    );
    return { seq, from: sender, text, sentAt: now };
  }

  private peerOf(meta: Meta, userId: string): string {
    return userId === meta.user_a ? meta.user_b : meta.user_a;
  }

  private seenBy(userId: string): number {
    const [row] = this.ctx.storage.sql
      .exec<{ seq: number }>("SELECT seq FROM seen WHERE user_id = ?", userId)
      .toArray();
    return row?.seq ?? 0;
  }

  private recordSeen(viewer: string, peer: string, seq: number): boolean {
    const sql = this.ctx.storage.sql;
    if (seq <= this.seenBy(viewer)) return false;
    const fromPeer = sql
      .exec("SELECT 1 FROM messages WHERE seq = ? AND from_user = ? AND wipe_at IS NULL", seq, peer)
      .toArray();
    if (fromPeer.length === 0) return false;
    sql.exec(
      "INSERT INTO seen (user_id, seq) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET seq = excluded.seq",
      viewer,
      seq,
    );
    return true;
  }

  private sendTo(userId: string, message: ChatServerMessage): void {
    for (const socket of this.ctx.getWebSockets(userId)) this.send(socket, message);
  }

  private async queueForArchive(message: ChatMessage): Promise<void> {
    if (!this.deps.retention.retainsAllContent) return;
    const sql = this.ctx.storage.sql;
    sql.exec(
      "INSERT INTO archive_pending (from_user, text, sent_at) VALUES (?, ?, ?)",
      message.from,
      message.text,
      message.sentAt,
    );
    const { pending } = sql
      .exec<{ pending: number }>("SELECT COUNT(*) AS pending FROM archive_pending")
      .one();
    if (pending >= LIMITS.archiveFlushMessages && this.clock() >= this.archiveRetryAt) {
      await this.flushArchive();
    }
  }

  private flushArchive(): Promise<boolean> {
    this.archiveFlush ??= this.writePendingToArchive().finally(() => {
      this.archiveFlush = null;
    });
    return this.archiveFlush;
  }

  private async flushAllArchive(): Promise<boolean> {
    await this.archiveFlush;
    return this.flushArchive();
  }

  private async writePendingToArchive(): Promise<boolean> {
    if (!this.meta()) return true;
    const sql = this.ctx.storage.sql;
    const { upTo } = sql
      .exec<{ upTo: number | null }>("SELECT MAX(seq) AS upTo FROM archive_pending")
      .one();
    if (upTo === null) return true;
    for (;;) {
      const batch = sql
        .exec<PendingRecord>(
          "SELECT * FROM archive_pending WHERE seq <= ? ORDER BY seq LIMIT ?",
          upTo,
          LIMITS.archiveFlushMessages,
        )
        .toArray();
      const [first] = batch;
      if (!first) return true;
      const spanEnd = first.sent_at + LIMITS.archiveBundleMaxSpanMs;
      const bundle = batch.filter((record) => record.sent_at < spanEnd);
      const last = bundle.at(-1) ?? first;
      try {
        await this.deps.retention.archiveMessages(
          this.chatId(),
          bundle.map((record) => ({
            from: record.from_user,
            text: record.text,
            sentAt: record.sent_at,
          })),
          `${String(first.seq)}-${String(last.seq)}`,
        );
      } catch {
        console.error("archive_flush_failed");
        this.archiveRetryAt = this.clock() + LIMITS.archiveRetryMs;
        await this.alertIfArchiveStuck(first.sent_at);
        return false;
      }
      sql.exec("DELETE FROM archive_pending WHERE seq <= ?", last.seq);
      if (last.seq >= upTo) return true;
    }
  }

  private async alertIfArchiveStuck(oldestSentAt: number): Promise<void> {
    if (this.clock() - oldestSentAt < LIMITS.archiveStuckAlertMs) return;
    try {
      await this.deps.alerts.notify(
        "archive_stuck",
        "Swoony: chat messages are not being archived",
        "Saving chat messages to the 1-year archive has failed for over an hour. They wait in " +
          "the chat servers and are retried every minute. Open System health on the admin page " +
          "and contact the developer.",
      );
    } catch {
      console.error("archive_alert_failed");
    }
  }

  private async markOrphanedIfLastSocket(ws: WebSocket): Promise<void> {
    const meta = this.meta();
    if (!meta || meta.ended_at !== null) return;
    const stillOpen = this.ctx.getWebSockets().some((socket) => socket !== ws && isOpen(socket));
    if (stillOpen) return;
    this.ctx.storage.sql.exec("UPDATE meta SET orphaned_at = ?", this.clock());
    await this.scheduleAlarm();
  }

  private async notifyLobbyEnded(): Promise<void> {
    try {
      await lobbyStub(this.env).chatClosed(this.chatId());
    } catch {
      console.error("chat_close_notify_failed");
    }
  }

  private endAt(meta: Meta): number {
    const lifetimeEnd = meta.created_at + LIMITS.chatMaxLifetimeMs;
    const hasSocket = this.ctx.getWebSockets().some(isOpen);
    if (hasSocket) return lifetimeEnd;
    const orphanedSince = meta.orphaned_at ?? meta.created_at;
    return Math.min(lifetimeEnd, orphanedSince + LIMITS.chatOrphanWipeMs);
  }

  private wipeAt(meta: Meta): number {
    const endedAt = meta.ended_at ?? meta.created_at;
    return Math.min(
      endedAt + LIMITS.chatReportWindowMs,
      meta.created_at + LIMITS.chatMaxLifetimeMs,
    );
  }

  private async scheduleAlarm(): Promise<void> {
    const meta = this.meta();
    if (!meta) return;
    if (meta.ended_at !== null && this.wipeAt(meta) <= this.clock()) {
      await this.wipeOrRetry();
      return;
    }
    const roomDeadline = meta.ended_at === null ? this.endAt(meta) : this.wipeAt(meta);
    const { next } = this.ctx.storage.sql
      .exec<{ next: number | null }>("SELECT MIN(wipe_at) AS next FROM messages")
      .one();
    const at = Math.min(roomDeadline, next ?? roomDeadline);
    await this.ctx.storage.setAlarm(at - this.clockOffsetMs);
  }

  private async wipeStorage(): Promise<boolean> {
    if (!(await this.flushAllArchive())) return false;
    this.tablesExist = false;
    await this.ctx.storage.deleteAll();
    return true;
  }

  private async wipeOrRetry(): Promise<void> {
    if (await this.wipeStorage()) return;
    this.dropLiveData();
    await this.ctx.storage.setAlarm(this.clock() + LIMITS.archiveRetryMs - this.clockOffsetMs);
  }

  private dropLiveData(): void {
    this.ctx.storage.sql.exec("DELETE FROM messages");
    this.ctx.storage.sql.exec("DELETE FROM seen");
  }

  private meta(): Meta | null {
    const sql = this.ctx.storage.sql;
    if (!this.tablesExist) {
      this.tablesExist =
        sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").toArray()
          .length > 0;
      if (!this.tablesExist) return null;
      sql.exec(SCHEMA);
    }
    const [meta] = sql.exec<Meta>("SELECT * FROM meta WHERE id = 1").toArray();
    return meta ?? null;
  }

  private messages(afterSeq: number, viewer: string): ChatMessageForViewer[] {
    if (!this.meta()) return [];
    return this.ctx.storage.sql
      .exec<MessageRecord>(
        "SELECT * FROM messages WHERE wipe_at IS NULL AND seq > ? ORDER BY seq",
        afterSeq,
      )
      .toArray()
      .map((record) => toMessageFor(viewer, record));
  }

  private chatId(): string {
    const name = this.ctx.id.name;
    if (!name) throw new Error("ChatRoom must be addressed by name");
    return name;
  }

  private clock(): number {
    return Date.now() + this.clockOffsetMs;
  }

  private send(ws: WebSocket, message: ChatServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      return;
    }
  }
}
