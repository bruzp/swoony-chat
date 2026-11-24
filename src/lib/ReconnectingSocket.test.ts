import { afterEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "@shared/config";
import { ReconnectingSocket, type SocketStatus } from "./ReconnectingSocket";

class FakeSocket {
  readyState = 0;
  sent: string[] = [];
  closedWith: number | undefined;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number) {
    this.closedWith = code ?? 1000;
    this.readyState = 2;
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  fail() {
    this.readyState = 3;
    this.onerror?.(new Event("error"));
    this.onclose?.(new CloseEvent("close", { code: 1006 }));
  }
  closeWith(code: number) {
    this.readyState = 3;
    this.onclose?.(new CloseEvent("close", { code }));
  }
  receive(data: string) {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
}

interface Hi {
  type: "hi";
  n: number;
}

function isHi(raw: unknown): raw is Hi {
  return typeof raw === "object" && raw !== null && (raw as { type?: unknown }).type === "hi";
}

function setup(schedule?: (fn: () => void, ms: number) => void) {
  const delays: number[] = [];
  const sockets: FakeSocket[] = [];
  const statuses: SocketStatus[] = [];
  const messages: Hi[] = [];
  const gaveUp = vi.fn();
  const terminal = vi.fn();
  const rs = new ReconnectingSocket<Hi, { type: "out" }>({
    url: "ws://x",
    parse: (raw) => (isHi(raw) ? raw : null),
    onMessage: (m) => messages.push(m),
    onStatus: (s) => statuses.push(s),
    onGiveUp: gaveUp,
    onTerminal: terminal,
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s as never;
    },
    schedule:
      schedule ??
      ((fn, ms) => {
        delays.push(ms);
        fn();
      }),
    random: () => 0.98,
  });
  const last = () => {
    const s = sockets.at(-1);
    if (!s) throw new Error("no socket");
    return s;
  };
  return { rs, delays, sockets, statuses, messages, gaveUp, terminal, last };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ReconnectingSocket", () => {
  it("backs off, gives up, and stops on terminal codes", () => {
    const { delays, sockets, gaveUp, terminal, last } = setup();
    for (let i = 0; i < LIMITS.socketGiveUpAttempts; i++) sockets[i]?.fail();
    expect(delays.slice(0, 3).map(Math.round)).toEqual([495, 990, 1980]);
    expect(gaveUp).toHaveBeenCalledOnce();
    last().open();
    const count = sockets.length;
    last().closeWith(4001);
    expect(terminal).toHaveBeenCalledWith(4001);
    expect(sockets).toHaveLength(count);
  });

  it("gives up again after every further run of failed attempts", () => {
    const { gaveUp, last } = setup();
    for (let i = 0; i < LIMITS.socketGiveUpAttempts * 2; i++) last().fail();
    expect(gaveUp).toHaveBeenCalledTimes(2);
  });

  it("caps the backoff at 10 seconds", () => {
    const { delays, last } = setup();
    for (let i = 0; i < 8; i++) last().fail();
    expect(Math.max(...delays)).toBeLessThanOrEqual(10_000);
    expect(Math.round(delays.at(-1) ?? 0)).toBe(9_900);
  });

  it("resets the backoff once a connection stays open, and the give-up count on any open", () => {
    vi.useFakeTimers();
    const { delays, gaveUp, last } = setup();
    for (let i = 0; i < 4; i++) last().fail();
    last().open();
    vi.advanceTimersByTime(5_000);
    last().fail();
    expect(Math.round(delays.at(-1) ?? 0)).toBe(495);
    for (let i = 0; i < 3; i++) last().fail();
    expect(gaveUp).not.toHaveBeenCalled();
  });

  it("keeps backing off when the server accepts and drops at once", () => {
    vi.useFakeTimers();
    const { delays, last } = setup();
    for (let i = 0; i < 4; i++) {
      last().open();
      last().closeWith(1011);
    }
    expect(delays.map(Math.round)).toEqual([495, 990, 1980, 3960]);
  });

  it("drops a connection that stops answering pings and reconnects", () => {
    vi.useFakeTimers();
    const { sockets, statuses, last } = setup();
    last().open();
    vi.advanceTimersByTime(25_000);
    expect(last().sent).toEqual(["ping"]);
    vi.advanceTimersByTime(10_000);
    expect(sockets[0]?.closedWith).toBeDefined();
    expect(sockets).toHaveLength(2);
    expect(statuses).toContain("closed");
  });

  it("keeps a connection that answers pings", () => {
    vi.useFakeTimers();
    const { sockets, last } = setup();
    last().open();
    vi.advanceTimersByTime(25_000);
    last().receive("pong");
    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.closedWith).toBeUndefined();
  });

  it("checks an open connection at once when the page becomes visible", () => {
    vi.useFakeTimers();
    const { sockets, last } = setup();
    last().open();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(last().sent).toEqual(["ping"]);
    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(2);
  });

  it("reports status, parses JSON frames and drops invalid ones", () => {
    const { statuses, messages, last } = setup();
    expect(statuses).toEqual(["connecting"]);
    last().open();
    expect(statuses.at(-1)).toBe("open");
    last().receive(JSON.stringify({ type: "hi", n: 1 }));
    last().receive("not json");
    last().receive("pong");
    last().receive(JSON.stringify({ type: "other" }));
    expect(messages).toEqual([{ type: "hi", n: 1 }]);
  });

  it("sends JSON only while open", () => {
    const { rs, last } = setup();
    expect(rs.send({ type: "out" })).toBe(false);
    last().open();
    expect(rs.send({ type: "out" })).toBe(true);
    expect(last().sent).toEqual([JSON.stringify({ type: "out" })]);
  });

  it("close() stops reconnecting and closes the socket", () => {
    const { rs, sockets, statuses, last } = setup();
    last().open();
    rs.close();
    expect(last().closedWith).toBe(1000);
    last().closeWith(1000);
    expect(sockets).toHaveLength(1);
    expect(statuses.at(-1)).toBe("closed");
  });

  it("retries at once when the network returns or the page becomes visible", () => {
    const pending: (() => void)[] = [];
    const { sockets, last } = setup((fn) => pending.push(fn));
    last().fail();
    expect(sockets).toHaveLength(1);
    window.dispatchEvent(new Event("online"));
    expect(sockets).toHaveLength(2);
    pending.shift()?.();
    expect(sockets).toHaveLength(2);

    last().fail();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(sockets).toHaveLength(3);
  });

  it("does not open a second socket on online while already connected", () => {
    const { sockets, last } = setup();
    last().open();
    window.dispatchEvent(new Event("online"));
    expect(sockets).toHaveLength(1);
  });

  it("ignores online and visibility events after close()", () => {
    const pending: (() => void)[] = [];
    const { rs, sockets, last } = setup((fn) => pending.push(fn));
    last().fail();
    rs.close();
    window.dispatchEvent(new Event("online"));
    pending.shift()?.();
    expect(sockets).toHaveLength(1);
  });

  it("pings every 25 seconds while open", () => {
    vi.useFakeTimers();
    const { last, rs } = setup();
    last().open();
    vi.advanceTimersByTime(25_000);
    expect(last().sent).toEqual(["ping"]);
    rs.close();
    vi.advanceTimersByTime(50_000);
    expect(last().sent).toEqual(["ping"]);
  });
});
