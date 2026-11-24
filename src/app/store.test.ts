import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicUser } from "@shared/profile";
import type { LobbyServerMessage } from "@shared/protocol/lobby";
import {
  applyChatEnded,
  applyChatMessage,
  applyHistory,
  applyPendingSent,
  applyRejected,
  applyRetry,
  applyChatOpened,
  applyFilter,
  applyHello,
  applyHidden,
  applyListRequest,
  applyPage,
  applyPresence,
  initialAppData,
  seqStorageKey,
  useAppStore,
  type AppData,
  type ChatState,
} from "./store";

type Hello = Extract<LobbyServerMessage, { type: "hello" }>;
type Presence = Extract<LobbyServerMessage, { type: "presence" }>;

function user(userId: string, over: Partial<PublicUser> = {}): PublicUser {
  return {
    userId,
    nickname: `n_${userId}`,
    gender: "female",
    age: 25,
    country: "PH",
    bio: "",
    ...over,
  };
}

const me = user("me");

function chat(peer: PublicUser, over: Partial<ChatState> = {}): ChatState {
  return {
    peer,
    messages: [],
    pending: [],
    unread: 0,
    ended: false,
    lastSeq: 0,
    readThrough: 0,
    connected: false,
    endedByMe: false,
    peerSeen: 0,
    peerTyping: false,
    ...over,
  };
}

function data(over: Partial<AppData> = {}): AppData {
  const base = initialAppData();
  return { ...base, session: { ...base.session, me, status: "lobby" }, ...over };
}

function hello(chats: Hello["chats"], online = 7): Hello {
  return { type: "hello", me, online, chats };
}

function presence(over: Partial<Presence> = {}): Presence {
  return { type: "presence", joined: [], left: [], updated: [], online: 3, ...over };
}

function msg(seq: number, from: string, clientId?: string) {
  return {
    seq,
    from,
    text: `t${String(seq)}`,
    sentAt: seq * 1000,
    ...(clientId ? { clientId } : {}),
  };
}

beforeEach(() => {
  sessionStorage.clear();
  useAppStore.setState(initialAppData());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("applyHello", () => {
  it("applyHello restores open chats; applyPresence dedupes", () => {
    const peer = user("p");
    const restored = applyHello(data(), hello([{ chatId: "c1", peer }]), () => 4);
    expect(restored.session.status).toBe("lobby");
    expect(restored.lobby.online).toBe(7);
    expect(restored.chats.c1).toEqual(chat(peer, { readThrough: 4 }));

    const withLobby = { ...restored, lobby: { ...restored.lobby, users: [user("a")] } };
    const next = applyPresence(
      withLobby,
      presence({ joined: [user("a", { bio: "hi" }), user("b")] }),
    );
    expect(next.lobby.users.map((u) => u.userId)).toEqual(["a"]);
    expect(next.lobby.users[0]?.bio).toBe("hi");
    expect([...next.lobby.pendingJoins]).toEqual(["b"]);
  });

  it("keeps messages of a chat it already has and marks chats the server dropped as ended", () => {
    const peer = user("p");
    const gone = user("g");
    const before = data({
      chats: { c1: chat(peer, { messages: [msg(1, "p")], lastSeq: 1 }), c2: chat(gone) },
    });
    const next = applyHello(
      before,
      hello([{ chatId: "c1", peer: user("p", { bio: "new" }) }]),
      () => 0,
    );
    expect(next.chats.c1?.messages).toHaveLength(1);
    expect(next.chats.c1?.peer.bio).toBe("new");
    expect(next.chats.c2?.ended).toBe(true);
  });

  it("sets me and leaves entry for the lobby", () => {
    const next = applyHello(initialAppData(), hello([]), () => 0);
    expect(next.session.me).toEqual(me);
    expect(next.session.status).toBe("lobby");
  });
});

describe("applyPresence", () => {
  it("removes users who left and replaces updated ones in place", () => {
    const before = data({ lobby: { ...data().lobby, users: [user("a"), user("b"), user("c")] } });
    const next = applyPresence(
      before,
      presence({ left: ["b"], updated: [user("c", { bio: "x" }), user("z")] }),
    );
    expect(next.lobby.users.map((u) => u.userId)).toEqual(["a", "c"]);
    expect(next.lobby.users[1]?.bio).toBe("x");
    expect(next.lobby.online).toBe(3);
  });

  it("holds matching new arrivals as pending instead of adding them to the list", () => {
    const base = data();
    const before = data({
      lobby: {
        ...base.lobby,
        users: [user("a")],
        filter: { genders: ["female"] },
        hidden: new Set(["h"]),
      },
    });
    const next = applyPresence(
      before,
      presence({ joined: [user("ok"), user("m", { gender: "male" }), user("h"), me] }),
    );
    expect(next.lobby.users.map((u) => u.userId)).toEqual(["a"]);
    expect([...next.lobby.pendingJoins]).toEqual(["ok"]);
  });

  it("forgets a pending arrival who leaves again", () => {
    const joined = applyPresence(data(), presence({ joined: [user("a"), user("b")] }));
    const next = applyPresence(joined, presence({ left: ["a"] }));
    expect([...next.lobby.pendingJoins]).toEqual(["b"]);
  });

  it("forgets a pending arrival I hide or block", () => {
    const joined = applyPresence(data(), presence({ joined: [user("a"), user("b")] }));
    expect([...applyHidden(joined, "a").lobby.pendingJoins]).toEqual(["b"]);
  });

  it("keeps my own profile up to date when my bio changes", () => {
    const next = applyPresence(data(), presence({ updated: [{ ...me, bio: "new bio" }] }));
    expect(next.session.me?.bio).toBe("new bio");
    expect(next.lobby.users).toEqual([]);
  });

  it("keeps a chat's peer profile up to date", () => {
    const before = data({ chats: { c1: chat(user("p")) } });
    const next = applyPresence(before, presence({ updated: [user("p", { bio: "fresh" })] }));
    expect(next.chats.c1?.peer.bio).toBe("fresh");
  });
});

describe("applyChatMessage", () => {
  it("merges by seq, ignores duplicates and tracks lastSeq", () => {
    let state = data({ chats: { c1: chat(user("p")) } });
    state = applyChatMessage(state, "c1", msg(2, "p"));
    state = applyChatMessage(state, "c1", msg(1, "p"));
    state = applyChatMessage(state, "c1", msg(2, "p"));
    expect(state.chats.c1?.messages.map((m) => m.seq)).toEqual([1, 2]);
    expect(state.chats.c1?.lastSeq).toBe(2);
  });

  it("counts unread peer messages only for chats that are not active", () => {
    let state = data({ chats: { c1: chat(user("p")), c2: chat(user("q")) }, activeChatId: "c2" });
    state = applyChatMessage(state, "c1", msg(1, "p"));
    state = applyChatMessage(state, "c1", msg(2, "me"));
    state = applyChatMessage(state, "c2", msg(1, "q"));
    expect(state.chats.c1?.unread).toBe(1);
    expect(state.chats.c2?.unread).toBe(0);
  });

  it("clears the pending entry the server confirmed", () => {
    const pending = [
      { clientId: "k1", text: "a" },
      { clientId: "k2", text: "b" },
    ];
    const state = applyChatMessage(
      data({ chats: { c1: chat(user("p"), { pending }) } }),
      "c1",
      msg(1, "me", "k1"),
    );
    expect(state.chats.c1?.pending).toEqual([{ clientId: "k2", text: "b" }]);
  });

  it("ignores messages for an unknown chat", () => {
    const before = data();
    expect(applyChatMessage(before, "nope", msg(1, "p"))).toBe(before);
  });
});

describe("sending and history", () => {
  it("does not duplicate messages delivered by history and live message", () => {
    let state = data({ chats: { c1: chat(user("p")) } });
    state = applyChatMessage(state, "c1", msg(1, "p"));
    state = applyHistory(state, "c1", [msg(1, "p"), msg(2, "p")], new Set());
    state = applyChatMessage(state, "c1", msg(2, "p"));
    expect(state.chats.c1?.messages.map((m) => m.seq)).toEqual([1, 2]);
    expect(state.chats.c1?.unread).toBe(2);
  });

  it("history clears the pending bubble of a message stored before the socket dropped", () => {
    let state = data({ chats: { c1: chat(user("p")) } });
    state = applyPendingSent(state, "c1", "k1", "stored");
    state = applyPendingSent(state, "c1", "k2", "lost");
    state = applyHistory(state, "c1", [msg(1, "me", "k1")], new Set(["k1", "k2"]));
    expect(state.chats.c1?.messages.map((m) => m.seq)).toEqual([1]);
    expect(state.chats.c1?.pending).toEqual([{ clientId: "k2", text: "lost", failed: "not_sent" }]);
  });

  it("history leaves messages sent on the new connection pending", () => {
    let state = applyPendingSent(data({ chats: { c1: chat(user("p")) } }), "c1", "k3", "new");
    state = applyHistory(state, "c1", [], new Set());
    expect(state.chats.c1?.pending).toEqual([{ clientId: "k3", text: "new" }]);
  });

  it("a rejection marks the pending message failed with its reason", () => {
    let state = applyPendingSent(data({ chats: { c1: chat(user("p")) } }), "c1", "k1", "www.x.com");
    state = applyRejected(state, "c1", "k1", "link");
    expect(state.chats.c1?.pending).toEqual([
      { clientId: "k1", text: "www.x.com", failed: "link" },
    ]);
  });

  it("retry replaces a failed message with a fresh pending one", () => {
    let state = applyPendingSent(data({ chats: { c1: chat(user("p")) } }), "c1", "k1", "hi");
    state = applyRejected(state, "c1", "k1", "slow_down");
    state = applyRetry(state, "c1", "k1", "k2");
    expect(state.chats.c1?.pending).toEqual([{ clientId: "k2", text: "hi" }]);
  });

  it("counts a message in the open chat as unread while the page is hidden", () => {
    const state = applyChatMessage(
      data({ chats: { c1: chat(user("p")) }, activeChatId: "c1" }),
      "c1",
      msg(1, "p"),
      false,
    );
    expect(state.chats.c1?.unread).toBe(1);
  });
});

describe("after a reload", () => {
  it("does not count messages already read before the reload as unread", () => {
    let state = applyHello(data(), hello([{ chatId: "c1", peer: user("p") }]), () => 2);
    for (const seq of [1, 2, 3]) state = applyChatMessage(state, "c1", msg(seq, "p"));
    expect(state.chats.c1?.messages.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(state.chats.c1?.unread).toBe(1);
    expect(state.chats.c1?.lastSeq).toBe(3);
  });
});

type Page = Extract<LobbyServerMessage, { type: "page" }>;

function page(requestId: string, users: PublicUser[], nextCursor: string | null = null): Page {
  return { type: "page", requestId, users, nextCursor, online: 9 };
}

describe("online list pages", () => {
  it("page 1 replaces the list, later pages append without duplicates", () => {
    const listed = data({ lobby: { ...data().lobby, users: [user("old")] } });
    const first = applyPage(
      applyListRequest(listed, "r1", null),
      page("r1", [user("a"), user("b")], "c1"),
    );
    expect(first.lobby.users.map((u) => u.userId)).toEqual(["a", "b"]);
    expect(first.lobby.nextCursor).toBe("c1");
    expect(first.lobby.request).toBeNull();
    expect(first.lobby.online).toBe(9);

    const second = applyPage(
      applyListRequest(first, "r2", "c1"),
      page("r2", [user("b"), user("c")]),
    );
    expect(second.lobby.users.map((u) => u.userId)).toEqual(["a", "b", "c"]);
    expect(second.lobby.nextCursor).toBeNull();
  });

  it("loading page 1 clears the pending arrivals, later pages keep them", () => {
    const joined = applyPresence(data(), presence({ joined: [user("a")] }));
    const later = applyPage(applyListRequest(joined, "r1", "c1"), page("r1", [user("b")]));
    expect([...later.lobby.pendingJoins]).toEqual(["a"]);
    const first = applyPage(applyListRequest(joined, "r2", null), page("r2", [user("a")]));
    expect(first.lobby.pendingJoins.size).toBe(0);
  });

  it("a later page that brings a pending arrival stops counting them as new", () => {
    const joined = applyPresence(data(), presence({ joined: [user("a"), user("b")] }));
    const later = applyPage(applyListRequest(joined, "r1", "c1"), page("r1", [user("a")]));
    expect([...later.lobby.pendingJoins]).toEqual(["b"]);
  });

  it("changing the filter clears the pending arrivals", () => {
    const joined = applyPresence(data(), presence({ joined: [user("a")] }));
    expect(applyFilter(joined, { genders: ["male"] }).lobby.pendingJoins.size).toBe(0);
  });

  it("ignores a page that answers an older request", () => {
    const requested = applyListRequest(applyListRequest(data(), "r1", null), "r2", null);
    expect(applyPage(requested, page("r1", [user("a")]))).toBe(requested);
  });

  it("leaves out hidden users and me", () => {
    const base = data();
    const hiddenSet = data({ lobby: { ...base.lobby, hidden: new Set(["h"]) } });
    const next = applyPage(
      applyListRequest(hiddenSet, "r1", null),
      page("r1", [user("h"), me, user("a")]),
    );
    expect(next.lobby.users.map((u) => u.userId)).toEqual(["a"]);
  });

  it("changing the filter empties the list and forgets the open request", () => {
    const listed = applyListRequest(
      data({ lobby: { ...data().lobby, users: [user("a")], nextCursor: "x" } }),
      "r1",
      "x",
    );
    const next = applyFilter(listed, { genders: ["male"] });
    expect(next.lobby).toMatchObject({
      users: [],
      nextCursor: null,
      request: null,
      filter: { genders: ["male"] },
    });
  });
});

describe("blocking, reporting and chats", () => {
  it("a hidden user leaves the list, stays out of presence joins, and their chat ends", () => {
    const before = data({
      lobby: { ...data().lobby, users: [user("a"), user("b")] },
      chats: { c1: chat(user("b")) },
    });
    const hidden = applyHidden(before, "b");
    expect(hidden.lobby.users.map((u) => u.userId)).toEqual(["a"]);
    expect(hidden.chats.c1?.ended).toBe(true);
    const rejoined = applyPresence(hidden, presence({ joined: [user("b")] }));
    expect(rejoined.lobby.users).toHaveLength(1);
    expect(rejoined.lobby.pendingJoins.size).toBe(0);
  });

  it("an opened chat is added once and becomes active when I opened it", () => {
    const opened = applyChatOpened(data(), { chatId: "c1", peer: user("p") }, true);
    expect(opened.activeChatId).toBe("c1");
    expect(opened.chats.c1?.ended).toBe(false);
    const again = applyChatOpened(opened, { chatId: "c1", peer: user("p") }, false);
    expect(again.chats.c1).toBe(opened.chats.c1);
  });

  it("an incoming chat does not steal focus", () => {
    const next = applyChatOpened(
      data({ activeChatId: "x" }),
      { chatId: "c1", peer: user("p") },
      false,
    );
    expect(next.activeChatId).toBe("x");
    expect(next.chats.c1).toBeDefined();
  });

  it("reopening an ended chat starts it fresh", () => {
    const ended = data({
      chats: { c1: chat(user("p"), { ended: true, messages: [msg(1, "p")] }) },
    });
    const next = applyChatOpened(ended, { chatId: "c1", peer: user("p") }, true);
    expect(next.chats.c1).toMatchObject({ ended: false, messages: [] });
  });

  it("chatEnded marks only that chat as ended", () => {
    const before = data({ chats: { c1: chat(user("p")), c2: chat(user("q")) } });
    const next = applyChatEnded(before, "c1");
    expect(next.chats.c1?.ended).toBe(true);
    expect(next.chats.c2?.ended).toBe(false);
  });
});

describe("useAppStore", () => {
  it("closeChat forgets the chat and its stored seq", () => {
    useAppStore.getState().chatOpened({ chatId: "c1", peer: user("p") }, true);
    useAppStore.getState().chatMessage("c1", msg(3, "p"));
    useAppStore.getState().closeChat("c1");
    expect(useAppStore.getState().chats.c1).toBeUndefined();
    expect(useAppStore.getState().activeChatId).toBeNull();
    expect(sessionStorage.getItem(seqStorageKey("c1"))).toBeNull();
  });

  it("a chat that ends after I asked to block them is marked as ended by me, silently", () => {
    useAppStore
      .getState()
      .chatOpened({ chatId: "c1", peer: user("p", { nickname: "mika" }) }, false);
    useAppStore.getState().blockRequested("p");
    useAppStore.getState().chatEnded("c1");
    expect(useAppStore.getState().chats.c1).toMatchObject({ ended: true, endedByMe: true });
    expect(useAppStore.getState().announcement).toBeNull();
  });

  it("announces that the peer left when the chat ends on their side", () => {
    useAppStore
      .getState()
      .chatOpened({ chatId: "c1", peer: user("p", { nickname: "mika" }) }, false);
    useAppStore.getState().chatEnded("c1");
    expect(useAppStore.getState().chats.c1).toMatchObject({ ended: true, endedByMe: false });
    expect(useAppStore.getState().announcement?.text).toBe("mika left");
    const announced = useAppStore.getState().announcement;
    useAppStore.getState().chatEnded("c1");
    expect(useAppStore.getState().announcement).toBe(announced);
  });

  it("blocking someone marks their already ended chat as ended by me", () => {
    useAppStore.getState().chatOpened({ chatId: "c1", peer: user("p") }, false);
    useAppStore.getState().chatEnded("c1");
    useAppStore.getState().hide("p");
    expect(useAppStore.getState().chats.c1).toMatchObject({ ended: true, endedByMe: true });
  });

  it("blocking someone marks their chat as ended by me", () => {
    useAppStore.getState().chatOpened({ chatId: "c1", peer: user("p") }, false);
    useAppStore.getState().hide("p");
    expect(useAppStore.getState().chats.c1).toMatchObject({ ended: true, endedByMe: true });
  });

  it("signedOut returns to entry and forgets the session but keeps the suggested country", () => {
    useAppStore.getState().bootstrap({ me, suggestedCountry: "PH", ban: null });
    useAppStore.getState().chatOpened({ chatId: "c1", peer: user("p") }, true);
    useAppStore.getState().signedOut();
    const state = useAppStore.getState();
    expect(state.session).toMatchObject({ me: null, status: "entry", suggestedCountry: "PH" });
    expect(state.chats).toEqual({});
    expect(state.activeChatId).toBeNull();
  });

  it("requestList hands back a list message with a fresh request id for the current filter", () => {
    useAppStore.getState().setFilter({ countries: ["PH"] });
    const first = useAppStore.getState().requestList(null);
    const second = useAppStore.getState().requestList("5:abc");
    expect(first).toMatchObject({ type: "list", filter: { countries: ["PH"] } });
    expect(first).not.toHaveProperty("cursor");
    expect(second).toMatchObject({ type: "list", cursor: "5:abc" });
    expect(second.requestId).not.toBe(first.requestId);
    expect(useAppStore.getState().lobby.request).toEqual({ id: second.requestId, cursor: "5:abc" });
  });

  it("mirrors lastSeq to sessionStorage and restores it as readThrough on hello", () => {
    const peer = user("p");
    useAppStore.getState().hello(hello([{ chatId: "c1", peer }]));
    useAppStore.getState().chatMessage("c1", msg(5, "p"));
    expect(sessionStorage.getItem(seqStorageKey("c1"))).toBe("5");

    useAppStore.setState(initialAppData());
    useAppStore.getState().hello(hello([{ chatId: "c1", peer }]));
    expect(useAppStore.getState().chats.c1).toMatchObject({ lastSeq: 0, readThrough: 5 });
  });

  it("keeps working when sessionStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const peer = user("p");
    useAppStore.getState().hello(hello([{ chatId: "c1", peer }]));
    useAppStore.getState().chatMessage("c1", msg(3, "p"));
    expect(useAppStore.getState().chats.c1?.lastSeq).toBe(3);
  });

  it("a reload reopens the chat I was in", () => {
    const peer = user("p");
    useAppStore.getState().hello(hello([{ chatId: "c1", peer }]));
    useAppStore.getState().setActiveChat("c1");

    useAppStore.setState(initialAppData());
    useAppStore.getState().hello(hello([{ chatId: "c1", peer }]));
    expect(useAppStore.getState().activeChatId).toBe("c1");
  });

  it("a chat I opened from the list is reopened after a reload too", () => {
    const peer = user("p");
    useAppStore.getState().chatOpened({ chatId: "c1", peer }, true);

    useAppStore.setState(initialAppData());
    useAppStore.getState().hello(hello([{ chatId: "c1", peer }]));
    expect(useAppStore.getState().activeChatId).toBe("c1");
  });

  it("a reload does not reopen a chat that no longer exists", () => {
    useAppStore.getState().hello(hello([{ chatId: "c1", peer: user("p") }]));
    useAppStore.getState().setActiveChat("c1");

    useAppStore.setState(initialAppData());
    useAppStore.getState().hello(hello([]));
    expect(useAppStore.getState().activeChatId).toBeNull();
  });

  it("a reload does not reopen a chat I went back from", () => {
    const peer = user("p");
    useAppStore.getState().hello(hello([{ chatId: "c1", peer }]));
    useAppStore.getState().setActiveChat("c1");
    useAppStore.getState().setActiveChat(null);

    useAppStore.setState(initialAppData());
    useAppStore.getState().hello(hello([{ chatId: "c1", peer }]));
    expect(useAppStore.getState().activeChatId).toBeNull();
  });

  it("leaving forgets the remembered tab and open chat", () => {
    sessionStorage.setItem("swoony-tab", "me");
    sessionStorage.setItem("swoony-open-chat", "c1");
    useAppStore.getState().signedOut();
    expect(sessionStorage.getItem("swoony-tab")).toBeNull();
    expect(sessionStorage.getItem("swoony-open-chat")).toBeNull();
  });

  it("a fresh entry starts without a remembered tab or open chat", () => {
    sessionStorage.setItem("swoony-tab", "me");
    sessionStorage.setItem("swoony-open-chat", "c1");
    useAppStore.getState().entered(user("new"));
    expect(sessionStorage.getItem("swoony-tab")).toBeNull();
    expect(sessionStorage.getItem("swoony-open-chat")).toBeNull();
  });

  it("closing the open chat stops it reopening after a reload", () => {
    const peer = user("p");
    useAppStore.getState().hello(hello([{ chatId: "c1", peer }]));
    useAppStore.getState().setActiveChat("c1");
    useAppStore.getState().closeChat("c1");

    useAppStore.setState(initialAppData());
    useAppStore.getState().hello(hello([{ chatId: "c1", peer }]));
    expect(useAppStore.getState().activeChatId).toBeNull();
  });

  it("opening a chat clears its unread count", () => {
    useAppStore.getState().hello(hello([{ chatId: "c1", peer: user("p") }]));
    useAppStore.getState().chatMessage("c1", msg(1, "p"));
    useAppStore.getState().setActiveChat("c1");
    expect(useAppStore.getState().chats.c1?.unread).toBe(0);
  });

  it("announce publishes a new announcement each call", () => {
    useAppStore.getState().announce("Mika left");
    const first = useAppStore.getState().announcement;
    useAppStore.getState().announce("Mika left");
    const second = useAppStore.getState().announcement;
    expect(second?.text).toBe("Mika left");
    expect(second?.id).not.toBe(first?.id);
  });

  it("records kicks and bans", () => {
    useAppStore.getState().kicked("idle");
    expect(useAppStore.getState().session).toMatchObject({ status: "kicked", kickReason: "idle" });
    useAppStore.getState().bootstrap({ me: null, suggestedCountry: null, ban: { until: 99 } });
    expect(useAppStore.getState().session).toMatchObject({ status: "banned", banUntil: 99 });
  });

  it("bootstrap sends a visitor without a session to entry and keeps the suggested country", () => {
    useAppStore.getState().bootstrap({ me: null, suggestedCountry: "PH", ban: null });
    expect(useAppStore.getState().session).toMatchObject({
      status: "entry",
      suggestedCountry: "PH",
    });
    useAppStore.getState().bootstrap({ me, suggestedCountry: null, ban: null });
    expect(useAppStore.getState().session).toMatchObject({ status: "lobby", me });
  });
});
