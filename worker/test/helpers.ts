import type { ProfileInput, PublicUser } from "@shared/profile";
import type { ChatServerMessage } from "@shared/protocol/chat";
import type { LobbyServerMessage } from "@shared/protocol/lobby";
import { isCleanNickname } from "@shared/text/profanity";
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { handleRequest } from "../app";
import { createDeps, type AppDeps } from "../deps";
import type { ChatRoom } from "../chat/ChatRoom";
import { lobbyStub } from "../lobby/lobbyStub";

export const ORIGIN = "http://localhost";
const DEFAULT_TIMEOUT_MS = 2_000;

export const deps: AppDeps = {
  ...createDeps(env),
  botCheck: { verify: (token) => Promise.resolve(token !== "fail") },
};

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function uniqueName(prefix = "u"): string {
  for (;;) {
    const name = `${prefix}${randomHex(3)}`;
    if (isCleanNickname(name)) return name;
  }
}

const usedIps = new Set<string>();

export function uniqueIp(): string {
  for (;;) {
    const [a = 0, b = 0, c = 0] = crypto.getRandomValues(new Uint8Array(3));
    const ip = `10.${String(a)}.${String(b)}.${String(c)}`;
    if (!usedIps.has(ip)) {
      usedIps.add(ip);
      return ip;
    }
  }
}

function cookieFrom(res: Response): string | null {
  const setCookie = res.headers.get("Set-Cookie");
  return setCookie ? (setCookie.split(";")[0] ?? null) : null;
}

export interface EnterOptions {
  ip?: string;
  cookie?: string;
  confirmedAdult?: boolean;
  turnstileToken?: string;
  origin?: string;
  country?: string;
}

export async function enter(
  profile: Partial<ProfileInput> = {},
  opts: EnterOptions = {},
): Promise<{ cookie: string; me: PublicUser; res: Response }> {
  const body = {
    nickname: uniqueName(),
    gender: "female",
    age: 24,
    country: "PH",
    ...profile,
    confirmedAdult: opts.confirmedAdult ?? true,
    turnstileToken: opts.turnstileToken ?? "ok",
  };
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Origin: opts.origin ?? ORIGIN,
    "CF-Connecting-IP": opts.ip ?? uniqueIp(),
  };
  if (opts.cookie) headers.Cookie = opts.cookie;
  const res = await handleRequest(
    new Request(`${ORIGIN}/api/session`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cf: { country: opts.country ?? "PH" },
    }),
    env,
    deps,
  );
  const payload = await res.clone().json<{ me: PublicUser }>();
  const cookie = cookieFrom(res) ?? opts.cookie ?? "";
  return { cookie, me: payload.me, res };
}

export async function getSession(
  cookie: string | null,
  opts: { country?: string; ip?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = { "CF-Connecting-IP": opts.ip ?? uniqueIp() };
  if (cookie) headers.Cookie = cookie;
  return handleRequest(
    new Request(`${ORIGIN}/api/session`, { headers, cf: { country: opts.country ?? "PH" } }),
    env,
    deps,
  );
}

export async function rawUpgrade(
  path: string,
  cookie: string | null,
  origin: string = ORIGIN,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    Upgrade: "websocket",
    Origin: origin,
    "CF-Connecting-IP": uniqueIp(),
    ...extraHeaders,
  };
  if (cookie) headers.Cookie = cookie;
  return handleRequest(new Request(`${ORIGIN}${path}`, { headers }), env, deps);
}

type AnyMessage = { type: string } & Record<string, unknown>;
type ServerMessage = LobbyServerMessage | ChatServerMessage;
export type Msg<T extends string> =
  Extract<ServerMessage, { type: T }> extends never
    ? AnyMessage & { type: T }
    : Extract<ServerMessage, { type: T }>;

interface Waiter {
  pred: (message: AnyMessage) => boolean;
  resolve: (message: AnyMessage) => void;
}

export interface SocketClose {
  code: number;
  reason: string;
}

export class TestSocket {
  readonly closed: Promise<SocketClose>;
  private readonly buffered = new Map<string, AnyMessage[]>();
  private readonly waiters = new Map<string, Waiter[]>();

  constructor(private readonly ws: WebSocket) {
    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      if (event.data === "pong") {
        this.receive({ type: "pong" });
        return;
      }
      this.receive(JSON.parse(event.data) as AnyMessage);
    });
    this.closed = new Promise((resolve) => {
      ws.addEventListener("close", (event) => {
        resolve({ code: event.code, reason: event.reason });
      });
    });
    ws.accept();
  }

  next<T extends string>(type: T, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Msg<T>> {
    return this.nextWhere(type, () => true, timeoutMs);
  }

  nextWhere<T extends string>(
    type: T,
    pred: (message: Msg<T>) => boolean,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<Msg<T>> {
    const matches = (message: AnyMessage) => pred(message as unknown as Msg<T>);
    const queue = this.buffered.get(type) ?? [];
    const index = queue.findIndex(matches);
    if (index !== -1) {
      const [found] = queue.splice(index, 1);
      return Promise.resolve(found as unknown as Msg<T>);
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        pred: matches,
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message as unknown as Msg<T>);
        },
      };
      const timer = setTimeout(() => {
        this.removeWaiter(type, waiter);
        reject(new Error(`timed out waiting for "${type}"`));
      }, timeoutMs);
      this.waiters.set(type, [...(this.waiters.get(type) ?? []), waiter]);
    });
  }

  async expectNone(type: string, waitMs = 300): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    const queued = this.buffered.get(type) ?? [];
    if (queued.length > 0) throw new Error(`unexpected "${type}": ${JSON.stringify(queued[0])}`);
  }

  send(msg: object): void {
    this.ws.send(JSON.stringify(msg));
  }

  sendRaw(raw: string): void {
    this.ws.send(raw);
  }

  async ping(): Promise<void> {
    this.ws.send("ping");
    await this.next("pong");
  }

  async close(): Promise<void> {
    this.ws.close(1000, "done");
    await this.closed;
  }

  private receive(message: AnyMessage): void {
    const waiters = this.waiters.get(message.type) ?? [];
    const waiter = waiters.find((candidate) => candidate.pred(message));
    if (waiter) {
      this.removeWaiter(message.type, waiter);
      waiter.resolve(message);
      return;
    }
    this.buffered.set(message.type, [...(this.buffered.get(message.type) ?? []), message]);
  }

  private removeWaiter(type: string, waiter: Waiter): void {
    this.waiters.set(
      type,
      (this.waiters.get(type) ?? []).filter((candidate) => candidate !== waiter),
    );
  }
}

export async function openLobby(
  cookie: string,
  opts: { origin?: string } = {},
): Promise<TestSocket> {
  const res = await rawUpgrade("/api/lobby", cookie, opts.origin ?? ORIGIN);
  if (!res.webSocket) throw new Error(`lobby upgrade failed with ${String(res.status)}`);
  return new TestSocket(res.webSocket);
}

export async function deviceIdFrom(cookie: string): Promise<string> {
  const deviceId = await deps.cookies.read(new Request(ORIGIN, { headers: { Cookie: cookie } }));
  if (!deviceId) throw new Error("cookie carries no valid device id");
  return deviceId;
}

export async function resetLobby(): Promise<void> {
  await lobbyStub(env).resetForTests();
}

export async function advanceLobbyClock(ms: number): Promise<void> {
  await lobbyStub(env).advanceClockForTests(ms);
}

export async function fireLobbyAlarm(): Promise<boolean> {
  return runDurableObjectAlarm(lobbyStub(env));
}

export async function lobbySession(cookie: string): Promise<PublicUser | null> {
  return lobbyStub(env).getSession(await deviceIdFrom(cookie));
}

export async function lobbyUserCount(): Promise<number> {
  return runInDurableObject(
    lobbyStub(env),
    (_instance, state) =>
      state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM users").one().n,
  );
}

export async function simulateLobbyRestart(): Promise<void> {
  await lobbyStub(env).flushPresenceForTests();
  await evictDurableObject(lobbyStub(env), { webSockets: "close" });
}

export async function hibernateLobby(): Promise<void> {
  await lobbyStub(env).flushPresenceForTests();
  await evictDurableObject(lobbyStub(env));
}

export async function inLobby(profile: Partial<ProfileInput> = {}, opts: EnterOptions = {}) {
  const user = await enter(profile, opts);
  const ws = await openLobby(user.cookie);
  await ws.next("hello");
  return { ...user, ws };
}

export async function twoUsersInLobby() {
  const a = await inLobby();
  const b = await inLobby();
  return { a, b, wa: a.ws, wb: b.ws };
}

export function chatUpgrade(
  cookie: string | null,
  chatId: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return rawUpgrade(`/api/chat/${chatId}`, cookie, ORIGIN, extraHeaders);
}

export async function openChat(cookie: string, chatId: string): Promise<TestSocket> {
  const res = await chatUpgrade(cookie, chatId);
  if (!res.webSocket) throw new Error(`chat upgrade failed with ${String(res.status)}`);
  return new TestSocket(res.webSocket);
}

export async function openPairChat() {
  const { a, b, wa, wb } = await twoUsersInLobby();
  wa.send({ type: "openChat", userId: b.me.userId });
  const { chatId } = await wa.next("chatOpened");
  const ca = await openChat(a.cookie, chatId);
  ca.send({ type: "resume", afterSeq: 0 });
  await ca.next("history");
  const cb = await openChat(b.cookie, chatId);
  cb.send({ type: "resume", afterSeq: 0 });
  await cb.next("history");
  return { a, b, wa, wb, chatId, ca, cb };
}

function chatStub(chatId: string): DurableObjectStub<ChatRoom> {
  return env.CHAT_ROOM.getByName(chatId);
}

export async function chatMessageCount(chatId: string): Promise<number> {
  return runInDurableObject(chatStub(chatId), (_instance, state) => {
    const sql = state.storage.sql;
    const tables = sql
      .exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'messages'")
      .toArray();
    if (tables.length === 0) return 0;
    return sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM messages").one().n;
  });
}

export async function fireChatAlarm(chatId: string): Promise<boolean> {
  return runDurableObjectAlarm(chatStub(chatId));
}

export async function advanceChatClock(chatId: string, ms: number): Promise<void> {
  await chatStub(chatId).advanceClockForTests(ms);
}
