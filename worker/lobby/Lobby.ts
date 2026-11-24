import { LIMITS, type ReportReason } from "@shared/config";
import { nicknameKey, type Profile, type PublicUser } from "@shared/profile";
import type { MaintenanceState } from "@shared/protocol/admin";
import {
  KICKED_CLOSE_CODE,
  LEFT_CLOSE_CODE,
  lobbyClientMessageSchema,
  type KickReason,
  type LobbyClientMessage,
  type LobbyServerMessage,
  type OpenChat,
} from "@shared/protocol/lobby";
import { moderateText } from "@shared/text/moderateText";
import { DurableObject } from "cloudflare:workers";
import { chatIdFor } from "../chat/chatId";
import { createDeps, type AppDeps } from "../deps";
import { networkKey } from "../http/requestInfo";
import { MemoryRateLimiter, SqlRateLimiter } from "../support/rateLimit";
import { closeQuietly, frameBytes, isOpen, makeRoomForSocket, parseFrame } from "../support/socket";
import {
  ContactRejectionCounter,
  createStrikeTracker,
  DuplicateTextDetector,
  type StrikeTracker,
} from "./abuse";
import { listUsers, parseCursor } from "./listing";
import { maintenanceOff, MaintenanceStore } from "./maintenanceStore";
import {
  peerOf,
  toPublicUser,
  UserTable,
  type ChatRow,
  type ContactRow,
  type Contact,
  type UserRow,
} from "./userTable";

export const DEVICE_HEADER = "X-Swoony-Device";

export interface JoinInput {
  deviceId: string;
  ip: string;
  detectedCountry: string | null;
  profile: Profile;
  now: number;
}

export type JoinResult =
  { ok: true; me: PublicUser } | { ok: false; error: "nickname_taken" | "maintenance" };

type PresenceChange = "joined" | "updated" | "left";

export type RemovalReason = "left" | KickReason;

export interface ChatAccess {
  userId: string;
  peerUserId: string;
}

export interface SessionGate {
  maintenance: MaintenanceState;
  me: PublicUser | null;
}

export type StrikeOutcome = "ok" | "kicked";

interface Removal {
  userId: string;
  chatIds: string[];
}

const NORMAL_CLOSE_CODE = 1000;

interface SocketAttachment {
  deviceId: string;
  userId: string;
  socketId: string;
  openedAt?: number;
}

const SILENT_CLOSE_CODE = 1001;
const CHAT_END_BATCH = 50;
const ACTIVITY_WRITE_INTERVAL_MS = 30_000;

function newListLimiter(): MemoryRateLimiter {
  return new MemoryRateLimiter(
    LIMITS.listRequestsPerUser.count,
    LIMITS.listRequestsPerUser.windowMs,
  );
}

function newSocketLimiter(): MemoryRateLimiter {
  return new MemoryRateLimiter(
    LIMITS.lobbyMessagesPerSocket.count,
    LIMITS.lobbyMessagesPerSocket.windowMs,
  );
}

function newChatLimiter(): MemoryRateLimiter {
  return new MemoryRateLimiter(LIMITS.newChats.count, LIMITS.newChats.windowMs);
}

function newDuplicateDetector(): DuplicateTextDetector {
  return new DuplicateTextDetector(LIMITS.duplicateText.users, LIMITS.duplicateText.windowMs);
}

function isFirstPageReload(message: LobbyClientMessage): boolean {
  return message.type === "list" && message.cursor === undefined;
}

interface ReportInput {
  reporter: UserRow;
  targetId: string;
  reason: ReportReason;
  now: number;
}

interface CountedReport {
  reporterDevice: string;
  reporterNetwork: string;
  reason: ReportReason;
  now: number;
}

export class Lobby extends DurableObject<Env> {
  private readonly users: UserTable;
  private readonly maintenance: MaintenanceStore;
  private readonly deps: AppDeps;
  private deviceEntries!: SqlRateLimiter;
  private networkEntries!: SqlRateLimiter;
  private deviceReports!: SqlRateLimiter;
  private adminRequests!: SqlRateLimiter;
  private webAdminRequests!: SqlRateLimiter;
  private strikes!: StrikeTracker;
  private contactRejections!: ContactRejectionCounter;
  private duplicates = newDuplicateDetector();
  private readonly kicking = new Set<string>();
  private readonly banDecisions = new Map<string, Promise<unknown>>();
  private socketLimiter = newSocketLimiter();
  private listLimiter = newListLimiter();
  private chatLimiter = newChatLimiter();
  private clockOffsetMs = 0;
  private readonly pendingPresence = new Map<string, PresenceChange>();
  private readonly changedProfiles = new Set<string>();
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.users = new UserTable(ctx.storage.sql);
    this.maintenance = new MaintenanceStore(ctx.storage.sql);
    this.deps = createDeps(env);
    void ctx.blockConcurrencyWhile(() => {
      this.prepareStorage();
      return Promise.resolve();
    });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async hitDeviceEntryLimit(deviceId: string, now: number): Promise<boolean> {
    return this.deviceEntries.hit(await this.deps.hasher.hash(deviceId), now);
  }

  async hitNetworkEntryLimit(network: string, now: number): Promise<boolean> {
    return this.networkEntries.hit(await this.deps.hasher.hash(network), now);
  }

  async join(input: JoinInput): Promise<JoinResult> {
    if (this.maintenance.isOn()) return { ok: false, error: "maintenance" };
    const existing = this.users.byDevice(input.deviceId);
    if (existing) return { ok: true, me: toPublicUser(existing) };
    const deviceHash = await this.deps.hasher.hash(input.deviceId);
    const joinedMeanwhile = this.users.byDevice(input.deviceId);
    if (joinedMeanwhile) return { ok: true, me: toPublicUser(joinedMeanwhile) };
    if (this.users.nicknameTaken(nicknameKey(input.profile.nickname))) {
      return { ok: false, error: "nickname_taken" };
    }
    const row = {
      ...input.profile,
      userId: crypto.randomUUID(),
      deviceId: input.deviceId,
      ip: input.ip,
      joinedAt: input.now,
      lastActiveAt: input.now,
      disconnectedAt: null,
    };
    this.users.insert(row);
    try {
      await this.deps.retention.logConnection({
        userId: row.userId,
        deviceHash,
        nickname: row.nickname,
        ip: row.ip,
        country: row.country,
        detectedCountry: input.detectedCountry,
        joinedAt: row.joinedAt,
      });
    } catch (error) {
      this.users.delete(row.deviceId);
      throw error;
    }
    this.queuePresence(row.userId, "joined");
    await this.scheduleSweep();
    return { ok: true, me: toPublicUser(row) };
  }

  touch(userId: string, now: number): Promise<void> {
    this.users.touch(userId, now);
    return Promise.resolve();
  }

  async removeUser(deviceId: string, reason: RemovalReason): Promise<void> {
    const row = this.users.byDevice(deviceId);
    if (!row) return;
    const removal = this.detach(row, reason);
    await this.finishRemovals([removal]);
  }

  authorizeChat(deviceId: string, chatId: string): ChatAccess | "no_session" | null {
    const row = this.users.byDevice(deviceId);
    if (!row) return "no_session";
    const chat = this.users.chatById(chatId);
    if (!chat || (chat.userA !== row.userId && chat.userB !== row.userId)) return null;
    const peerUserId = peerOf(chat, row.userId);
    if (this.users.hiddenFor(row.userId).has(peerUserId)) return null;
    return { userId: row.userId, peerUserId };
  }

  notifyIncoming(peerUserId: string, chatId: string, fromUserId: string): void {
    const from = this.users.byUserId(fromUserId);
    const chat = this.users.chatById(chatId);
    if (!from || !chat || peerOf(chat, fromUserId) !== peerUserId) return;
    if (this.users.hiddenFor(peerUserId).has(fromUserId)) return;
    this.sendToUser(peerUserId, { type: "incomingChat", chatId, from: toPublicUser(from) });
  }

  markSpoke(chatId: string, userId: string): void {
    this.users.markSpoke(chatId, userId);
  }

  async reportStrike(userId: string, now: number): Promise<StrikeOutcome> {
    const user = await this.withDeviceHash(userId);
    if (!user) return "ok";
    if (this.kicking.has(userId)) return "kicked";
    if (!this.strikes.strike(user.deviceHash, now)) {
      this.sendToUser(userId, { type: "notice", code: "slow_down" });
      return "ok";
    }
    this.strikes.forgive(user.deviceHash);
    this.kicking.add(userId);
    try {
      await this.kickForAbuse(user.row, user.deviceHash, now);
    } finally {
      this.kicking.delete(userId);
    }
    return "kicked";
  }

  async adminRemove(userId: string): Promise<boolean> {
    const row = this.users.byUserId(userId);
    if (!row) return false;
    await this.removeUser(row.deviceId, "banned");
    return true;
  }

  hitAdminLimit(networkHash: string, now: number): boolean {
    return this.adminRequests.hit(networkHash, now);
  }

  healthStatus(): { online: number; maintenance: boolean } {
    return { online: this.users.onlineCount(), maintenance: this.maintenance.isOn() };
  }

  getMaintenance(): MaintenanceState {
    return this.maintenance.get();
  }

  async setMaintenance(on: boolean, message: string, by: string): Promise<MaintenanceState> {
    if (!on) {
      this.maintenance.set(maintenanceOff());
      return this.maintenance.get();
    }
    const current = this.maintenance.get();
    this.maintenance.set({
      on: true,
      message,
      startedAt: current.on ? current.startedAt : this.clock(),
      startedBy: current.on ? current.startedBy : by,
    });
    const removals = this.users.all().map((row) => this.detach(row, "maintenance"));
    for (const socket of this.ctx.getWebSockets()) {
      this.send(socket, { type: "kicked", reason: "maintenance" });
      closeQuietly(socket, KICKED_CLOSE_CODE, "kicked");
    }
    this.cancelPresence();
    await this.finishRemovals(removals);
    return this.maintenance.get();
  }

  hitWebAdminLimit(networkHash: string, now: number): boolean {
    return this.webAdminRequests.hit(networkHash, now);
  }

  async contactRejected(userId: string, now: number): Promise<void> {
    const user = await this.withDeviceHash(userId);
    if (user && this.contactRejections.reject(user.deviceHash, now)) {
      await this.reportStrike(userId, now);
    }
  }

  checkDuplicate(senderId: string, recipientId: string, textHash: string, now: number): boolean {
    return this.duplicates.record(senderId, recipientId, textHash, now);
  }

  async chatClosed(chatId: string): Promise<void> {
    const chat = this.users.chatById(chatId);
    if (!chat) return;
    this.users.deleteChat(chatId);
    this.sendToUser(chat.userA, { type: "chatEnded", chatId });
    this.sendToUser(chat.userB, { type: "chatEnded", chatId });
    await this.logChatEnd([chatId]);
  }

  sessionGate(deviceId: string | null): SessionGate {
    const row = deviceId ? this.users.byDevice(deviceId) : null;
    return { maintenance: this.maintenance.get(), me: row ? toPublicUser(row) : null };
  }

  getSession(deviceId: string): PublicUser | null {
    const row = this.users.byDevice(deviceId);
    return row ? toPublicUser(row) : null;
  }

  resetForTests(): Promise<void> {
    if (this.env.ALLOW_TEST_RESET !== "1") throw new Error("test reset is disabled");
    for (const socket of this.ctx.getWebSockets()) socket.close(1012, "reset");
    this.socketLimiter = newSocketLimiter();
    this.listLimiter = newListLimiter();
    this.chatLimiter = newChatLimiter();
    this.duplicates = newDuplicateDetector();
    this.clockOffsetMs = 0;
    this.cancelPresence();
    return this.ctx.storage
      .deleteAlarm()
      .then(() => this.ctx.storage.deleteAll())
      .then(() => {
        this.prepareStorage();
      });
  }

  advanceClockForTests(ms: number): void {
    if (this.env.ALLOW_TEST_RESET !== "1") throw new Error("test clock is disabled");
    this.clockOffsetMs += ms;
  }

  flushPresenceForTests(): void {
    if (this.env.ALLOW_TEST_RESET !== "1") throw new Error("test presence flush is disabled");
    if (this.presenceTimer !== null) this.flushPresence();
  }

  override async alarm(): Promise<void> {
    try {
      await this.sweep(this.clock());
    } finally {
      await this.scheduleSweep();
    }
  }

  override fetch(request: Request): Response {
    const deviceId = request.headers.get(DEVICE_HEADER);
    const row = deviceId ? this.users.byDevice(deviceId) : null;
    if (!row) return Response.json({ error: "no_session" }, { status: 401 });

    if (row.disconnectedAt !== null) this.users.update(row.deviceId, { disconnectedAt: null });
    makeRoomForSocket(this.ctx.getWebSockets(row.userId));
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, [row.userId]);
    const attachment: SocketAttachment = {
      deviceId: row.deviceId,
      userId: row.userId,
      socketId: crypto.randomUUID(),
      openedAt: this.clock(),
    };
    server.serializeAttachment(attachment);
    this.send(server, {
      type: "hello",
      me: toPublicUser(row),
      online: this.users.othersOnlineVisibleTo(row.userId),
      chats: this.openChatsOf(row.userId),
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  private touchSender(sender: UserRow): void {
    const now = this.clock();
    if (now - sender.lastActiveAt >= ACTIVITY_WRITE_INTERVAL_MS)
      this.users.touch(sender.userId, now);
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (frameBytes(message) > LIMITS.maxFrameBytes) return;
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    const sender = attachment ? this.users.byUserId(attachment.userId) : null;
    if (!attachment || !sender) return;
    if (!this.socketLimiter.hit(attachment.socketId, this.clock())) {
      this.touchSender(sender);
      this.send(ws, { type: "notice", code: "slow_down" });
      return;
    }
    const parsed = parseFrame(message, lobbyClientMessageSchema);
    if (!parsed || !isFirstPageReload(parsed)) this.touchSender(sender);
    if (!parsed) {
      this.send(ws, { type: "error", code: "bad_message" });
      return;
    }
    switch (parsed.type) {
      case "list":
        if (!this.listLimiter.hit(attachment.userId, this.clock())) {
          this.send(ws, { type: "notice", code: "slow_down" });
          return;
        }
        this.sendPage(ws, sender, parsed);
        return;
      case "setBio":
        await this.setBio(ws, attachment.deviceId, parsed.bio);
        return;
      case "leave":
        await this.removeUser(attachment.deviceId, "left");
        return;
      case "openChat":
        await this.openChat(ws, attachment.userId, parsed.userId);
        return;
      case "block":
        await this.block(ws, attachment.userId, parsed.userId);
        return;
      case "report":
        await this.report(ws, {
          reporter: sender,
          targetId: parsed.userId,
          reason: parsed.reason,
          now: this.clock(),
        });
        return;
    }
  }

  override webSocketClose(ws: WebSocket): void {
    closeQuietly(ws, NORMAL_CLOSE_CODE, "closed");
    this.markDisconnectedIfLastSocket(ws);
  }

  override webSocketError(ws: WebSocket): void {
    this.markDisconnectedIfLastSocket(ws);
  }

  private clock(): number {
    return Date.now() + this.clockOffsetMs;
  }

  private markDisconnectedIfLastSocket(ws: WebSocket): void {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) return;
    const stillOpen = this.ctx
      .getWebSockets(attachment.userId)
      .some((socket) => socket !== ws && isOpen(socket));
    if (!stillOpen) this.users.markDisconnected([attachment.userId], this.clock());
  }

  private async sweep(now: number): Promise<void> {
    this.reconcileOrphans(now);
    const removed: Removal[] = [];
    for (const row of this.users.disconnectedSince(now - LIMITS.leaveGraceMs)) {
      removed.push(this.detach(row, "left"));
    }
    for (const row of this.users.idleSince(now - LIMITS.idleKickMs)) {
      removed.push(this.detach(row, "idle"));
    }
    this.deviceEntries.prune(now);
    this.networkEntries.prune(now);
    this.deviceReports.prune(now);
    this.adminRequests.prune(now);
    this.webAdminRequests.prune(now);
    this.strikes.prune(now);
    this.contactRejections.prune(now);
    if (this.pendingPresence.size > 0) this.flushPresence();
    await this.finishRemovals(removed);
  }

  private detach(row: UserRow, reason: RemovalReason): Removal {
    const chats = this.users.chatsOf(row.userId);
    this.users.wipe(row);
    this.queuePresence(row.userId, "left");
    this.closeSockets(row.userId, reason);
    for (const chat of chats) {
      this.sendToUser(peerOf(chat, row.userId), { type: "chatEnded", chatId: chat.chatId });
    }
    return { userId: row.userId, chatIds: chats.map((chat) => chat.chatId) };
  }

  private openChatsOf(userId: string): OpenChat[] {
    const chats: OpenChat[] = [];
    for (const chat of this.users.chatsOf(userId)) {
      const peer = this.users.byUserId(peerOf(chat, userId));
      if (peer) chats.push({ chatId: chat.chatId, peer: toPublicUser(peer) });
    }
    return chats;
  }

  private availablePeer(userId: string, peerUserId: string): UserRow | null {
    if (userId === peerUserId || !this.users.byUserId(userId)) return null;
    const peer = this.users.byUserId(peerUserId);
    if (!peer || this.users.hiddenFor(userId).has(peerUserId)) return null;
    return peer;
  }

  private async contactsFor(me: UserRow, peer: UserRow): Promise<ContactRow[]> {
    const [myDevice, myNetwork, peerDevice, peerNetwork] = await Promise.all([
      this.deps.hasher.hash(me.deviceId),
      this.deps.hasher.hash(networkKey(me.ip)),
      this.deps.hasher.hash(peer.deviceId),
      this.deps.hasher.hash(networkKey(peer.ip)),
    ]);
    return [
      {
        owner: me.userId,
        other: peer.userId,
        otherDeviceHash: peerDevice,
        otherNetworkHash: peerNetwork,
      },
      {
        owner: peer.userId,
        other: me.userId,
        otherDeviceHash: myDevice,
        otherNetworkHash: myNetwork,
      },
    ];
  }

  private async openChat(ws: WebSocket, userId: string, peerUserId: string): Promise<void> {
    const now = this.clock();
    const me = this.users.byUserId(userId);
    const peer = this.availablePeer(userId, peerUserId);
    if (!me || !peer) {
      this.send(ws, { type: "error", code: "user_unavailable" });
      return;
    }
    const chatId = await chatIdFor(userId, peerUserId);
    if (!this.users.chatById(chatId) && !this.chatLimiter.hit(userId, now)) {
      this.send(ws, { type: "error", code: "slow_down" });
      await this.reportStrike(userId, now);
      return;
    }
    let contacts = this.users.chatById(chatId) ? null : await this.contactsFor(me, peer);
    try {
      await this.env.CHAT_ROOM.getByName(chatId).start(userId, peerUserId);
    } catch {
      console.error("chat_start_failed");
      this.send(ws, { type: "error", code: "user_unavailable" });
      return;
    }
    if (!this.users.chatById(chatId) && contacts === null) {
      contacts = await this.contactsFor(me, peer);
    }
    const stillPeer = this.availablePeer(userId, peerUserId);
    if (!stillPeer) {
      this.send(ws, { type: "error", code: "user_unavailable" });
      return;
    }
    const created = !this.users.chatById(chatId);
    if (created && contacts) {
      const chat: ChatRow = { chatId, userA: userId, userB: peerUserId };
      this.users.insertChat(chat, now, contacts);
    }
    this.send(ws, { type: "chatOpened", chatId, peer: toPublicUser(stillPeer) });
    if (!created) return;
    try {
      await this.deps.retention.logChatStart(chatId, userId, peerUserId, now);
    } catch {
      console.error("chat_log_failed");
    }
  }

  private knownTo(userId: string, targetId: string): Contact | "online" | null {
    if (userId === targetId) return null;
    const contact = this.users.contact(userId, targetId);
    if (contact) return contact;
    return this.users.byUserId(targetId) ? "online" : null;
  }

  private async block(ws: WebSocket, blocker: string, targetId: string): Promise<void> {
    if (!this.knownTo(blocker, targetId)) {
      this.send(ws, { type: "error", code: "user_unavailable" });
      return;
    }
    await this.blockPair(blocker, targetId);
    this.send(ws, { type: "blocked", userId: targetId });
  }

  private sendDeparture(viewer: string, gone: string): void {
    this.sendToUser(viewer, {
      type: "presence",
      joined: [],
      left: [gone],
      updated: [],
      online: this.users.othersOnlineVisibleTo(viewer),
    });
  }

  private async blockPair(blocker: string, blocked: string): Promise<void> {
    this.users.insertBlock(blocker, blocked);
    this.sendDeparture(blocker, blocked);
    if (this.users.byUserId(blocked)) this.sendDeparture(blocked, blocker);
    const chatId = await chatIdFor(blocker, blocked);
    if (!this.users.chatById(chatId)) return;
    this.users.deleteChat(chatId);
    this.sendToUser(blocker, { type: "chatEnded", chatId });
    this.sendToUser(blocked, { type: "chatEnded", chatId });
    await this.endChatRooms([chatId]);
  }

  private async report(ws: WebSocket, input: ReportInput): Promise<void> {
    const { reporter, targetId, reason, now } = input;
    const known = this.knownTo(reporter.userId, targetId);
    if (!known) {
      this.send(ws, { type: "error", code: "user_unavailable" });
      return;
    }
    const [reporterDevice, reporterNetwork] = await Promise.all([
      this.deps.hasher.hash(reporter.deviceId),
      this.deps.hasher.hash(networkKey(reporter.ip)),
    ]);
    if (!this.deviceReports.hit(reporterDevice, now)) {
      this.send(ws, { type: "error", code: "slow_down" });
      await this.reportStrike(reporter.userId, now);
      return;
    }
    const chatId = await chatIdFor(reporter.userId, targetId);
    if (known !== "online") await this.snapshotChat(chatId, reason);
    await this.blockPair(reporter.userId, targetId);
    this.send(ws, { type: "reported", userId: targetId });
    if (known === "online" || !known.otherSpoke) return;
    try {
      await this.decideBan(known.otherDeviceHash, () =>
        this.countReport(known, targetId, { reporterDevice, reporterNetwork, reason, now }),
      );
    } catch {
      console.error("report_count_failed");
    }
  }

  private async snapshotChat(chatId: string, reason: ReportReason): Promise<void> {
    try {
      const messages = await this.env.CHAT_ROOM.getByName(chatId).snapshot();
      await this.deps.retention.snapshotReport(chatId, reason, messages);
    } catch {
      console.error("report_snapshot_failed");
    }
  }

  private async countReport(target: Contact, targetId: string, report: CountedReport) {
    const { reports, bans } = this.deps;
    await reports.addUserReport({
      reportedDevice: target.otherDeviceHash,
      reporterDevice: report.reporterDevice,
      reporterNetwork: report.reporterNetwork,
      reason: report.reason,
      createdAt: report.now,
    });
    const since = await this.sinceLastBan(
      target.otherDeviceHash,
      report.now - LIMITS.reportsForBan.windowMs,
    );
    const reporters = await reports.independentReporters(target.otherDeviceHash, since);
    if (reporters < LIMITS.reportsForBan.distinctReporters) return;
    await bans.issueBan(target.otherDeviceHash, target.otherNetworkHash);
    const online = this.users.byUserId(targetId);
    if (online) await this.removeUser(online.deviceId, "banned");
  }

  private async withDeviceHash(
    userId: string,
  ): Promise<{ row: UserRow; deviceHash: string } | null> {
    const row = this.users.byUserId(userId);
    if (!row) return null;
    const deviceHash = await this.deps.hasher.hash(row.deviceId);
    return this.users.byUserId(userId) ? { row, deviceHash } : null;
  }

  private async kickForAbuse(row: UserRow, deviceHash: string, now: number): Promise<void> {
    let reason: KickReason = "abuse";
    try {
      const networkHash = await this.deps.hasher.hash(networkKey(row.ip));
      const banned = await this.decideBan(deviceHash, async () => {
        await this.deps.reports.addSystemKick(deviceHash, now);
        const since = await this.sinceLastBan(deviceHash, now - LIMITS.kicksForBan.windowMs);
        const kicks = await this.deps.reports.systemKicks(deviceHash, since);
        if (kicks < LIMITS.kicksForBan.count) return false;
        await this.deps.bans.issueBan(deviceHash, networkHash);
        return true;
      });
      if (banned) reason = "banned";
    } catch {
      console.error("kick_record_failed");
    }
    await this.removeUser(row.deviceId, reason);
  }

  private decideBan<T>(deviceHash: string, decision: () => Promise<T>): Promise<T> {
    const previous = this.banDecisions.get(deviceHash) ?? Promise.resolve();
    const current = previous.then(decision);
    const settled = current.catch(() => undefined);
    this.banDecisions.set(deviceHash, settled);
    void settled.then(() => {
      if (this.banDecisions.get(deviceHash) === settled) this.banDecisions.delete(deviceHash);
    });
    return current;
  }

  private async sinceLastBan(deviceHash: string, windowStart: number): Promise<number> {
    const lastBanAt = await this.deps.bans.lastBanAt(deviceHash);
    return lastBanAt === null ? windowStart : Math.max(windowStart, lastBanAt);
  }

  private lastHeardAt(socket: WebSocket, attachment: SocketAttachment): number {
    const lastPing = this.ctx.getWebSocketAutoResponseTimestamp(socket)?.getTime() ?? 0;
    return Math.max(lastPing + this.clockOffsetMs, attachment.openedAt ?? 0);
  }

  private reconcileOrphans(now: number): void {
    const withSocket = new Set<string>();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (!attachment || !isOpen(socket)) continue;
      if (this.lastHeardAt(socket, attachment) < now - LIMITS.socketSilenceMs) {
        closeQuietly(socket, SILENT_CLOSE_CODE, "silent");
        continue;
      }
      withSocket.add(attachment.userId);
    }
    const orphans = this.users.connectedUserIds().filter((userId) => !withSocket.has(userId));
    if (orphans.length > 0) this.users.markDisconnected(orphans, now);
  }

  private async scheduleSweep(): Promise<void> {
    if (this.users.count() === 0) return;
    if ((await this.ctx.storage.getAlarm()) !== null) return;
    await this.ctx.storage.setAlarm(this.clock() + LIMITS.lobbySweepMs);
  }

  private closeSockets(userId: string, reason: RemovalReason): void {
    for (const socket of this.ctx.getWebSockets(userId)) {
      if (reason === "left") {
        closeQuietly(socket, LEFT_CLOSE_CODE, "left");
        continue;
      }
      this.send(socket, { type: "kicked", reason });
      closeQuietly(socket, KICKED_CLOSE_CODE, "kicked");
    }
  }

  private async finishRemovals(removals: readonly Removal[]): Promise<void> {
    if (removals.length === 0) return;
    const leftAt = this.clock();
    const chatIds = [...new Set(removals.flatMap((removal) => removal.chatIds))];
    await Promise.all([
      this.logDisconnect(
        removals.map((removal) => removal.userId),
        leftAt,
      ),
      this.endChatRooms(chatIds),
    ]);
  }

  private async logDisconnect(userIds: readonly string[], leftAt: number): Promise<void> {
    try {
      await this.deps.retention.logDisconnect(userIds, leftAt);
    } catch {
      console.error("disconnect_log_failed");
    }
  }

  private async endChatRooms(chatIds: readonly string[]): Promise<void> {
    for (let start = 0; start < chatIds.length; start += CHAT_END_BATCH) {
      await Promise.all(
        chatIds.slice(start, start + CHAT_END_BATCH).map(async (chatId) => {
          try {
            await this.env.CHAT_ROOM.getByName(chatId).end();
          } catch {
            console.error("chat_end_failed");
          }
        }),
      );
    }
    await this.logChatEnd(chatIds);
  }

  private async logChatEnd(chatIds: readonly string[]): Promise<void> {
    try {
      await this.deps.retention.logChatEnd(chatIds, this.clock());
    } catch {
      console.error("chat_log_failed");
    }
  }

  private sendToUser(userId: string, message: LobbyServerMessage): void {
    for (const socket of this.ctx.getWebSockets(userId)) this.send(socket, message);
  }

  private sendPage(
    ws: WebSocket,
    viewer: UserRow,
    request: Extract<LobbyClientMessage, { type: "list" }>,
  ): void {
    const cursor = request.cursor ?? null;
    const candidates = this.users.listPage(
      viewer,
      request.filter,
      parseCursor(cursor),
      LIMITS.listPageSize + 1,
    );
    const page = listUsers(
      candidates,
      { userId: viewer.userId, country: viewer.country, hidden: new Set() },
      request.filter,
      cursor,
      LIMITS.listPageSize,
    );
    this.send(ws, {
      type: "page",
      requestId: request.requestId,
      users: page.users,
      nextCursor: page.nextCursor,
      online: this.users.othersOnlineVisibleTo(viewer.userId),
    });
  }

  private async setBio(ws: WebSocket, deviceId: string, bio: string): Promise<void> {
    const row = this.users.byDevice(deviceId);
    if (!row) return;
    const result = moderateText(bio, LIMITS.bioMax);
    if (!result.ok && result.reason !== "empty") {
      this.send(ws, { type: "bioRejected", reason: result.reason });
      if (result.reason === "contact") await this.contactRejected(row.userId, this.clock());
      return;
    }
    this.users.update(deviceId, { bio: result.ok ? result.text : "" });
    this.changedProfiles.add(row.userId);
    this.queuePresence(row.userId, "updated");
  }

  private queuePresence(userId: string, change: PresenceChange): void {
    const previous = this.pendingPresence.get(userId);
    if (previous === "joined" && change === "left") this.pendingPresence.delete(userId);
    else if (previous === "joined" && change === "updated") return;
    else this.pendingPresence.set(userId, change);
    this.presenceTimer ??= setTimeout(() => {
      this.flushPresence();
    }, LIMITS.presenceBatchMs);
  }

  private cancelPresence(): void {
    if (this.presenceTimer !== null) clearTimeout(this.presenceTimer);
    this.presenceTimer = null;
    this.pendingPresence.clear();
    this.changedProfiles.clear();
  }

  private flushPresence(): void {
    const changes = [...this.pendingPresence];
    const changedProfiles = new Set(this.changedProfiles);
    this.cancelPresence();
    const joined: PublicUser[] = [];
    const updated: PublicUser[] = [];
    const left: string[] = [];
    const ownProfiles = new Map<string, PublicUser>();
    for (const [userId, change] of changes) {
      if (change === "left") {
        left.push(userId);
        continue;
      }
      const row = this.users.byUserId(userId);
      if (!row) continue;
      const user = toPublicUser(row);
      (change === "joined" ? joined : updated).push(user);
      if (changedProfiles.has(userId)) ownProfiles.set(userId, user);
    }
    const othersOnline = Math.max(0, this.users.onlineCount() - 1);
    const hiddenByUser = this.users.hiddenByUser();
    const connected = hiddenByUser.size > 0 ? new Set(this.users.connectedUserIds()) : new Set();
    const othersOnlineVisible = (hidden: Set<string>) =>
      Math.max(0, othersOnline - [...hidden].filter((userId) => connected.has(userId)).length);
    const changed = new Set(changes.map(([userId]) => userId));
    if (joined.length + left.length + updated.length === 0) return;
    const sharedMessage: Extract<LobbyServerMessage, { type: "presence" }> = {
      type: "presence",
      joined,
      left,
      updated,
      online: othersOnline,
    };
    const shared = JSON.stringify(sharedMessage);
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (!attachment) continue;
      const viewer = attachment.userId;
      const hidden = hiddenByUser.get(viewer);
      if (!hidden && !changed.has(viewer)) {
        this.sendRaw(socket, shared);
        continue;
      }
      const visibleTo = (userId: string) => userId !== viewer && !hidden?.has(userId);
      const message: Extract<LobbyServerMessage, { type: "presence" }> = {
        type: "presence",
        joined: joined.filter((user) => visibleTo(user.userId)),
        left: left.filter(visibleTo),
        updated: [
          ...[ownProfiles.get(viewer)].filter((user) => user !== undefined),
          ...updated.filter((user) => visibleTo(user.userId)),
        ],
        online: hidden ? othersOnlineVisible(hidden) : othersOnline,
      };
      if (message.joined.length + message.left.length + message.updated.length === 0) continue;
      this.send(socket, message);
    }
  }

  private prepareStorage(): void {
    const sql = this.ctx.storage.sql;
    this.users.ensureSchema();
    this.maintenance.ensureSchema();
    this.deviceEntries = new SqlRateLimiter(
      sql,
      "entry_device",
      LIMITS.entriesPerDevice.count,
      LIMITS.entriesPerDevice.windowMs,
    );
    this.networkEntries = new SqlRateLimiter(
      sql,
      "entry_network",
      LIMITS.entriesPerNetwork.count,
      LIMITS.entriesPerNetwork.windowMs,
    );
    this.deviceReports = new SqlRateLimiter(
      sql,
      "reports_device",
      LIMITS.reportsPerDevice.count,
      LIMITS.reportsPerDevice.windowMs,
    );
    this.adminRequests = new SqlRateLimiter(
      sql,
      "admin_network",
      LIMITS.adminRequestsPerNetwork.count,
      LIMITS.adminRequestsPerNetwork.windowMs,
    );
    this.webAdminRequests = new SqlRateLimiter(
      sql,
      "web_admin_network",
      LIMITS.webAdminRequestsPerNetwork.count,
      LIMITS.webAdminRequestsPerNetwork.windowMs,
    );
    this.strikes = createStrikeTracker(sql);
    this.contactRejections = new ContactRejectionCounter(sql);
  }

  private send(ws: WebSocket, message: LobbyServerMessage): void {
    this.sendRaw(ws, JSON.stringify(message));
  }

  private sendRaw(ws: WebSocket, frame: string): void {
    try {
      ws.send(frame);
    } catch {
      return;
    }
  }
}
