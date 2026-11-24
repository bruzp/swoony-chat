import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initialAppData, useAppStore } from "@/app/store";
import { AUTO_RELOAD_MIN_GAP_MS, NEW_PEOPLE_BATCH_MS, OnlineList } from "./OnlineList";
import { lobbyUser, renderWithLobby, sentOfType } from "./testing";

const me = lobbyUser("me", { nickname: "me_me" });

function useFakeClock() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
}

function setPageVisibility(state: DocumentVisibilityState) {
  act(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

function seedList(count: number, nextCursor: string | null) {
  const store = useAppStore.getState();
  const request = store.requestList(null);
  store.page({
    type: "page",
    requestId: request.requestId,
    users: Array.from({ length: count }, (_, i) =>
      lobbyUser(`u${String(i)}`, { nickname: `user_${String(i)}`, bio: `bio ${String(i)}` }),
    ),
    nextCursor,
    online: count,
  });
}

beforeEach(() => {
  useAppStore.setState(initialAppData());
  useAppStore.getState().bootstrap({ me, suggestedCountry: "PH", ban: null });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(375);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(80);
});

afterEach(() => {
  Reflect.deleteProperty(document, "visibilityState");
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("renders rows and requests next page near the end", () => {
  seedList(40, "40:u39");
  const { send } = renderWithLobby(<OnlineList />);
  const first = screen.getByRole("listitem", { name: /user_0/ });
  expect(within(first).getByText("25 · PH")).toBeInTheDocument();
  expect(within(first).getByText("Female, 25, Philippines")).toBeInTheDocument();
  expect(within(first).getByText("bio 0")).toBeInTheDocument();
  expect(screen.queryByRole("listitem", { name: /user_39/ })).not.toBeInTheDocument();
  expect(sentOfType(send, "list")).toHaveLength(0);

  const scroller = screen.getByTestId("online-scroller");
  act(() => {
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 40 * 80 - 600 });
    fireEvent.scroll(scroller);
  });
  expect(sentOfType(send, "list")).toEqual([
    expect.objectContaining({ type: "list", cursor: "40:u39" }),
  ]);
});

it("does not ask for another page while one is on its way", () => {
  seedList(3, "3:u2");
  const { send, rerender } = renderWithLobby(<OnlineList />);
  rerender(<OnlineList />);
  expect(sentOfType(send, "list")).toHaveLength(1);
});

it("ignores presence joins that don't match the filter", () => {
  useFakeClock();
  useAppStore.getState().setFilter({ genders: ["female"] });
  seedList(0, null);
  const { send } = renderWithLobby(<OnlineList />);
  act(() => {
    useAppStore.getState().presence({
      type: "presence",
      joined: [lobbyUser("m", { nickname: "marco", gender: "male" })],
      left: [],
      updated: [],
      online: 2,
    });
  });
  act(() => {
    vi.advanceTimersByTime(NEW_PEOPLE_BATCH_MS * 2);
  });
  expect(sentOfType(send, "list")).toHaveLength(0);
});

function seedUsers(users: ReturnType<typeof lobbyUser>[]) {
  const store = useAppStore.getState();
  const request = store.requestList(null);
  store.page({ type: "page", requestId: request.requestId, users, nextCursor: null, online: 9 });
}

it("puts a header before my country's group and before everyone else", () => {
  seedUsers([
    lobbyUser("a", { nickname: "ana" }),
    lobbyUser("b", { nickname: "bea" }),
    lobbyUser("c", { nickname: "cole", country: "US" }),
  ]);
  renderWithLobby(<OnlineList />);
  const list = screen.getByRole("list", { name: "People online" });
  const order = [...list.querySelectorAll("[role=presentation], [role=listitem]")].map(
    (row) => row.getAttribute("aria-label") ?? row.textContent,
  );
  expect(order).toEqual([
    "Philippines",
    expect.stringMatching(/^ana/),
    expect.stringMatching(/^bea/),
    "Everywhere else",
    expect.stringMatching(/^cole/),
  ]);
});

it("leaves out the header of an empty group", () => {
  seedUsers([lobbyUser("c", { nickname: "cole", country: "US" })]);
  renderWithLobby(<OnlineList />);
  expect(screen.getByText("Everywhere else")).toBeInTheDocument();
  expect(screen.queryByText("Philippines")).not.toBeInTheDocument();
});

it("counts only people in the list position, not headers", () => {
  seedUsers([
    lobbyUser("a", { nickname: "ana" }),
    lobbyUser("c", { nickname: "cole", country: "US" }),
  ]);
  renderWithLobby(<OnlineList />);
  const cole = screen.getByRole("listitem", { name: /cole/ });
  expect(cole).toHaveAttribute("aria-setsize", "2");
  expect(cole).toHaveAttribute("aria-posinset", "2");
});

function join(...ids: string[]) {
  act(() => {
    useAppStore.getState().presence({
      type: "presence",
      joined: ids.map((id) => lobbyUser(id, { nickname: `${id}_new` })),
      left: [],
      updated: [],
      online: ids.length + 2,
    });
  });
}

function scrollTo(scroller: HTMLElement, top: number) {
  act(() => {
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: top });
    fireEvent.scroll(scroller);
  });
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

it("quietly reloads the list from the top in one batch when new people join", () => {
  useFakeClock();
  seedUsers([lobbyUser("a", { nickname: "ana" })]);
  const { send } = renderWithLobby(<OnlineList />);
  join("x", "y");
  advance(NEW_PEOPLE_BATCH_MS / 2);
  join("z");
  expect(sentOfType(send, "list")).toHaveLength(0);
  advance(NEW_PEOPLE_BATCH_MS / 2);
  const lists = sentOfType(send, "list");
  expect(lists).toHaveLength(1);
  expect(lists[0]).not.toHaveProperty("cursor");
  expect(screen.queryByRole("button", { name: /new (person|people)/ })).not.toBeInTheDocument();
});

it("keeps the list still while scrolled down, then reloads back at the top", () => {
  useFakeClock();
  seedList(40, null);
  const { send } = renderWithLobby(<OnlineList />);
  const scroller = screen.getByTestId("online-scroller");
  scrollTo(scroller, 800);
  join("x");
  advance(NEW_PEOPLE_BATCH_MS * 3);
  expect(sentOfType(send, "list")).toHaveLength(0);
  scrollTo(scroller, 0);
  advance(NEW_PEOPLE_BATCH_MS);
  expect(sentOfType(send, "list")).toHaveLength(1);
});

it("shows the new person once the fresh list arrives", () => {
  useFakeClock();
  seedUsers([lobbyUser("a", { nickname: "ana" })]);
  const { send } = renderWithLobby(<OnlineList />);
  join("x");
  advance(NEW_PEOPLE_BATCH_MS);
  const request = sentOfType(send, "list")[0];
  act(() => {
    useAppStore.getState().page({
      type: "page",
      requestId: request?.requestId ?? "",
      users: [lobbyUser("x", { nickname: "x_new" }), lobbyUser("a", { nickname: "ana" })],
      nextCursor: null,
      online: 3,
    });
  });
  expect(screen.getByRole("listitem", { name: /x_new/ })).toBeInTheDocument();
  advance(NEW_PEOPLE_BATCH_MS * 2);
  expect(sentOfType(send, "list")).toHaveLength(1);
});

function answer(
  send: ReturnType<typeof renderWithLobby>["send"],
  users: ReturnType<typeof lobbyUser>[],
) {
  const request = sentOfType(send, "list").at(-1);
  act(() => {
    useAppStore.getState().page({
      type: "page",
      requestId: request?.requestId ?? "",
      users,
      nextCursor: null,
      online: users.length + 1,
    });
  });
}

it("waits a few seconds between automatic reloads in a busy lobby", () => {
  useFakeClock();
  seedUsers([lobbyUser("a", { nickname: "ana" })]);
  const { send } = renderWithLobby(<OnlineList />);
  join("x");
  advance(NEW_PEOPLE_BATCH_MS);
  answer(send, [lobbyUser("x"), lobbyUser("a")]);
  join("y");
  advance(NEW_PEOPLE_BATCH_MS);
  expect(sentOfType(send, "list")).toHaveLength(1);
  advance(AUTO_RELOAD_MIN_GAP_MS - NEW_PEOPLE_BATCH_MS);
  expect(sentOfType(send, "list")).toHaveLength(2);
});

it("does not reload while the tab is hidden, then catches up when it is shown", () => {
  useFakeClock();
  seedUsers([lobbyUser("a", { nickname: "ana" })]);
  const { send } = renderWithLobby(<OnlineList />);
  setPageVisibility("hidden");
  join("x");
  advance(NEW_PEOPLE_BATCH_MS * 5);
  expect(sentOfType(send, "list")).toHaveLength(0);
  setPageVisibility("visible");
  advance(NEW_PEOPLE_BATCH_MS);
  expect(sentOfType(send, "list")).toHaveLength(1);
});

it("does not reload while the list is paused", () => {
  useFakeClock();
  seedUsers([lobbyUser("a", { nickname: "ana" })]);
  const { send } = renderWithLobby(<OnlineList />);
  act(() => {
    useAppStore.getState().pauseList();
  });
  join("x");
  advance(NEW_PEOPLE_BATCH_MS * 5);
  expect(sentOfType(send, "list")).toHaveLength(0);
});

it("does not reload while another list request is on its way", () => {
  useFakeClock();
  seedUsers([lobbyUser("a", { nickname: "ana" })]);
  const { send } = renderWithLobby(<OnlineList />);
  act(() => {
    useAppStore.getState().requestList(null);
  });
  join("x");
  advance(NEW_PEOPLE_BATCH_MS * 5);
  expect(sentOfType(send, "list")).toHaveLength(0);
});

it("checks the real scroll position before reloading", () => {
  useFakeClock();
  seedList(40, null);
  const { send } = renderWithLobby(<OnlineList />);
  const scroller = screen.getByTestId("online-scroller");
  Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 800 });
  join("x");
  advance(NEW_PEOPLE_BATCH_MS * 3);
  expect(sentOfType(send, "list")).toHaveLength(0);
});

it("tells screen readers once when new people are added", () => {
  useFakeClock();
  seedUsers([lobbyUser("a", { nickname: "ana" })]);
  renderWithLobby(<OnlineList />);
  const status = screen.getByRole("status");
  expect(status).toHaveTextContent("");
  join("x", "y");
  expect(status).toHaveTextContent("");
  advance(NEW_PEOPLE_BATCH_MS);
  expect(status).toHaveTextContent("2 new people added to the list");
});

it("shows empty state copy", () => {
  useAppStore.getState().setFilter({ genders: ["male"] });
  seedList(0, null);
  renderWithLobby(<OnlineList />);
  expect(screen.getByText("No one matches these filters right now.")).toBeInTheDocument();
});

it("says no one else is online when no filter is set", () => {
  seedList(0, null);
  renderWithLobby(<OnlineList />);
  expect(screen.getByText("No one else is online right now.")).toBeInTheDocument();
});

it.each([
  [0, "0 others online"],
  [1, "1 other online"],
  [2, "2 others online"],
])("counts %i other people online", (count, label) => {
  seedList(count, null);
  renderWithLobby(<OnlineList />);
  expect(screen.getByText(label)).toBeInTheDocument();
});

it("tells screen readers the full list size", () => {
  seedList(40, null);
  renderWithLobby(<OnlineList />);
  const first = screen.getByRole("listitem", { name: /user_0/ });
  expect(first).toHaveAttribute("aria-setsize", "40");
  expect(first).toHaveAttribute("aria-posinset", "1");
});

it("the Chat button opens a chat with that person", async () => {
  seedList(2, null);
  const { send } = renderWithLobby(<OnlineList />);
  const row = screen.getByRole("listitem", { name: /user_1/ });
  await userEvent.click(within(row).getByRole("button", { name: "Chat with user_1" }));
  expect(sentOfType(send, "openChat")).toEqual([{ type: "openChat", userId: "u1" }]);
});

it("tapping a person's name opens a chat, not a profile", async () => {
  seedList(2, null);
  const { send } = renderWithLobby(<OnlineList />);
  await userEvent.click(screen.getByText("user_0"));
  expect(sentOfType(send, "openChat")).toEqual([{ type: "openChat", userId: "u0" }]);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("the options menu blocks after confirmation", async () => {
  seedList(2, null);
  const { send } = renderWithLobby(<OnlineList />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "More options for user_0" }));
  await user.click(await screen.findByRole("menuitem", { name: "Block" }));
  const confirm = await screen.findByRole("alertdialog", { name: "Block user_0?" });
  expect(sentOfType(send, "block")).toEqual([]);
  await user.click(within(confirm).getByRole("button", { name: "Block" }));
  expect(sentOfType(send, "block")).toEqual([{ type: "block", userId: "u0" }]);
});

it("cancelling the block confirmation blocks no one", async () => {
  seedList(2, null);
  const { send } = renderWithLobby(<OnlineList />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "More options for user_0" }));
  await user.click(await screen.findByRole("menuitem", { name: "Block" }));
  const confirm = await screen.findByRole("alertdialog");
  await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
  expect(sentOfType(send, "block")).toEqual([]);
});

it("reporting from the options menu sends the chosen reason", async () => {
  seedList(2, null);
  const { send } = renderWithLobby(<OnlineList />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "More options for user_1" }));
  await user.click(await screen.findByRole("menuitem", { name: "Report" }));
  const dialog = await screen.findByRole("dialog", { name: "Report user_1" });
  await user.click(within(dialog).getByRole("radio", { name: "Spam" }));
  await user.click(within(dialog).getByRole("button", { name: "Report" }));
  expect(sentOfType(send, "report")).toEqual([{ type: "report", userId: "u1", reason: "spam" }]);
});

it("rows have no separate Chat label, since the whole row opens the chat", () => {
  seedList(2, null);
  renderWithLobby(<OnlineList />);
  const row = screen.getByRole("listitem", { name: /user_0/ });
  expect(within(row).queryByText("Chat")).not.toBeInTheDocument();
});

it("View profile in the options menu shows full details and bio", async () => {
  seedList(2, null);
  renderWithLobby(<OnlineList />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "More options for user_0" }));
  await user.click(await screen.findByRole("menuitem", { name: "View profile" }));
  const profile = await screen.findByRole("dialog", { name: "user_0" });
  expect(within(profile).getByText("Female · 25 · Philippines")).toBeInTheDocument();
  expect(within(profile).getByText("bio 0")).toBeInTheDocument();
});

it("Chat in the profile opens a chat and closes the profile", async () => {
  seedList(2, null);
  const { send } = renderWithLobby(<OnlineList />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "More options for user_1" }));
  await user.click(await screen.findByRole("menuitem", { name: "View profile" }));
  const profile = await screen.findByRole("dialog", { name: "user_1" });
  await user.click(within(profile).getByRole("button", { name: "Chat" }));
  expect(sentOfType(send, "openChat")).toEqual([{ type: "openChat", userId: "u1" }]);
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

it("closes the profile when that person leaves", async () => {
  seedList(2, null);
  renderWithLobby(<OnlineList />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "More options for user_0" }));
  await user.click(await screen.findByRole("menuitem", { name: "View profile" }));
  await screen.findByRole("dialog", { name: "user_0" });
  act(() => {
    useAppStore
      .getState()
      .presence({ type: "presence", joined: [], left: ["u0"], updated: [], online: 2 });
  });
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

it("the profile dialog describes the person for screen readers", async () => {
  seedList(2, null);
  renderWithLobby(<OnlineList />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "More options for user_0" }));
  await user.click(await screen.findByRole("menuitem", { name: "View profile" }));
  const profile = await screen.findByRole("dialog", { name: "user_0" });
  expect(profile).toHaveAccessibleDescription("Female · 25 · Philippines");
});
