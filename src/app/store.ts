import { create } from "zustand";
import { matchesFilter, type PublicUser, type UserFilter } from "@shared/profile";
import type { SessionBootstrap } from "@shared/protocol/api";
import type { ChatMessage, ChatMessageForViewer, ChatRejection } from "@shared/protocol/chat";
import type {
  KickReason,
  LobbyClientMessage,
  LobbyServerMessage,
  OpenChat,
} from "@shared/protocol/lobby";
import { forgetNavigation, readOpenChat, rememberOpenChat } from "@/lib/navigationMemory";

type HelloMessage = Extract<LobbyServerMessage, { type: "hello" }>;
type PresenceMessage = Extract<LobbyServerMessage, { type: "presence" }>;
type PageMessage = Extract<LobbyServerMessage, { type: "page" }>;
type ListMessage = Extract<LobbyClientMessage, { type: "list" }>;
export type IncomingChatMessage = ChatMessageForViewer;
export type SendFailure = ChatRejection | "not_sent";

export type SessionStatus =
  "loading" | "entry" | "lobby" | "kicked" | "banned" | "maintenance" | "elsewhere";

export interface SessionState {
  me: PublicUser | null;
  status: SessionStatus;
  kickReason: KickReason | null;
  banUntil: number | null;
  suggestedCountry: string | null;
  maintenanceMessage: string;
  rulesPending: boolean;
}

export interface ListRequest {
  id: string;
  cursor: string | null;
}

export interface LobbyState {
  users: PublicUser[];
  online: number;
  filter: UserFilter;
  nextCursor: string | null;
  hidden: Set<string>;
  request: ListRequest | null;
  listPaused: boolean;
  blockRequests: Set<string>;
  pendingJoins: Set<string>;
}

export interface PendingMessage {
  clientId: string;
  text: string;
  failed?: SendFailure;
}

export interface ChatState {
  peer: PublicUser;
  messages: ChatMessage[];
  pending: PendingMessage[];
  unread: number;
  ended: boolean;
  lastSeq: number;
  readThrough: number;
  connected: boolean;
  endedByMe: boolean;
  peerSeen: number;
  peerTyping: boolean;
}

export interface Announcement {
  id: number;
  text: string;
}

export interface AppData {
  session: SessionState;
  lobby: LobbyState;
  chats: Record<string, ChatState>;
  activeChatId: string | null;
  announcement: Announcement | null;
}

export interface AppActions {
  bootstrap: (boot: SessionBootstrap) => void;
  entered: (me: PublicUser) => void;
  rulesAgreed: () => void;
  signedOut: () => void;
  setFilter: (filter: UserFilter) => void;
  requestList: (cursor: string | null) => ListMessage;
  page: (msg: PageMessage) => void;
  pauseList: () => void;
  resumeList: () => void;
  hide: (userId: string) => void;
  chatOpened: (chat: OpenChat, activate: boolean) => void;
  chatEnded: (chatId: string) => void;
  blockRequested: (userId: string) => void;
  hello: (msg: HelloMessage) => void;
  presence: (msg: PresenceMessage) => void;
  chatMessage: (chatId: string, msg: IncomingChatMessage) => void;
  chatHistory: (chatId: string, messages: IncomingChatMessage[], unconfirmed: Set<string>) => void;
  pendingSent: (chatId: string, clientId: string, text: string) => void;
  sendFailed: (chatId: string, clientId: string, reason: SendFailure) => void;
  retryPending: (chatId: string, clientId: string, newClientId: string) => void;
  chatConnected: (chatId: string, connected: boolean) => void;
  peerSeen: (chatId: string, seq: number) => void;
  peerTyping: (chatId: string, typing: boolean) => void;
  closeChat: (chatId: string) => void;
  setActiveChat: (chatId: string | null) => void;
  kicked: (reason: KickReason) => void;
  openedElsewhere: () => void;
  maintenance: (message: string) => void;
  announce: (text: string) => void;
}

export type AppStore = AppData & AppActions;

export function initialAppData(): AppData {
  return {
    session: {
      me: null,
      status: "loading",
      kickReason: null,
      banUntil: null,
      suggestedCountry: null,
      maintenanceMessage: "",
      rulesPending: false,
    },
    lobby: {
      users: [],
      online: 0,
      filter: {},
      nextCursor: null,
      hidden: new Set(),
      request: null,
      listPaused: false,
      blockRequests: new Set(),
      pendingJoins: new Set(),
    },
    chats: {},
    activeChatId: null,
    announcement: null,
  };
}

export function seqStorageKey(chatId: string): string {
  return `swoony-seq-${chatId}`;
}

function readStoredSeq(chatId: string): number {
  try {
    const value = Number(sessionStorage.getItem(seqStorageKey(chatId)));
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function storeSeq(chatId: string, seq: number): void {
  try {
    sessionStorage.setItem(seqStorageKey(chatId), String(seq));
  } catch {
    return;
  }
}

function forgetSeq(chatId: string): void {
  try {
    sessionStorage.removeItem(seqStorageKey(chatId));
  } catch {
    return;
  }
}

function pageVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function emptyChat(peer: PublicUser, readThrough: number): ChatState {
  return {
    peer,
    messages: [],
    pending: [],
    unread: 0,
    ended: false,
    lastSeq: 0,
    readThrough,
    connected: false,
    endedByMe: false,
    peerSeen: 0,
    peerTyping: false,
  };
}

export function applyHello(
  state: AppData,
  msg: HelloMessage,
  storedSeq: (chatId: string) => number = readStoredSeq,
): AppData {
  const openIds = new Set(msg.chats.map((c) => c.chatId));
  const chats: Record<string, ChatState> = {};
  for (const [chatId, chat] of Object.entries(state.chats)) {
    if (!openIds.has(chatId)) chats[chatId] = chat.ended ? chat : { ...chat, ended: true };
  }
  for (const { chatId, peer } of msg.chats) {
    const existing = state.chats[chatId];
    chats[chatId] = existing ? { ...existing, peer } : emptyChat(peer, storedSeq(chatId));
  }
  return {
    ...state,
    session: { ...state.session, me: msg.me, status: "lobby", kickReason: null },
    lobby: { ...state.lobby, online: msg.online },
    chats,
  };
}

export function applyPresence(state: AppData, msg: PresenceMessage): AppData {
  const { filter, hidden } = state.lobby;
  const myId = state.session.me?.userId;
  const left = new Set(msg.left);
  const changed = new Map<string, PublicUser>();
  for (const user of [...msg.updated, ...msg.joined]) changed.set(user.userId, user);

  const users = state.lobby.users
    .filter((u) => !left.has(u.userId))
    .map((u) => changed.get(u.userId) ?? u);
  const listed = new Set(users.map((u) => u.userId));
  const pendingJoins = new Set([...state.lobby.pendingJoins].filter((id) => !left.has(id)));
  for (const user of msg.joined) {
    const visible = user.userId !== myId && !hidden.has(user.userId) && matchesFilter(user, filter);
    if (visible && !listed.has(user.userId)) pendingJoins.add(user.userId);
  }

  let chats = state.chats;
  for (const [chatId, chat] of Object.entries(state.chats)) {
    const peer = changed.get(chat.peer.userId);
    if (peer) chats = { ...chats, [chatId]: { ...chat, peer } };
  }

  const myUpdate = myId === undefined ? undefined : changed.get(myId);
  const session = myUpdate ? { ...state.session, me: myUpdate } : state.session;
  return {
    ...state,
    session,
    lobby: { ...state.lobby, users, pendingJoins, online: msg.online },
    chats,
  };
}

function isListable(state: AppData, user: PublicUser, hidden: Set<string>): boolean {
  return user.userId !== state.session.me?.userId && !hidden.has(user.userId);
}

export function applyListRequest(state: AppData, id: string, cursor: string | null): AppData {
  return { ...state, lobby: { ...state.lobby, request: { id, cursor } } };
}

export function applyPage(state: AppData, msg: PageMessage): AppData {
  const { request, hidden } = state.lobby;
  if (!request || request.id !== msg.requestId) return state;
  const incoming = msg.users.filter((user) => isListable(state, user, hidden));
  let users = incoming;
  let pendingJoins = new Set<string>();
  if (request.cursor !== null) {
    const listed = new Set(state.lobby.users.map((user) => user.userId));
    users = [...state.lobby.users, ...incoming.filter((user) => !listed.has(user.userId))];
    const arrived = new Set(incoming.map((user) => user.userId));
    pendingJoins = new Set([...state.lobby.pendingJoins].filter((id) => !arrived.has(id)));
  }
  return {
    ...state,
    lobby: {
      ...state.lobby,
      users,
      pendingJoins,
      nextCursor: msg.nextCursor,
      online: msg.online,
      request: null,
    },
  };
}

export function applyFilter(state: AppData, filter: UserFilter): AppData {
  return {
    ...state,
    lobby: {
      ...state.lobby,
      filter,
      users: [],
      pendingJoins: new Set(),
      nextCursor: null,
      request: null,
    },
  };
}

function endChatsWith(chats: Record<string, ChatState>, userId: string): Record<string, ChatState> {
  let next = chats;
  for (const [chatId, chat] of Object.entries(chats)) {
    if (chat.peer.userId === userId && !(chat.ended && chat.endedByMe)) {
      next = { ...next, [chatId]: { ...chat, ended: true, endedByMe: true } };
    }
  }
  return next;
}

export function applyHidden(state: AppData, userId: string): AppData {
  const hidden = new Set(state.lobby.hidden).add(userId);
  return {
    ...state,
    lobby: {
      ...state.lobby,
      hidden,
      users: state.lobby.users.filter((user) => user.userId !== userId),
      pendingJoins: new Set([...state.lobby.pendingJoins].filter((id) => id !== userId)),
    },
    chats: endChatsWith(state.chats, userId),
  };
}

export function applyChatOpened(
  state: AppData,
  { chatId, peer }: OpenChat,
  activate: boolean,
  storedSeq: (chatId: string) => number = readStoredSeq,
): AppData {
  const existing = state.chats[chatId];
  const chat =
    existing && !existing.ended ? existing : emptyChat(peer, existing ? 0 : storedSeq(chatId));
  return {
    ...state,
    chats: chat === existing ? state.chats : { ...state.chats, [chatId]: chat },
    activeChatId: activate ? chatId : state.activeChatId,
  };
}

export function applyChatEnded(state: AppData, chatId: string): AppData {
  const chat = state.chats[chatId];
  if (!chat || chat.ended) return state;
  const endedByMe = state.lobby.blockRequests.has(chat.peer.userId);
  return { ...state, chats: { ...state.chats, [chatId]: { ...chat, ended: true, endedByMe } } };
}

function updateChat(
  state: AppData,
  chatId: string,
  update: (chat: ChatState) => ChatState,
): AppData {
  const chat = state.chats[chatId];
  if (!chat) return state;
  return { ...state, chats: { ...state.chats, [chatId]: update(chat) } };
}

export function applyPendingSent(
  state: AppData,
  chatId: string,
  clientId: string,
  text: string,
): AppData {
  return updateChat(state, chatId, (chat) => ({
    ...chat,
    pending: [...chat.pending, { clientId, text }],
  }));
}

export function applyRejected(
  state: AppData,
  chatId: string,
  clientId: string,
  reason: SendFailure,
): AppData {
  return updateChat(state, chatId, (chat) => ({
    ...chat,
    pending: chat.pending.map((p) => (p.clientId === clientId ? { ...p, failed: reason } : p)),
  }));
}

export function applyRetry(
  state: AppData,
  chatId: string,
  clientId: string,
  newClientId: string,
): AppData {
  return updateChat(state, chatId, (chat) => ({
    ...chat,
    pending: chat.pending.map((p) =>
      p.clientId === clientId ? { clientId: newClientId, text: p.text } : p,
    ),
  }));
}

export function applyHistory(
  state: AppData,
  chatId: string,
  messages: IncomingChatMessage[],
  unconfirmed: Set<string>,
  viewing?: boolean,
): AppData {
  let next = state;
  for (const message of messages) next = applyChatMessage(next, chatId, message, viewing);
  return updateChat(next, chatId, (chat) => ({
    ...chat,
    pending: chat.pending.map((p) =>
      unconfirmed.has(p.clientId) && !p.failed ? { ...p, failed: "not_sent" } : p,
    ),
  }));
}

export function applyChatMessage(
  state: AppData,
  chatId: string,
  msg: IncomingChatMessage,
  viewing = state.activeChatId === chatId,
): AppData {
  const chat = state.chats[chatId];
  if (!chat) return state;
  const { clientId, ...message } = msg;
  const pending = clientId ? chat.pending.filter((p) => p.clientId !== clientId) : chat.pending;
  if (chat.messages.some((m) => m.seq === message.seq)) {
    return pending === chat.pending
      ? state
      : { ...state, chats: { ...state.chats, [chatId]: { ...chat, pending } } };
  }
  const newestShownSeq = chat.messages.at(-1)?.seq ?? Number.NEGATIVE_INFINITY;
  const messages =
    message.seq > newestShownSeq
      ? [...chat.messages, message]
      : [...chat.messages, message].sort((a, b) => a.seq - b.seq);
  const fromPeer = message.from !== state.session.me?.userId;
  const isNew = message.seq > chat.readThrough;
  const unread = chat.unread + (fromPeer && isNew && !viewing ? 1 : 0);
  const lastSeq = Math.max(chat.lastSeq, message.seq);
  const peerTyping = fromPeer ? false : chat.peerTyping;
  return {
    ...state,
    chats: {
      ...state.chats,
      [chatId]: { ...chat, messages, pending, unread, lastSeq, peerTyping },
    },
  };
}

let announcementId = 0;

function newRequestId(): string {
  return crypto.randomUUID();
}

export const useAppStore = create<AppStore>()((set, get) => ({
  ...initialAppData(),
  bootstrap: (boot) => {
    set((state) => {
      const status: SessionStatus = boot.ban ? "banned" : boot.me ? "lobby" : "entry";
      return {
        session: {
          ...state.session,
          me: boot.me,
          status,
          banUntil: boot.ban?.until ?? null,
          suggestedCountry: boot.suggestedCountry,
        },
      };
    });
  },
  entered: (me) => {
    forgetNavigation();
    set((state) => ({
      session: { ...state.session, me, status: "lobby", kickReason: null, rulesPending: true },
    }));
  },
  rulesAgreed: () => {
    set((state) => ({ session: { ...state.session, rulesPending: false } }));
  },
  signedOut: () => {
    forgetNavigation();
    set((state) => {
      const fresh = initialAppData();
      return {
        ...fresh,
        session: {
          ...fresh.session,
          status: "entry",
          suggestedCountry: state.session.suggestedCountry,
        },
      };
    });
  },
  setFilter: (filter) => {
    set((state) => applyFilter(state, filter));
  },
  requestList: (cursor) => {
    const id = newRequestId();
    set((state) => applyListRequest(state, id, cursor));
    const message: ListMessage = { type: "list", requestId: id, filter: get().lobby.filter };
    return cursor === null ? message : { ...message, cursor };
  },
  page: (msg) => {
    set((state) => applyPage(state, msg));
  },
  pauseList: () => {
    set((state) => ({ lobby: { ...state.lobby, request: null, listPaused: true } }));
  },
  resumeList: () => {
    set((state) => ({ lobby: { ...state.lobby, listPaused: false } }));
  },
  hide: (userId) => {
    set((state) => applyHidden(state, userId));
  },
  chatOpened: (chat, activate) => {
    set((state) => applyChatOpened(state, chat, activate));
    if (activate) rememberOpenChat(get().activeChatId);
  },
  chatEnded: (chatId) => {
    const before = get().chats[chatId];
    set((state) => applyChatEnded(state, chatId));
    const after = get().chats[chatId];
    if (before && !before.ended && after && !after.endedByMe) {
      get().announce(`${after.peer.nickname} left`);
    }
  },
  blockRequested: (userId) => {
    set((state) => ({
      lobby: { ...state.lobby, blockRequests: new Set(state.lobby.blockRequests).add(userId) },
    }));
  },
  hello: (msg) => {
    set((state) => applyHello(state, msg));
    const openChat = readOpenChat();
    if (!openChat || get().activeChatId !== null) return;
    if (get().chats[openChat]) get().setActiveChat(openChat);
    else rememberOpenChat(null);
  },
  presence: (msg) => {
    set((state) => applyPresence(state, msg));
  },
  chatMessage: (chatId, msg) => {
    const before = get().chats[chatId]?.lastSeq;
    set((state) =>
      applyChatMessage(state, chatId, msg, state.activeChatId === chatId && pageVisible()),
    );
    const after = get().chats[chatId]?.lastSeq;
    if (after !== undefined && after !== before) storeSeq(chatId, after);
  },
  chatHistory: (chatId, messages, unconfirmed) => {
    const before = get().chats[chatId]?.lastSeq;
    set((state) =>
      applyHistory(
        state,
        chatId,
        messages,
        unconfirmed,
        state.activeChatId === chatId && pageVisible(),
      ),
    );
    const after = get().chats[chatId]?.lastSeq;
    if (after !== undefined && after !== before) storeSeq(chatId, after);
  },
  pendingSent: (chatId, clientId, text) => {
    set((state) => applyPendingSent(state, chatId, clientId, text));
  },
  sendFailed: (chatId, clientId, reason) => {
    set((state) => applyRejected(state, chatId, clientId, reason));
  },
  retryPending: (chatId, clientId, newClientId) => {
    set((state) => applyRetry(state, chatId, clientId, newClientId));
  },
  chatConnected: (chatId, connected) => {
    set((state) => {
      const chat = state.chats[chatId];
      if (!chat || chat.connected === connected) return state;
      return { chats: { ...state.chats, [chatId]: { ...chat, connected } } };
    });
  },
  peerSeen: (chatId, seq) => {
    set((state) => {
      const chat = state.chats[chatId];
      if (!chat || seq <= chat.peerSeen) return state;
      return { chats: { ...state.chats, [chatId]: { ...chat, peerSeen: seq } } };
    });
  },
  peerTyping: (chatId, typing) => {
    set((state) => {
      const chat = state.chats[chatId];
      if (!chat || chat.peerTyping === typing) return state;
      return { chats: { ...state.chats, [chatId]: { ...chat, peerTyping: typing } } };
    });
  },
  closeChat: (chatId) => {
    forgetSeq(chatId);
    if (get().activeChatId === chatId) rememberOpenChat(null);
    set((state) => {
      const chats = Object.fromEntries(Object.entries(state.chats).filter(([id]) => id !== chatId));
      return { chats, activeChatId: state.activeChatId === chatId ? null : state.activeChatId };
    });
  },
  setActiveChat: (chatId) => {
    rememberOpenChat(chatId);
    set((state) => {
      const chat = chatId ? state.chats[chatId] : undefined;
      if (!chatId || !chat) return { activeChatId: chatId };
      return { activeChatId: chatId, chats: { ...state.chats, [chatId]: { ...chat, unread: 0 } } };
    });
  },
  kicked: (reason) => {
    const status: SessionStatus = reason === "maintenance" ? "maintenance" : "kicked";
    set((state) => ({ session: { ...state.session, status, kickReason: reason } }));
  },
  openedElsewhere: () => {
    set((state) => ({ session: { ...state.session, status: "elsewhere" } }));
  },
  maintenance: (message) => {
    set((state) => ({
      session: { ...state.session, status: "maintenance", maintenanceMessage: message },
    }));
  },
  announce: (text) => {
    announcementId += 1;
    set({ announcement: { id: announcementId, text } });
  },
}));

export function selectTotalUnread(state: AppData): number {
  return Object.values(state.chats).reduce((total, chat) => total + chat.unread, 0);
}
