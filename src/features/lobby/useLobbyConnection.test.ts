import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  KICKED_CLOSE_CODE,
  LEFT_CLOSE_CODE,
  REPLACED_CLOSE_CODE,
  type LobbyServerMessage,
} from "@shared/protocol/lobby";
import { initialAppData, useAppStore } from "@/app/store";
import * as api from "@/lib/api";
import type { ReconnectingSocketOptions } from "@/lib/ReconnectingSocket";
import { lobbyUser } from "./testing";
import { useLobbyConnection } from "./useLobbyConnection";

const sockets = vi.hoisted(() => ({
  created: [] as { opts: ReconnectingSocketOptions<unknown>; sent: unknown[]; closed: boolean }[],
}));

const toast = vi.hoisted(() => vi.fn());
const offline = vi.hoisted(() => ({ value: false }));
vi.mock("sonner", () => ({ toast }));

vi.mock("@/lib/ReconnectingSocket", () => ({
  ReconnectingSocket: class {
    readonly record: (typeof sockets.created)[number];
    constructor(opts: ReconnectingSocketOptions<unknown>) {
      this.record = { opts, sent: [], closed: false };
      sockets.created.push(this.record);
    }
    send(message: unknown): boolean {
      if (offline.value) return false;
      this.record.sent.push(message);
      return true;
    }
    close(): void {
      this.record.closed = true;
    }
  },
}));

const user = lobbyUser;

const me = user("me", { nickname: "me_me" });

function current() {
  const socket = sockets.created.at(-1);
  if (!socket) throw new Error("no socket");
  return socket;
}

function receive(message: LobbyServerMessage) {
  act(() => {
    current().opts.onMessage(current().opts.parse(message));
  });
}

beforeEach(() => {
  sockets.created.length = 0;
  toast.mockClear();
  useAppStore.setState(initialAppData());
  useAppStore.getState().bootstrap({ me, suggestedCountry: "PH", ban: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

it("connects to /api/lobby and asks for page 1 on every open", () => {
  renderHook(() => useLobbyConnection());
  expect(current().opts.url).toMatch(/^ws:\/\/.+\/api\/lobby$/);
  act(() => {
    current().opts.onStatus("open");
  });
  act(() => {
    current().opts.onStatus("open");
  });
  const lists = current().sent.filter((m) => (m as { type: string }).type === "list");
  expect(lists).toHaveLength(2);
  expect(lists[1]).toMatchObject({ type: "list", filter: {} });
  expect(lists[1]).not.toHaveProperty("cursor");
});

it("applies hello, pages and presence to the store", () => {
  renderHook(() => useLobbyConnection());
  act(() => {
    current().opts.onStatus("open");
  });
  const request = current().sent[0] as { requestId: string };
  receive({ type: "hello", me, online: 4, chats: [{ chatId: "c1", peer: user("p") }] });
  receive({
    type: "page",
    requestId: request.requestId,
    users: [user("a")],
    nextCursor: null,
    online: 4,
  });
  receive({ type: "presence", joined: [user("b")], left: [], updated: [], online: 5 });
  const state = useAppStore.getState();
  expect(state.chats.c1).toBeDefined();
  expect(state.lobby.users.map((u) => u.userId)).toEqual(["a"]);
  expect([...state.lobby.pendingJoins]).toEqual(["b"]);
  expect(state.lobby.online).toBe(5);
});

it("parses only objects with a type", () => {
  renderHook(() => useLobbyConnection());
  expect(current().opts.parse("nope")).toBeNull();
  expect(current().opts.parse({ nope: 1 })).toBeNull();
});

it("records a kick", () => {
  renderHook(() => useLobbyConnection());
  receive({ type: "kicked", reason: "idle" });
  expect(useAppStore.getState().session).toMatchObject({ status: "kicked", kickReason: "idle" });
});

it("a maintenance kick shows maintenance and does not reconnect", () => {
  const fetchSession = vi.spyOn(api, "fetchSession");
  renderHook(() => useLobbyConnection());
  receive({ type: "kicked", reason: "maintenance" });
  expect(useAppStore.getState().session.status).toBe("maintenance");
  current().opts.onTerminal?.(KICKED_CLOSE_CODE);
  expect(fetchSession).not.toHaveBeenCalled();
});

it("goes back to entry when the session expired during a long disconnect", async () => {
  vi.spyOn(api, "fetchSession").mockResolvedValue({ me: null, suggestedCountry: "PH", ban: null });
  renderHook(() => useLobbyConnection());
  const socket = current();
  act(() => {
    socket.opts.onGiveUp?.();
  });
  await waitFor(() => {
    expect(useAppStore.getState().session.status).toBe("entry");
  });
  expect(socket.closed).toBe(true);
});

it("shows the ban screen when the session ended in a ban", async () => {
  vi.spyOn(api, "fetchSession").mockResolvedValue({
    me: null,
    suggestedCountry: "PH",
    ban: { until: 99 },
  });
  renderHook(() => useLobbyConnection());
  act(() => {
    current().opts.onGiveUp?.();
  });
  await waitFor(() => {
    expect(useAppStore.getState().session).toMatchObject({ status: "banned", banUntil: 99 });
  });
});

it("keeps trying when the session is still alive after a give-up", async () => {
  const fetchSession = vi
    .spyOn(api, "fetchSession")
    .mockResolvedValue({ me, suggestedCountry: "PH", ban: null });
  renderHook(() => useLobbyConnection());
  act(() => {
    current().opts.onGiveUp?.();
  });
  await waitFor(() => {
    expect(fetchSession).toHaveBeenCalled();
  });
  expect(useAppStore.getState().session.status).toBe("lobby");
  expect(current().closed).toBe(false);
});

it("returns to entry when the server closes with the left code", () => {
  renderHook(() => useLobbyConnection());
  act(() => {
    current().opts.onTerminal?.(LEFT_CLOSE_CODE);
  });
  expect(useAppStore.getState().session).toMatchObject({ status: "entry", me: null });
});

it("thanks the reporter by nickname and hides the reported user", () => {
  renderHook(() => useLobbyConnection());
  act(() => {
    current().opts.onStatus("open");
  });
  const request = current().sent[0] as { requestId: string };
  receive({
    type: "page",
    requestId: request.requestId,
    users: [user("x", { nickname: "mika" })],
    nextCursor: null,
    online: 2,
  });
  receive({ type: "reported", userId: "x" });
  expect(toast).toHaveBeenCalledWith("Thanks. We've blocked mika for you.");
  expect(useAppStore.getState().lobby.users).toEqual([]);
});

it("confirms a block and announces an incoming chat", () => {
  renderHook(() => useLobbyConnection());
  receive({ type: "incomingChat", chatId: "c9", from: user("p", { nickname: "joy" }) });
  expect(useAppStore.getState().chats.c9).toBeDefined();
  expect(useAppStore.getState().announcement?.text).toBe("joy started a chat with you.");
  receive({ type: "blocked", userId: "p" });
  expect(toast).toHaveBeenCalledWith("Blocked joy.");
  expect(useAppStore.getState().chats.c9?.ended).toBe(true);
});

it("tells the user to slow down and when someone is gone", () => {
  renderHook(() => useLobbyConnection());
  receive({ type: "notice", code: "slow_down" });
  receive({ type: "error", code: "user_unavailable" });
  expect(toast).toHaveBeenNthCalledWith(1, "Slow down a bit.");
  expect(toast).toHaveBeenNthCalledWith(2, "That person isn't available anymore.");
});

it("opens the chat I asked for", () => {
  renderHook(() => useLobbyConnection());
  receive({ type: "chatOpened", chatId: "c2", peer: user("p") });
  expect(useAppStore.getState().activeChatId).toBe("c2");
  receive({ type: "chatEnded", chatId: "c2" });
  expect(useAppStore.getState().chats.c2?.ended).toBe(true);
});

it("closes the socket on unmount", () => {
  const { unmount } = renderHook(() => useLobbyConnection());
  unmount();
  expect(current().closed).toBe(true);
});

it("re-checks the session on a later give-up when the first check failed offline", async () => {
  const fetchSession = vi
    .spyOn(api, "fetchSession")
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValue({ me: null, suggestedCountry: "PH", ban: null });
  renderHook(() => useLobbyConnection());
  act(() => {
    current().opts.onGiveUp?.();
  });
  await waitFor(() => {
    expect(fetchSession).toHaveBeenCalledTimes(1);
  });
  expect(useAppStore.getState().session.status).toBe("lobby");
  act(() => {
    current().opts.onGiveUp?.();
  });
  await waitFor(() => {
    expect(useAppStore.getState().session.status).toBe("entry");
  });
});

it("frees a throttled list request and asks for page 1 again after a pause", () => {
  vi.useFakeTimers();
  try {
    renderHook(() => useLobbyConnection());
    act(() => {
      current().opts.onStatus("open");
    });
    useAppStore.getState().setFilter({ genders: ["male"] });
    current().sent.push(useAppStore.getState().requestList(null));
    receive({ type: "notice", code: "slow_down" });
    expect(useAppStore.getState().lobby.request).toBeNull();
    const before = current().sent.length;
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(current().sent.slice(before)).toEqual([
      expect.objectContaining({ type: "list", filter: { genders: ["male"] } }),
    ]);
  } finally {
    vi.useRealTimers();
  }
});

it("tells the user when an action could not be sent while reconnecting", () => {
  const { result } = renderHook(() => useLobbyConnection());
  offline.value = true;
  try {
    expect(result.current.send({ type: "block", userId: "x" })).toBe(false);
    expect(toast).toHaveBeenCalledWith("You're offline. Try again in a moment.");
    toast.mockClear();
    result.current.send(useAppStore.getState().requestList(null));
    expect(toast).not.toHaveBeenCalled();
  } finally {
    offline.value = false;
  }
});

it("a block shows as my block even though the lobby ends the chat before confirming it", () => {
  const { result } = renderHook(() => useLobbyConnection());
  receive({ type: "chatOpened", chatId: "c3", peer: user("p", { nickname: "mika" }) });
  act(() => {
    result.current.send({ type: "block", userId: "p" });
  });
  receive({ type: "chatEnded", chatId: "c3" });
  receive({ type: "blocked", userId: "p" });
  expect(useAppStore.getState().chats.c3).toMatchObject({ ended: true, endedByMe: true });
  expect(useAppStore.getState().announcement?.text).not.toBe("mika left");
});

it("announces that the peer left when the lobby ends the chat", () => {
  renderHook(() => useLobbyConnection());
  receive({ type: "chatOpened", chatId: "c4", peer: user("p", { nickname: "mika" }) });
  receive({ type: "chatEnded", chatId: "c4" });
  expect(useAppStore.getState().announcement?.text).toBe("mika left");
});

it("shows the open-elsewhere screen when another tab takes over the connection", () => {
  const fetchSession = vi.spyOn(api, "fetchSession");
  renderHook(() => useLobbyConnection());
  act(() => {
    current().opts.onTerminal?.(REPLACED_CLOSE_CODE);
  });
  expect(useAppStore.getState().session.status).toBe("elsewhere");
  expect(fetchSession).not.toHaveBeenCalled();
});
