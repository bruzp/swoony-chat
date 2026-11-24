import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MessageList } from "./MessageList";

const observers: ResizeObserverCallback[] = [];

class RecordingResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    observers.push(callback);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

afterEach(() => {
  observers.length = 0;
  vi.unstubAllGlobals();
});

it("stays pinned to the newest message when the chat area shrinks, like when the keyboard opens", () => {
  vi.stubGlobal("ResizeObserver", RecordingResizeObserver);
  render(
    <MessageList
      messages={[{ seq: 1, from: "peer", text: "hi", sentAt: 1 }]}
      pending={[]}
      myUserId="me"
      peerSeen={0}
      peerTyping={false}
      canRetry
      onRetry={() => undefined}
    />,
  );
  const log = screen.getByRole("log");
  Object.defineProperty(log, "scrollHeight", { configurable: true, value: 900 });
  log.scrollTop = 0;
  for (const notify of observers) notify([], {} as ResizeObserver);
  expect(log.scrollTop).toBe(900);
});

function renderList(
  messages: { seq: number; from: string; text: string }[],
  extra: {
    peerSeen?: number;
    peerTyping?: boolean;
    pending?: { clientId: string; text: string }[];
  } = {},
) {
  vi.stubGlobal("ResizeObserver", RecordingResizeObserver);
  render(
    <MessageList
      messages={messages.map((m) => ({ ...m, sentAt: m.seq }))}
      pending={extra.pending ?? []}
      myUserId="me"
      peerSeen={extra.peerSeen ?? 0}
      peerTyping={extra.peerTyping ?? false}
      canRetry
      onRetry={() => undefined}
    />,
  );
}

it("shows a message of only one to three emoji big, without a bubble", () => {
  renderList([
    { seq: 1, from: "peer", text: "😂" },
    { seq: 2, from: "me", text: "👍🏽❤️🇵🇭" },
    { seq: 3, from: "peer", text: "ok 😂" },
    { seq: 4, from: "peer", text: "😂😂😂😂" },
    { seq: 5, from: "peer", text: "123" },
  ]);
  expect(screen.getByText("😂")).toHaveAttribute("data-emoji-only", "true");
  expect(screen.getByText("👍🏽❤️🇵🇭")).toHaveAttribute("data-emoji-only", "true");
  expect(screen.getByText("ok 😂")).not.toHaveAttribute("data-emoji-only");
  expect(screen.getByText("😂😂😂😂")).not.toHaveAttribute("data-emoji-only");
  expect(screen.getByText("123")).not.toHaveAttribute("data-emoji-only");
});

it("shows Seen under my last message once the peer has seen it", () => {
  renderList(
    [
      { seq: 1, from: "me", text: "one" },
      { seq: 2, from: "me", text: "two" },
    ],
    { peerSeen: 2 },
  );
  expect(screen.getAllByText("Seen")).toHaveLength(1);
  expect(screen.getByText("two").parentElement).toHaveTextContent("Seen");
});

it("keeps Seen under my last seen message while a newer one is unseen", () => {
  renderList(
    [
      { seq: 1, from: "me", text: "one" },
      { seq: 2, from: "me", text: "two" },
    ],
    { peerSeen: 1 },
  );
  expect(screen.getAllByText("Seen")).toHaveLength(1);
  expect(screen.getByText("one").parentElement).toHaveTextContent("Seen");
});

it("keeps Seen under my last seen message after the peer replies", () => {
  renderList(
    [
      { seq: 1, from: "me", text: "one" },
      { seq: 2, from: "peer", text: "reply" },
    ],
    { peerSeen: 2 },
  );
  expect(screen.getByText("one").parentElement).toHaveTextContent("Seen");
});

it("keeps Seen under my last seen message while a newer one is sending", () => {
  renderList([{ seq: 1, from: "me", text: "one" }], {
    peerSeen: 1,
    pending: [{ clientId: "c", text: "two" }],
  });
  expect(screen.getByText("one").parentElement).toHaveTextContent("Seen");
});

it("shows no Seen before the peer has seen any of my messages", () => {
  renderList(
    [
      { seq: 1, from: "peer", text: "hey" },
      { seq: 2, from: "me", text: "hi" },
    ],
    { peerSeen: 1 },
  );
  expect(screen.queryByText("Seen")).not.toBeInTheDocument();
});

it("shows a typing bubble after the messages only while the peer types", () => {
  renderList([{ seq: 1, from: "peer", text: "hey" }], { peerTyping: true });
  const log = screen.getByRole("log");
  expect(log.lastElementChild).toHaveAttribute("data-typing", "true");
  expect(log.lastElementChild).toHaveAttribute("aria-hidden", "true");
});

it("shows no typing bubble when the peer is not typing", () => {
  renderList([{ seq: 1, from: "peer", text: "hey" }]);
  expect(screen.getByRole("log").querySelector("[data-typing]")).toBeNull();
});
