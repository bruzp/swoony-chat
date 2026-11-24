import { useEffect } from "react";
import {
  CHAT_ENDED_CLOSE_CODE,
  type ChatClientMessage,
  type ChatServerMessage,
} from "@shared/protocol/chat";
import { LIMITS } from "@shared/config";
import { REPLACED_CLOSE_CODE } from "@shared/protocol/lobby";
import { useAppStore } from "@/app/store";
import { socketUrl } from "@/lib/api";
import { ReconnectingSocket } from "@/lib/ReconnectingSocket";

type ChatSocket = ReconnectingSocket<ChatServerMessage, ChatClientMessage>;

const CHAT_PATH_PREFIX = "/api/chat/";
const FIRST_CONNECT_WAIT_MS = 10_000;
const openSockets = new Map<string, ChatSocket>();
const heldUntilFirstOpen = new Map<string, string[]>();
const seenSent = new Map<string, number>();
const typingSentAt = new Map<string, number>();

function failHeld(chatId: string): void {
  const held = heldUntilFirstOpen.get(chatId) ?? [];
  heldUntilFirstOpen.delete(chatId);
  for (const clientId of held) useAppStore.getState().sendFailed(chatId, clientId, "not_sent");
}

function parseChatMessage(raw: unknown): ChatServerMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  return typeof (raw as { type?: unknown }).type === "string" ? (raw as ChatServerMessage) : null;
}

function newClientId(): string {
  return crypto.randomUUID();
}

function transmit(chatId: string, clientId: string, text: string): boolean {
  const sent = openSockets.get(chatId)?.send({ type: "send", clientId, text }) ?? false;
  if (sent) return true;
  const held = heldUntilFirstOpen.get(chatId);
  if (held) {
    held.push(clientId);
    return true;
  }
  useAppStore.getState().sendFailed(chatId, clientId, "not_sent");
  return false;
}

export function sendChatText(chatId: string, text: string): boolean {
  const clientId = newClientId();
  useAppStore.getState().pendingSent(chatId, clientId, text);
  return transmit(chatId, clientId, text);
}

export function retryChatMessage(chatId: string, clientId: string): void {
  const pending = useAppStore
    .getState()
    .chats[chatId]?.pending.find((message) => message.clientId === clientId);
  if (!pending) return;
  const retryId = newClientId();
  useAppStore.getState().retryPending(chatId, clientId, retryId);
  transmit(chatId, retryId, pending.text);
}

export function sendChatSeen(chatId: string, seq: number): void {
  if (seq <= (seenSent.get(chatId) ?? 0)) return;
  if (openSockets.get(chatId)?.send({ type: "seen", seq })) seenSent.set(chatId, seq);
}

export function sendChatTyping(chatId: string): void {
  const now = Date.now();
  const last = typingSentAt.get(chatId);
  if (last !== undefined && now - last < LIMITS.typingSignalIntervalMs) return;
  if (openSockets.get(chatId)?.send({ type: "typing" })) typingSentAt.set(chatId, now);
}

function announceIfInBackground(chatId: string, message: ChatServerMessage): void {
  if (message.type !== "message") return;
  const store = useAppStore.getState();
  const chat = store.chats[chatId];
  if (!chat || message.from === store.session.me?.userId) return;
  const inView = store.activeChatId === chatId && document.visibilityState !== "hidden";
  if (!inView) store.announce(`New message from ${chat.peer.nickname}: ${message.text}`);
}

export function useChatConnection(chatId: string): void {
  useEffect(() => {
    let unconfirmed = new Set<string>();
    let awaitingHistory = false;
    let typingTimer: ReturnType<typeof setTimeout> | undefined;
    heldUntilFirstOpen.set(chatId, []);
    const firstConnectTimer = setTimeout(() => {
      failHeld(chatId);
    }, FIRST_CONNECT_WAIT_MS);
    const socket: ChatSocket = new ReconnectingSocket({
      url: socketUrl(`${CHAT_PATH_PREFIX}${chatId}`),
      parse: parseChatMessage,
      onStatus: (status) => {
        const store = useAppStore.getState();
        store.chatConnected(chatId, status === "open");
        if (status !== "open") return;
        seenSent.delete(chatId);
        const chat = store.chats[chatId];
        const held = new Set(heldUntilFirstOpen.get(chatId));
        heldUntilFirstOpen.delete(chatId);
        clearTimeout(firstConnectTimer);
        unconfirmed = new Set(
          chat?.pending
            .filter((message) => !message.failed && !held.has(message.clientId))
            .map((message) => message.clientId),
        );
        awaitingHistory = true;
        socket.send({ type: "resume", afterSeq: chat?.lastSeq ?? 0 });
        for (const message of chat?.pending ?? []) {
          if (held.has(message.clientId)) transmit(chatId, message.clientId, message.text);
        }
      },
      onMessage: (message) => {
        const store = useAppStore.getState();
        switch (message.type) {
          case "history":
            store.chatHistory(chatId, message.messages, awaitingHistory ? unconfirmed : new Set());
            store.peerSeen(chatId, message.peerSeen);
            awaitingHistory = false;
            return;
          case "seen":
            store.peerSeen(chatId, message.seq);
            return;
          case "typing":
            store.peerTyping(chatId, true);
            clearTimeout(typingTimer);
            typingTimer = setTimeout(() => {
              useAppStore.getState().peerTyping(chatId, false);
            }, LIMITS.typingShownMs);
            return;
          case "message": {
            const { seq, from, text, sentAt, clientId } = message;
            store.chatMessage(
              chatId,
              clientId === undefined
                ? { seq, from, text, sentAt }
                : { seq, from, text, sentAt, clientId },
            );
            announceIfInBackground(chatId, message);
            return;
          }
          case "rejected":
            store.sendFailed(chatId, message.clientId, message.reason);
            return;
          case "ended":
            store.chatEnded(chatId);
            return;
        }
      },
      onTerminal: (code) => {
        if (code === CHAT_ENDED_CLOSE_CODE) useAppStore.getState().chatEnded(chatId);
        if (code === REPLACED_CLOSE_CODE) useAppStore.getState().openedElsewhere();
      },
    });
    openSockets.set(chatId, socket);
    return () => {
      clearTimeout(firstConnectTimer);
      clearTimeout(typingTimer);
      seenSent.delete(chatId);
      typingSentAt.delete(chatId);
      failHeld(chatId);
      if (openSockets.get(chatId) === socket) openSockets.delete(chatId);
      socket.close();
      useAppStore.getState().chatConnected(chatId, false);
    };
  }, [chatId]);
}
