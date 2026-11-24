import { LIMITS } from "@shared/config";

export type SocketStatus = "connecting" | "open" | "closed";

export type SocketLike = Pick<
  WebSocket,
  "readyState" | "send" | "close" | "onopen" | "onclose" | "onmessage" | "onerror"
>;

export interface ReconnectingSocketOptions<In> {
  url: string;
  parse: (raw: unknown) => In | null;
  onMessage: (message: In) => void;
  onStatus: (status: SocketStatus) => void;
  onGiveUp?: () => void;
  onTerminal?: (code: number) => void;
  createSocket?: (url: string) => SocketLike;
  schedule?: (fn: () => void, ms: number) => void;
  random?: () => number;
}

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 10_000;
const PING_INTERVAL_MS = 25_000;
const PONG_TIMEOUT_MS = 10_000;
const STABLE_OPEN_MS = 5_000;
const PING = "ping";
const PONG = "pong";
const OPEN = 1;

function isTerminalCode(code: number): boolean {
  return code >= 4000 && code <= 4999;
}

export class ReconnectingSocket<In, Out> {
  readonly #opts: ReconnectingSocketOptions<In>;
  readonly #createSocket: (url: string) => SocketLike;
  readonly #schedule: (fn: () => void, ms: number) => void;
  readonly #random: () => number;
  #socket: SocketLike | null = null;
  #stopped = false;
  #attempt = 0;
  #failuresWithoutOpen = 0;
  #retryToken = 0;
  #pingTimer: ReturnType<typeof setInterval> | undefined;
  #pongTimer: ReturnType<typeof setTimeout> | undefined;
  #stableTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(opts: ReconnectingSocketOptions<In>) {
    this.#opts = opts;
    this.#createSocket = opts.createSocket ?? ((url) => new WebSocket(url));
    this.#schedule =
      opts.schedule ??
      ((fn, ms) => {
        setTimeout(fn, ms);
      });
    this.#random = opts.random ?? Math.random;
    window.addEventListener("online", this.#onWake);
    document.addEventListener("visibilitychange", this.#onVisibilityChange);
    this.#connect();
  }

  send(message: Out): boolean {
    const socket = this.#socket;
    if (!socket || socket.readyState !== OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  close(): void {
    if (this.#stopped) return;
    this.#stop();
    const socket = this.#socket;
    this.#socket = null;
    socket?.close(1000);
    this.#opts.onStatus("closed");
  }

  #connect(): void {
    if (this.#stopped) return;
    const socket = this.#createSocket(this.#opts.url);
    this.#socket = socket;
    let opened = false;
    this.#opts.onStatus("connecting");

    socket.onopen = () => {
      if (this.#socket !== socket) return;
      opened = true;
      this.#failuresWithoutOpen = 0;
      this.#stableTimer = setTimeout(() => {
        this.#attempt = 0;
      }, STABLE_OPEN_MS);
      this.#startPing(socket);
      this.#opts.onStatus("open");
    };
    socket.onmessage = (event) => {
      if (this.#socket !== socket) return;
      this.#clearPongTimer();
      this.#handleFrame(event.data);
    };
    socket.onclose = (event) => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      this.#stopTimers();
      this.#opts.onStatus("closed");
      if (isTerminalCode(event.code)) {
        this.#stop();
        this.#opts.onTerminal?.(event.code);
        return;
      }
      if (!opened) this.#countFailure();
      this.#scheduleReconnect();
    };
  }

  #handleFrame(data: unknown): void {
    if (typeof data !== "string" || data === PONG) return;
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      return;
    }
    const message = this.#opts.parse(raw);
    if (message !== null) this.#opts.onMessage(message);
  }

  #countFailure(): void {
    this.#failuresWithoutOpen += 1;
    if (this.#failuresWithoutOpen % LIMITS.socketGiveUpAttempts === 0) this.#opts.onGiveUp?.();
  }

  #scheduleReconnect(): void {
    if (this.#stopped) return;
    const backoff = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** this.#attempt);
    const delay = backoff * (0.5 + 0.5 * this.#random());
    this.#attempt += 1;
    const token = ++this.#retryToken;
    this.#schedule(() => {
      if (token === this.#retryToken && !this.#socket) this.#connect();
    }, delay);
  }

  readonly #retryNow = (): void => {
    if (this.#stopped || this.#socket) return;
    this.#retryToken += 1;
    this.#connect();
  };

  readonly #onWake = (): void => {
    if (this.#socket) this.#probe(this.#socket);
    else this.#retryNow();
  };

  readonly #onVisibilityChange = (): void => {
    if (document.visibilityState === "visible") this.#onWake();
  };

  #startPing(socket: SocketLike): void {
    this.#pingTimer = setInterval(() => {
      this.#probe(socket);
    }, PING_INTERVAL_MS);
  }

  #probe(socket: SocketLike): void {
    if (socket.readyState !== OPEN || this.#pongTimer !== undefined) return;
    socket.send(PING);
    this.#pongTimer = setTimeout(() => {
      this.#dropDeadSocket(socket);
    }, PONG_TIMEOUT_MS);
  }

  #dropDeadSocket(socket: SocketLike): void {
    if (this.#socket !== socket) return;
    this.#socket = null;
    this.#stopTimers();
    socket.close();
    this.#opts.onStatus("closed");
    this.#scheduleReconnect();
  }

  #clearPongTimer(): void {
    clearTimeout(this.#pongTimer);
    this.#pongTimer = undefined;
  }

  #stopTimers(): void {
    clearInterval(this.#pingTimer);
    this.#pingTimer = undefined;
    clearTimeout(this.#stableTimer);
    this.#stableTimer = undefined;
    this.#clearPongTimer();
  }

  #stop(): void {
    this.#stopped = true;
    this.#retryToken += 1;
    this.#stopTimers();
    window.removeEventListener("online", this.#onWake);
    document.removeEventListener("visibilitychange", this.#onVisibilityChange);
  }
}
