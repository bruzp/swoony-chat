import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CHAT_ENDED_CLOSE_CODE, type ChatServerMessage } from "@shared/protocol/chat";
import { REPLACED_CLOSE_CODE } from "@shared/protocol/lobby";
import { initialAppData, useAppStore } from "@/app/store";
import type { ReconnectingSocketOptions } from "@/lib/ReconnectingSocket";
import { lobbyUser } from "@/features/lobby/testing";
import { LIMITS } from "@shared/config";
import {
  retryChatMessage,
  sendChatSeen,
  sendChatText,
  sendChatTyping,
  useChatConnection,
} from "./useChatConnection";

const sockets = vi.hoisted(() => ({
  created: [] as { opts: ReconnectingSocketOptions<unknown>; sent: unknown[]; closed: boolean }[],
  offline: false,
}));

vi.mock("@/lib/ReconnectingSocket", () => ({
  ReconnectingSocket: class {
    readonly record: (typeof sockets.created)[number];
    constructor(opts: ReconnectingSocketOptions<unknown>) {
      this.record = { opts, sent: [], closed: false };
      sockets.created.push(this.record);
    }
    send(message: unknown): boolean {
      if (sockets.offline) return false;
      this.record.sent.push(message);
      return true;
    }
    close(): void {
      this.record.closed = true;
    }
  },
}));

const me = lobbyUser("me", { nickname: "me_me" });
const mika = lobbyUser("p", { nickname: "mika" });
const CHAT = "c1";

function socket() {
  const latest = sockets.created.at(-1);
  if (!latest) throw new Error("no socket");
  return latest;
}

function receive(message: ChatServerMessage) {
  act(() => {
    socket().opts.onMessage(socket().opts.parse(message));
  });
}

function open() {
  act(() => {
    socket().opts.onStatus("open");
  });
}

function drop() {
  act(() => {
    socket().opts.onStatus("closed");
  });
}

function chat() {
  const state = useAppStore.getState().chats[CHAT];
  if (!state) throw new Error("no chat");
  return state;
}

function message(seq: number, from: string, text = `m${String(seq)}`, clientId?: string) {
  return { seq, from, text, sentAt: seq, ...(clientId ? { clientId } : {}) };
}

beforeEach(() => {
  sockets.created.length = 0;
  sockets.offline = false;
  sessionStorage.clear();
  useAppStore.setState(initialAppData());
  useAppStore.getState().bootstrap({ me, suggestedCountry: "PH", ban: null });
  useAppStore.getState().chatOpened({ chatId: CHAT, peer: mika }, false);
});

it("connects to the chat and asks to resume after the last seen message", () => {
  renderHook(() => {
    useChatConnection(CHAT);
  });
  expect(socket().opts.url).toMatch(/\/api\/chat\/c1$/);
  open();
  expect(chat().connected).toBe(true);
  receive({ type: "message", ...message(4, "p") });
  drop();
  open();
  expect(socket().sent.at(-1)).toEqual({ type: "resume", afterSeq: 4 });
});

it("after reload shows the full history without counting already-read messages as unread", () => {
  sessionStorage.setItem("swoony-seq-c9", "2");
  useAppStore.getState().hello({
    type: "hello",
    me,
    online: 2,
    chats: [{ chatId: "c9", peer: mika }],
  });
  renderHook(() => {
    useChatConnection("c9");
  });
  open();
  receive({
    type: "history",
    messages: [message(1, "p"), message(2, "me"), message(3, "p")],
    peerSeen: 0,
  });
  const restored = useAppStore.getState().chats.c9;
  expect(restored?.messages.map((m) => m.seq)).toEqual([1, 2, 3]);
  expect(restored?.unread).toBe(1);
});

it("history clears the pending bubble of a message stored before the socket dropped", () => {
  renderHook(() => {
    useChatConnection(CHAT);
  });
  open();
  expect(sendChatText(CHAT, "stored")).toBe(true);
  expect(sendChatText(CHAT, "lost")).toBe(true);
  const [stored, lost] = chat().pending;
  drop();
  open();
  receive({
    type: "history",
    messages: [message(1, "me", "stored", stored?.clientId)],
    peerSeen: 0,
  });
  expect(chat().messages.map((m) => m.text)).toEqual(["stored"]);
  expect(chat().pending).toEqual([{ clientId: lost?.clientId, text: "lost", failed: "not_sent" }]);
  const sentBefore = socket().sent.length;
  retryChatMessage(CHAT, lost?.clientId ?? "");
  expect(socket().sent.slice(sentBefore)).toEqual([
    expect.objectContaining({ type: "send", text: "lost" }),
  ]);
  expect(chat().pending).toHaveLength(1);
  expect(chat().pending[0]).toMatchObject({ text: "lost" });
  expect(chat().pending[0]?.failed).toBeUndefined();
});

it("marks a message failed at once when the connection dropped after opening", () => {
  renderHook(() => {
    useChatConnection(CHAT);
  });
  open();
  sockets.offline = true;
  expect(sendChatText(CHAT, "hi")).toBe(false);
  expect(chat().pending).toEqual([expect.objectContaining({ text: "hi", failed: "not_sent" })]);
});

it("holds a message sent before the first connection and sends it once the chat opens", () => {
  renderHook(() => {
    useChatConnection(CHAT);
  });
  sockets.offline = true;
  expect(sendChatText(CHAT, "hi")).toBe(true);
  expect(chat().pending[0]?.failed).toBeUndefined();
  sockets.offline = false;
  open();
  const clientId = chat().pending[0]?.clientId;
  expect(socket().sent).toEqual([
    { type: "resume", afterSeq: 0 },
    { type: "send", clientId, text: "hi" },
  ]);
  receive({ type: "history", messages: [], peerSeen: 0 });
  expect(chat().pending[0]?.failed).toBeUndefined();
});

it("marks a held message failed when the chat never connects", () => {
  vi.useFakeTimers();
  try {
    renderHook(() => {
      useChatConnection(CHAT);
    });
    sockets.offline = true;
    sendChatText(CHAT, "hi");
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(chat().pending).toEqual([expect.objectContaining({ text: "hi", failed: "not_sent" })]);
  } finally {
    vi.useRealTimers();
  }
});

it("a server rejection marks the pending message failed", () => {
  renderHook(() => {
    useChatConnection(CHAT);
  });
  open();
  sendChatText(CHAT, "too fast");
  const clientId = chat().pending[0]?.clientId ?? "";
  receive({ type: "rejected", clientId, reason: "slow_down" });
  expect(chat().pending[0]?.failed).toBe("slow_down");
});

it("ended close code stops reconnecting and announces that the peer left", () => {
  renderHook(() => {
    useChatConnection(CHAT);
  });
  act(() => {
    socket().opts.onTerminal?.(CHAT_ENDED_CLOSE_CODE);
  });
  expect(chat().ended).toBe(true);
  expect(useAppStore.getState().announcement?.text).toBe("mika left");
});

it("announces incoming messages for a background chat", () => {
  useAppStore.getState().chatOpened({ chatId: "other", peer: lobbyUser("q") }, true);
  renderHook(() => {
    useChatConnection(CHAT);
  });
  open();
  receive({ type: "message", ...message(1, "p", "hello you") });
  expect(useAppStore.getState().announcement?.text).toBe("New message from mika: hello you");
  useAppStore.getState().setActiveChat(CHAT);
  receive({ type: "message", ...message(2, "p", "second") });
  expect(useAppStore.getState().announcement?.text).toBe("New message from mika: hello you");
});

it("closes the socket on unmount", () => {
  const { unmount } = renderHook(() => {
    useChatConnection(CHAT);
  });
  unmount();
  expect(socket().closed).toBe(true);
});

it("shows the open-elsewhere screen when another tab takes over the chat", () => {
  renderHook(() => {
    useChatConnection(CHAT);
  });
  act(() => {
    socket().opts.onTerminal?.(REPLACED_CLOSE_CODE);
  });
  expect(useAppStore.getState().session.status).toBe("elsewhere");
  expect(chat().ended).toBe(false);
});

it("history and seen updates tell the chat what the peer has seen", () => {
  renderHook(() => {
    useChatConnection(CHAT);
  });
  open();
  receive({ type: "history", messages: [message(1, "me"), message(2, "me")], peerSeen: 1 });
  expect(chat().peerSeen).toBe(1);
  receive({ type: "seen", seq: 2 });
  expect(chat().peerSeen).toBe(2);
  receive({ type: "seen", seq: 1 });
  expect(chat().peerSeen).toBe(2);
});

it("shows the peer typing for a few seconds, and stops when their message arrives", () => {
  vi.useFakeTimers();
  try {
    renderHook(() => {
      useChatConnection(CHAT);
    });
    open();
    receive({ type: "typing" });
    expect(chat().peerTyping).toBe(true);
    act(() => {
      vi.advanceTimersByTime(LIMITS.typingShownMs);
    });
    expect(chat().peerTyping).toBe(false);
    receive({ type: "typing" });
    receive({ type: "message", ...message(1, "p") });
    expect(chat().peerTyping).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it("sends seen only for a newer message, and again after a failed send", () => {
  renderHook(() => {
    useChatConnection(CHAT);
  });
  open();
  sockets.offline = true;
  sendChatSeen(CHAT, 3);
  sockets.offline = false;
  sendChatSeen(CHAT, 3);
  sendChatSeen(CHAT, 3);
  sendChatSeen(CHAT, 2);
  expect(socket().sent.filter((m) => (m as { type: string }).type === "seen")).toEqual([
    { type: "seen", seq: 3 },
  ]);
});

it("sends typing at most once per interval", () => {
  vi.useFakeTimers();
  try {
    renderHook(() => {
      useChatConnection(CHAT);
    });
    open();
    sendChatTyping(CHAT);
    sendChatTyping(CHAT);
    act(() => {
      vi.advanceTimersByTime(LIMITS.typingSignalIntervalMs);
    });
    sendChatTyping(CHAT);
    expect(socket().sent.filter((m) => (m as { type: string }).type === "typing")).toHaveLength(2);
  } finally {
    vi.useRealTimers();
  }
});

it("sends seen again after a reconnect, in case the last one was lost", () => {
  renderHook(() => {
    useChatConnection(CHAT);
  });
  open();
  sendChatSeen(CHAT, 3);
  drop();
  open();
  sendChatSeen(CHAT, 3);
  expect(socket().sent.filter((m) => (m as { type: string }).type === "seen")).toHaveLength(2);
});
