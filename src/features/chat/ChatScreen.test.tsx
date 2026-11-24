import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { initialAppData, useAppStore, type ChatState } from "@/app/store";
import { DetailsPaneContext } from "@/components/detailsPane";
import { lobbyUser, renderWithLobby, sentOfType } from "@/features/lobby/testing";
import { ChatScreen } from "./ChatScreen";
import { ChatsList } from "./ChatsList";

const send = vi.hoisted(() => vi.fn((_chatId: string, _text: string) => true));
const retry = vi.hoisted(() => vi.fn());
const seen = vi.hoisted(() => vi.fn());
const typing = vi.hoisted(() => vi.fn());
vi.mock("@/components/AdSlot", () => ({
  AdSlot: ({ placement }: { placement: string }) => <i data-ad={placement} />,
}));
vi.mock("./useChatConnection", () => ({
  sendChatText: send,
  retryChatMessage: retry,
  sendChatSeen: seen,
  sendChatTyping: typing,
}));

const me = lobbyUser("me", { nickname: "me_me" });
const mika = lobbyUser("p", { nickname: "mika", age: 24, gender: "female", country: "PH" });

function updateChat(change: Partial<ChatState>) {
  useAppStore.setState((state) => {
    const chat = state.chats.c1;
    if (!chat) throw new Error("no chat");
    return { chats: { ...state.chats, c1: { ...chat, ...change } } };
  });
}

beforeEach(() => {
  send.mockClear();
  retry.mockClear();
  seen.mockClear();
  typing.mockClear();
  useAppStore.setState(initialAppData());
  useAppStore.getState().bootstrap({ me, suggestedCountry: "PH", ban: null });
  useAppStore.getState().chatOpened({ chatId: "c1", peer: mika }, true);
  updateChat({ connected: true });
});

function message(seq: number, from: string, text: string) {
  return { seq, from, text, sentAt: Date.UTC(2026, 10, 19, 10, seq) };
}

it("shows the peer, own and peer bubbles, and sends from the composer", async () => {
  useAppStore.getState().chatMessage("c1", message(1, "p", "hey there"));
  useAppStore.getState().chatMessage("c1", message(2, "me", "hi mika"));
  renderWithLobby(<ChatScreen chatId="c1" />);
  expect(screen.getByRole("heading", { name: "mika" })).toBeInTheDocument();
  expect(screen.getByText("24 · PH")).toBeInTheDocument();
  expect(screen.getByText("Female, 24, Philippines")).toBeInTheDocument();
  const log = screen.getByRole("log");
  expect(within(log).getByText("hey there").closest("[data-own]")).toHaveAttribute(
    "data-own",
    "false",
  );
  expect(within(log).getByText("hi mika").closest("[data-own]")).toHaveAttribute(
    "data-own",
    "true",
  );
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "Message" }), "how are you{Enter}");
  expect(send).toHaveBeenCalledWith("c1", "how are you");
});

it("ended chat shows '<nickname> left' and disables the composer", () => {
  act(() => {
    useAppStore.getState().chatEnded("c1");
  });
  renderWithLobby(<ChatScreen chatId="c1" />);
  expect(screen.getByText("mika left")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Message" })).toBeDisabled();
});

it("says you blocked them when the chat ended by your own block", () => {
  act(() => {
    useAppStore.getState().hide("p");
  });
  renderWithLobby(<ChatScreen chatId="c1" />);
  expect(screen.getByText("You blocked mika.")).toBeInTheDocument();
});

it("shows failed messages with the reason and offers retry only when it was not sent", async () => {
  updateChat({
    pending: [
      { clientId: "k1", text: "lost one", failed: "not_sent" },
      { clientId: "k2", text: "too fast", failed: "slow_down" },
    ],
  });
  renderWithLobby(<ChatScreen chatId="c1" />);
  expect(screen.getByText("Slow down a bit.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Not sent. Tap to retry" }));
  expect(retry).toHaveBeenCalledWith("c1", "k1");
});

it("the back button closes the chat", async () => {
  renderWithLobby(<ChatScreen chatId="c1" />);
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(useAppStore.getState().activeChatId).toBeNull();
});

it("the chat menu blocks and reports the peer", async () => {
  const { send: lobbySend } = renderWithLobby(<ChatScreen chatId="c1" />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Chat options" }));
  await user.click(await screen.findByRole("menuitem", { name: "Block" }));
  expect(sentOfType(lobbySend, "block")).toEqual([]);
  const confirm = await screen.findByRole("alertdialog", { name: "Block mika?" });
  await user.click(within(confirm).getByRole("button", { name: "Block" }));
  expect(sentOfType(lobbySend, "block")).toEqual([{ type: "block", userId: "p" }]);
  await user.click(screen.getByRole("button", { name: "Chat options" }));
  await user.click(await screen.findByRole("menuitem", { name: "Report" }));
  const dialog = await screen.findByRole("dialog", { name: "Report mika" });
  await user.click(within(dialog).getByRole("radio", { name: "Harassment" }));
  await user.click(within(dialog).getByRole("button", { name: "Report" }));
  expect(sentOfType(lobbySend, "report")).toEqual([
    { type: "report", userId: "p", reason: "harassment" },
  ]);
});

it("an ended chat can be closed and removed", async () => {
  act(() => {
    useAppStore.getState().chatEnded("c1");
  });
  renderWithLobby(<ChatScreen chatId="c1" />);
  await userEvent.click(screen.getByRole("button", { name: "Close chat" }));
  expect(useAppStore.getState().chats.c1).toBeUndefined();
});

it("chats list shows the last message, unread badge and opens a chat", async () => {
  useAppStore.getState().setActiveChat(null);
  useAppStore
    .getState()
    .chatOpened({ chatId: "c2", peer: lobbyUser("q", { nickname: "joy" }) }, false);
  useAppStore.getState().chatMessage("c1", message(1, "p", "first"));
  useAppStore.getState().chatMessage("c1", message(2, "p", "latest words"));
  useAppStore.getState().chatMessage("c2", message(1, "me", "my line"));
  renderWithLobby(<ChatsList />);
  const items = screen.getAllByRole("listitem");
  expect(items[0]).toHaveTextContent("mika");
  expect(items[0]).toHaveTextContent("latest words");
  const [first] = items;
  if (!first) throw new Error("no chats listed");
  expect(within(first).getByText("2")).toBeInTheDocument();
  expect(items[1]).toHaveTextContent("You: my line");
  await userEvent.click(within(first).getByRole("button", { name: /mika/ }));
  expect(useAppStore.getState().activeChatId).toBe("c1");
});

it("chats list has an empty state", () => {
  useAppStore.setState({ chats: {}, activeChatId: null });
  renderWithLobby(<ChatsList />);
  expect(screen.getByText(/No chats yet/)).toBeInTheDocument();
});

it("the info button shows the person's details when there is no side pane", async () => {
  updateChat({ peer: { ...mika, bio: "loves the beach" } });
  renderWithLobby(<ChatScreen chatId="c1" />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Chat details" }));
  const details = await screen.findByRole("dialog", { name: "mika" });
  expect(within(details).getByText("Female · 24 · Philippines")).toBeInTheDocument();
  expect(within(details).getByText("loves the beach")).toBeInTheDocument();
});

it("on a wide screen the info button shows and hides the details pane", async () => {
  const toggle = vi.fn();
  renderWithLobby(
    <DetailsPaneContext value={{ shown: true, toggle }}>
      <ChatScreen chatId="c1" />
    </DetailsPaneContext>,
  );
  const button = screen.getByRole("button", { name: "Chat details" });
  expect(button).toHaveAttribute("aria-expanded", "true");
  await userEvent.click(button);
  expect(toggle).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("the details dialog describes the person for screen readers", async () => {
  renderWithLobby(<ChatScreen chatId="c1" />);
  await userEvent.click(screen.getByRole("button", { name: "Chat details" }));
  const details = await screen.findByRole("dialog", { name: "mika" });
  expect(details).toHaveAccessibleDescription("Female · 24 · Philippines");
});

it("tells the peer the newest message from them was seen while the chat is in view", () => {
  useAppStore.getState().chatMessage("c1", message(1, "p", "hey"));
  useAppStore.getState().chatMessage("c1", message(2, "me", "hi"));
  renderWithLobby(<ChatScreen chatId="c1" />);
  expect(seen).toHaveBeenLastCalledWith("c1", 1);
  act(() => {
    useAppStore.getState().chatMessage("c1", message(3, "p", "how are you"));
  });
  expect(seen).toHaveBeenLastCalledWith("c1", 3);
});

it("does not mark messages seen while the page is hidden", () => {
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  try {
    useAppStore.getState().chatMessage("c1", message(1, "p", "hey"));
    renderWithLobby(<ChatScreen chatId="c1" />);
    expect(seen).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(seen).toHaveBeenLastCalledWith("c1", 1);
  } finally {
    visibility.mockRestore();
  }
});

it("shows the typing bubble in the messages, not the header, and sends my typing", async () => {
  updateChat({ peerTyping: true });
  renderWithLobby(<ChatScreen chatId="c1" />);
  expect(screen.getByRole("log").querySelector("[data-typing]")).not.toBeNull();
  expect(screen.queryByText("typing…")).not.toBeInTheDocument();
  expect(screen.getByText("24 · PH")).toBeInTheDocument();
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "Message" }), "h");
  expect(typing).toHaveBeenCalledWith("c1");
});

it("shows no preview text for a chat with no messages yet", () => {
  renderWithLobby(<ChatsList />);
  const row = screen.getByRole("button", { name: /mika/ });
  expect(row).toHaveTextContent(/^Mmika$/);
});

it("shows no ad inside a private chat, as AdSense forbids", () => {
  const { container } = renderWithLobby(<ChatScreen chatId="c1" />);
  expect(container.querySelector("[data-ad]")).toBeNull();
});
