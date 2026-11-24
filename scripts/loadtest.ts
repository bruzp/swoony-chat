import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    base: { type: "string", default: "http://localhost:5173" },
    users: { type: "string", default: "1000" },
    ramp: { type: "string", default: "100" },
    duration: { type: "string", default: "300" },
    "message-every": { type: "string", default: "5" },
  },
});

const BASE = new URL(args.base);
const WS_BASE = `${BASE.protocol === "https:" ? "wss:" : "ws:"}//${BASE.host}`;
const USERS = Number(args.users);
const RAMP_MS = Number(args.ramp) * 1000;
const DURATION_MS = Number(args.duration) * 1000;
const MESSAGE_EVERY_MS = Number(args["message-every"]) * 1000;
const PING_EVERY_MS = 25_000;
const PROGRESS_EVERY_MS = 10_000;
const RUN_ID = Math.random().toString(36).slice(2, 6);
const GENDERS = ["male", "female", "other"] as const;
const COUNTRIES = ["PH", "US", "IN", "CA", "SG", "JP", "DE", "BR"];
const WORDS = [
  "hello",
  "there",
  "friend",
  "how",
  "are",
  "you",
  "today",
  "nice",
  "weather",
  "coffee",
  "music",
  "movie",
  "weekend",
  "travel",
  "beach",
  "mountain",
  "dinner",
  "sunny",
  "rainy",
  "cool",
  "really",
  "maybe",
  "later",
  "great",
  "funny",
  "story",
  "book",
  "game",
  "city",
  "night",
];

interface Stats {
  entryMs: number[];
  listMs: number[];
  echoMs: number[];
  deliveredToPeer: number;
  sent: number;
  presenceFrames: number;
  errors: Map<string, number>;
  online: number;
  joined: number;
  chatsOpen: number;
}

const stats: Stats = {
  entryMs: [],
  listMs: [],
  echoMs: [],
  deliveredToPeer: 0,
  sent: 0,
  presenceFrames: 0,
  errors: new Map(),
  online: 0,
  joined: 0,
  chatsOpen: 0,
};

function countError(kind: string): void {
  stats.errors.set(kind, (stats.errors.get(kind) ?? 0) + 1);
}

function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return Math.round(
    sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0,
  );
}

function summary(samples: number[]): string {
  return `n=${String(samples.length)} p50=${String(percentile(samples, 50))}ms p95=${String(percentile(samples, 95))}ms p99=${String(percentile(samples, 99))}ms`;
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

function randomSentence(): string {
  return Array.from({ length: 4 + Math.floor(Math.random() * 5) }, () => pick(WORDS)).join(" ");
}

function fakeIp(index: number): string {
  return `10.${String((index >> 16) & 255)}.${String((index >> 8) & 255)}.${String(index & 255)}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class FakeUser {
  readonly index: number;
  readonly ip: string;
  cookie = "";
  userId = "";
  lobby: WebSocket | null = null;
  chat: WebSocket | null = null;
  pending = new Map<string, number>();
  timers: ReturnType<typeof setInterval>[] = [];
  listSentAt = 0;
  chatOpened: (chatId: string) => void = () => undefined;

  constructor(index: number) {
    this.index = index;
    this.ip = fakeIp(index + 1);
  }

  headers(): Record<string, string> {
    return { Origin: BASE.origin, "CF-Connecting-IP": this.ip, Cookie: this.cookie };
  }

  async enter(): Promise<boolean> {
    const started = performance.now();
    const response = await fetch(new URL("/api/session", BASE), {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({
        nickname: `lt${RUN_ID}_${String(this.index)}`,
        gender: pick(GENDERS),
        age: 18 + Math.floor(Math.random() * 40),
        country: pick(COUNTRIES),
        confirmedAdult: true,
        turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
      }),
    }).catch(() => null);
    if (!response) {
      countError("entry_network_error");
      return false;
    }
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0] ?? "";
    const body = (await response.json().catch(() => ({}))) as {
      me?: { userId: string };
      error?: string;
    };
    if (!response.ok || !body.me) {
      countError(`entry_${body.error ?? String(response.status)}`);
      return false;
    }
    stats.entryMs.push(performance.now() - started);
    this.userId = body.me.userId;
    return true;
  }

  openSocket(path: string): Promise<WebSocket | null> {
    return new Promise((resolve) => {
      const socket = new WebSocket(`${WS_BASE}${path}`, {
        headers: this.headers(),
      });
      socket.addEventListener("open", () => {
        resolve(socket);
      });
      socket.addEventListener("error", () => {
        countError(`ws_error_${path.split("/")[2] ?? path}`);
        resolve(null);
      });
      this.timers.push(
        setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send("ping");
        }, PING_EVERY_MS),
      );
    });
  }

  async connectLobby(): Promise<boolean> {
    this.lobby = await this.openSocket("/api/lobby");
    if (!this.lobby) return false;
    this.lobby.addEventListener("message", (event) => {
      this.onLobbyMessage(String(event.data));
    });
    this.lobby.addEventListener("close", (event) => {
      if (!stopping) countError(`lobby_closed_${String(event.code)}`);
    });
    this.listSentAt = performance.now();
    this.lobby.send(JSON.stringify({ type: "list", requestId: "r1", filter: {} }));
    return true;
  }

  onLobbyMessage(raw: string): void {
    if (raw === "pong") return;
    const message = JSON.parse(raw) as {
      type: string;
      online?: number;
      chatId?: string;
      code?: string;
      reason?: string;
    };
    if (message.online !== undefined) stats.online = Math.max(stats.online, message.online);
    switch (message.type) {
      case "page":
        stats.listMs.push(performance.now() - this.listSentAt);
        break;
      case "presence":
        stats.presenceFrames++;
        break;
      case "chatOpened":
      case "incomingChat":
        if (message.chatId) this.chatOpened(message.chatId);
        break;
      case "error":
      case "notice":
        countError(`lobby_${message.type}_${message.code ?? ""}`);
        break;
      case "kicked":
        countError(`kicked_${message.reason ?? ""}`);
        break;
    }
  }

  waitForChat(): Promise<string | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(null);
      }, 30_000);
      this.chatOpened = (chatId) => {
        clearTimeout(timeout);
        resolve(chatId);
      };
    });
  }

  async connectChat(chatId: string): Promise<boolean> {
    this.chat = await this.openSocket(`/api/chat/${chatId}`);
    if (!this.chat) return false;
    this.chat.send(JSON.stringify({ type: "resume", afterSeq: 0 }));
    stats.chatsOpen++;
    this.chat.addEventListener("message", (event) => {
      this.onChatMessage(String(event.data));
    });
    this.chat.addEventListener("close", (event) => {
      if (!stopping) countError(`chat_closed_${String(event.code)}`);
    });
    return true;
  }

  onChatMessage(raw: string): void {
    if (raw === "pong") return;
    const message = JSON.parse(raw) as {
      type: string;
      from?: string;
      clientId?: string;
      reason?: string;
      messages?: { from: string }[];
    };
    if (message.type === "history") {
      stats.deliveredToPeer += (message.messages ?? []).filter(
        (m) => m.from !== this.userId,
      ).length;
    } else if (message.type === "message") {
      if (message.from === this.userId && message.clientId) {
        const sentAt = this.pending.get(message.clientId);
        if (sentAt !== undefined) {
          stats.echoMs.push(performance.now() - sentAt);
          this.pending.delete(message.clientId);
        }
      } else {
        stats.deliveredToPeer++;
      }
    } else if (message.type === "rejected") {
      countError(`message_rejected_${message.reason ?? ""}`);
    } else if (message.type === "ended") {
      countError("chat_ended_early");
    }
  }

  startTalking(): void {
    let counter = 0;
    const jitter = Math.random() * MESSAGE_EVERY_MS;
    setTimeout(() => {
      this.timers.push(
        setInterval(() => {
          if (stopping || this.chat?.readyState !== WebSocket.OPEN) return;
          const clientId = `c${String(this.index)}_${String(counter++)}`;
          this.pending.set(clientId, performance.now());
          this.chat.send(JSON.stringify({ type: "send", clientId, text: randomSentence() }));
          stats.sent++;
        }, MESSAGE_EVERY_MS),
      );
    }, jitter);
  }

  leave(): void {
    for (const timer of this.timers) clearInterval(timer);
    if (this.lobby?.readyState === WebSocket.OPEN) {
      this.lobby.send(JSON.stringify({ type: "leave" }));
    }
    this.chat?.close();
    setTimeout(() => this.lobby?.close(), 500);
  }
}

let stopping = false;

async function runPair(opener: FakeUser, receiver: FakeUser): Promise<void> {
  for (const user of [opener, receiver]) {
    if (!(await user.enter()) || !(await user.connectLobby())) return;
    stats.joined++;
  }
  const openerChat = opener.waitForChat();
  const receiverChat = receiver.waitForChat();
  opener.lobby?.send(JSON.stringify({ type: "openChat", userId: receiver.userId }));
  const openerChatId = await openerChat;
  if (!openerChatId || !(await opener.connectChat(openerChatId))) {
    countError("chat_open_failed");
    return;
  }
  opener.startTalking();
  const receiverChatId = await receiverChat;
  if (!receiverChatId || !(await receiver.connectChat(receiverChatId))) {
    countError("incoming_chat_failed");
    return;
  }
  receiver.startTalking();
}

function printProgress(startedAt: number): void {
  const seconds = Math.round((performance.now() - startedAt) / 1000);
  const errors = [...stats.errors].map(([kind, n]) => `${kind}=${String(n)}`).join(" ");
  console.info(
    `[${String(seconds)}s] joined=${String(stats.joined)} online=${String(stats.online)} chats=${String(stats.chatsOpen)} sent=${String(stats.sent)} delivered=${String(stats.deliveredToPeer)} echo p95=${String(percentile(stats.echoMs.slice(-2000), 95))}ms ${errors}`,
  );
}

async function main(): Promise<void> {
  console.info(
    `Load test ${RUN_ID}: ${String(USERS)} users against ${BASE.origin}, ramp ${String(RAMP_MS / 1000)}s, then ${String(DURATION_MS / 1000)}s steady`,
  );
  const users = Array.from({ length: USERS }, (_, index) => new FakeUser(index));
  const startedAt = performance.now();
  const progress = setInterval(() => {
    printProgress(startedAt);
  }, PROGRESS_EVERY_MS);
  const pairGapMs = RAMP_MS / Math.max(1, USERS / 2);
  const pairs: Promise<void>[] = [];
  for (let i = 0; i + 1 < USERS; i += 2) {
    pairs.push(runPair(users[i] as FakeUser, users[i + 1] as FakeUser));
    await sleep(pairGapMs);
  }
  await Promise.all(pairs);
  console.info("Ramp finished, steady load running.");
  await sleep(DURATION_MS);
  stopping = true;
  clearInterval(progress);
  printProgress(startedAt);
  for (const user of users) user.leave();
  await sleep(2000);

  const errorTotal = [...stats.errors.values()].reduce((a, b) => a + b, 0);
  const errorRate = stats.sent === 0 ? 0 : (100 * errorTotal) / (stats.sent + USERS);
  console.info("\n=== Results ===");
  console.info(`Users joined:      ${String(stats.joined)} / ${String(USERS)}`);
  console.info(`Peak online:       ${String(stats.online)}`);
  console.info(`Chats connected:   ${String(stats.chatsOpen)} sockets`);
  console.info(`Entry:             ${summary(stats.entryMs)}`);
  console.info(`First list page:   ${summary(stats.listMs)}`);
  console.info(`Message round trip ${summary(stats.echoMs)}`);
  console.info(
    `Messages sent:     ${String(stats.sent)}, delivered to peer: ${String(stats.deliveredToPeer)}`,
  );
  console.info(`Presence frames:   ${String(stats.presenceFrames)}`);
  console.info(
    `Errors:            ${errorTotal === 0 ? "none" : JSON.stringify(Object.fromEntries(stats.errors))}`,
  );
  console.info(`Error rate:        ${errorRate.toFixed(2)}%`);
  const p95 = percentile(stats.echoMs, 95);
  console.info(
    `\nVerdict: ${p95 <= 500 && errorRate <= 1 ? "PASS" : "FAIL"} (target p95 <= 500ms, errors <= 1%)`,
  );
  process.exit(0);
}

void main();
