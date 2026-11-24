import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import {
  KICKED_CLOSE_CODE,
  LEFT_CLOSE_CODE,
  REPLACED_CLOSE_CODE,
  type LobbyClientMessage,
  type LobbyServerMessage,
} from "@shared/protocol/lobby";
import { useAppStore } from "@/app/store";
import { fetchSession, socketUrl } from "@/lib/api";
import { BIO_NOT_ALLOWED } from "@/lib/bioRules";
import { ReconnectingSocket } from "@/lib/ReconnectingSocket";
import type { LobbyConnection } from "./lobbyContext";

const LOBBY_PATH = "/api/lobby";
const SLOW_DOWN = "Slow down a bit.";
const OFFLINE = "You're offline. Try again in a moment.";
const LIST_PAUSE_MS = 2_500;

type LobbySocket = ReconnectingSocket<LobbyServerMessage, LobbyClientMessage>;

function parseLobbyMessage(raw: unknown): LobbyServerMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  return typeof (raw as { type?: unknown }).type === "string" ? (raw as LobbyServerMessage) : null;
}

function isSlowDown(message: LobbyServerMessage): boolean {
  return (message.type === "notice" || message.type === "error") && message.code === "slow_down";
}

function resumeListAfterPause(socket: LobbySocket): void {
  const store = useAppStore.getState();
  store.resumeList();
  const { users, nextCursor, request } = useAppStore.getState().lobby;
  if (users.length === 0 && nextCursor === null && request === null) {
    socket.send(store.requestList(null));
  }
}

function nicknameOf(userId: string): string {
  const { lobby, chats } = useAppStore.getState();
  const listed = lobby.users.find((user) => user.userId === userId);
  if (listed) return listed.nickname;
  const chat = Object.values(chats).find((c) => c.peer.userId === userId);
  return chat?.peer.nickname ?? "them";
}

function handleLobbyMessage(message: LobbyServerMessage): void {
  const store = useAppStore.getState();
  switch (message.type) {
    case "hello":
      store.hello(message);
      return;
    case "page":
      store.page(message);
      return;
    case "presence":
      store.presence(message);
      return;
    case "kicked":
      store.kicked(message.reason);
      return;
    case "chatOpened":
      store.chatOpened({ chatId: message.chatId, peer: message.peer }, true);
      return;
    case "incomingChat":
      store.chatOpened({ chatId: message.chatId, peer: message.from }, false);
      store.announce(`${message.from.nickname} started a chat with you.`);
      return;
    case "chatEnded":
      store.chatEnded(message.chatId);
      return;
    case "blocked": {
      const nickname = nicknameOf(message.userId);
      store.hide(message.userId);
      toast(`Blocked ${nickname}.`);
      return;
    }
    case "reported": {
      const nickname = nicknameOf(message.userId);
      store.hide(message.userId);
      toast(`Thanks. We've blocked ${nickname} for you.`);
      return;
    }
    case "notice":
      toast(SLOW_DOWN);
      return;
    case "error":
      if (message.code === "user_unavailable") toast("That person isn't available anymore.");
      if (message.code === "slow_down") toast(SLOW_DOWN);
      return;
    case "bioRejected":
      toast(BIO_NOT_ALLOWED);
      return;
  }
}

async function recheckSession(socket: LobbySocket): Promise<void> {
  let boot;
  try {
    boot = await fetchSession();
  } catch {
    return;
  }
  if (boot.me && !boot.ban) return;
  socket.close();
  const store = useAppStore.getState();
  store.signedOut();
  store.bootstrap(boot);
}

export function useLobbyConnection(): LobbyConnection {
  const socketRef = useRef<LobbySocket | null>(null);

  useEffect(() => {
    let listPauseTimer: ReturnType<typeof setTimeout> | undefined;
    const socket: LobbySocket = new ReconnectingSocket({
      url: socketUrl(LOBBY_PATH),
      parse: parseLobbyMessage,
      onMessage: (message) => {
        if (isSlowDown(message)) {
          useAppStore.getState().pauseList();
          clearTimeout(listPauseTimer);
          listPauseTimer = setTimeout(() => {
            resumeListAfterPause(socket);
          }, LIST_PAUSE_MS);
        }
        handleLobbyMessage(message);
      },
      onStatus: (status) => {
        if (status === "open") socket.send(useAppStore.getState().requestList(null));
      },
      onGiveUp: () => {
        void recheckSession(socket);
      },
      onTerminal: (code) => {
        if (code === LEFT_CLOSE_CODE) {
          useAppStore.getState().signedOut();
          return;
        }
        if (code === REPLACED_CLOSE_CODE) {
          useAppStore.getState().openedElsewhere();
          return;
        }
        const status = useAppStore.getState().session.status;
        if (code === KICKED_CLOSE_CODE && (status === "kicked" || status === "maintenance")) {
          return;
        }
        void recheckSession(socket);
      },
    });
    socketRef.current = socket;
    return () => {
      clearTimeout(listPauseTimer);
      socketRef.current = null;
      socket.close();
    };
  }, []);

  return useMemo(
    () => ({
      send: (message: LobbyClientMessage) => {
        const sent = socketRef.current?.send(message) ?? false;
        if (sent && (message.type === "block" || message.type === "report")) {
          useAppStore.getState().blockRequested(message.userId);
        }
        if (!sent && message.type !== "list") toast(OFFLINE);
        return sent;
      },
    }),
    [],
  );
}
