import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PublicUser } from "@shared/profile";
import type { SessionBootstrap } from "@shared/protocol/api";
import { App } from "./App";
import { initialAppData, useAppStore } from "./store";

vi.mock("@/features/entry/TurnstileField", async () => {
  const { useEffect } = await import("react");
  return {
    TurnstileField: ({ onToken }: { onToken: (token: string) => void }) => {
      useEffect(() => {
        onToken("tok");
      }, [onToken]);
      return null;
    },
  };
});

const me: PublicUser = {
  userId: "u",
  nickname: "mika",
  gender: "female",
  age: 25,
  country: "PH",
  bio: "",
};

function serve(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))),
  );
}

function boot(over: Partial<SessionBootstrap>): SessionBootstrap {
  return { me: null, suggestedCountry: null, ban: null, ...over };
}

beforeEach(() => {
  useAppStore.setState(initialAppData());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("renders the Swoony wordmark", async () => {
  serve(200, boot({}));
  render(<App />);
  await screen.findByRole("heading", { name: "Meet someone new" });
  expect(screen.getByText("swoony")).toBeInTheDocument();
});

it("shows the shell with bottom tabs for a visitor who already has a session", async () => {
  serve(200, boot({ me }));
  render(<App />);
  const nav = await screen.findByRole("navigation", { name: "Main" });
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  for (const name of ["Online", "Chats", "Me"]) {
    expect(within(nav).getByRole("button", { name })).toBeInTheDocument();
  }
  await userEvent.click(within(nav).getByRole("button", { name: "Me" }));
  expect(screen.getByText("mika")).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Theme" })).toBeInTheDocument();
});

it("shows the unread count on the Chats tab", async () => {
  serve(200, boot({ me }));
  render(<App />);
  await screen.findByRole("navigation", { name: "Main" });
  useAppStore.setState((state) => ({
    chats: {
      c1: {
        peer: { ...me, userId: "p" },
        messages: [],
        pending: [],
        unread: 2,
        ended: false,
        lastSeq: 0,
        readThrough: 0,
        connected: false,
        endedByMe: false,
        peerSeen: 0,
        peerTyping: false,
      },
    },
    session: { ...state.session },
  }));
  expect(await screen.findByRole("button", { name: "Chats, 2 unread" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Online" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Me" })).toBeInTheDocument();
});

it("tells a banned visitor when the ban ends", async () => {
  serve(200, boot({ ban: { until: Date.UTC(2030, 0, 1) } }));
  render(<App />);
  expect(await screen.findByText(/can't chat right now/)).toBeInTheDocument();
});

it("redirects to /unavailable/ when the API answers region_unavailable", async () => {
  const replace = vi.fn();
  vi.stubGlobal("location", { href: window.location.href, replace });
  serve(451, { error: "region_unavailable" });
  render(<App />);
  await waitFor(() => {
    expect(replace).toHaveBeenCalledWith("/unavailable/");
  });
});

it("shows the entry form to a new visitor and the lobby once they entered", async () => {
  serve(200, boot({ suggestedCountry: "PH" }));
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Meet someone new" })).toBeInTheDocument();
  expect(screen.getByLabelText("Country")).toHaveDisplayValue("Philippines");
  serve(200, { me });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Nickname"), "mika");
  await user.click(screen.getByRole("radio", { name: "Female" }));
  await user.type(screen.getByLabelText("Age"), "25");
  await user.click(screen.getByRole("checkbox", { name: /18 or older/ }));
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Start chatting" })).toBeEnabled();
  });
  await user.click(screen.getByRole("button", { name: "Start chatting" }));
  const rules = await screen.findByRole("alertdialog", { name: "Before you start" });
  expect(within(rules).getByText(/Be kind and respectful/)).toBeInTheDocument();
  await user.click(within(rules).getByRole("button", { name: "I agree" }));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(await screen.findByRole("navigation", { name: "Main" })).toBeInTheDocument();
});

it("offers a retry when the session request fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new TypeError("offline"))),
  );
  render(<App />);
  await screen.findByText(/couldn't reach Swoony/);
  serve(200, boot({}));
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { name: "Meet someone new" })).toBeInTheDocument();
});

it("applies the remembered theme to the document", async () => {
  localStorage.setItem("swoony-theme", "dark");
  serve(200, boot({}));
  render(<App />);
  await screen.findByRole("heading", { name: "Meet someone new" });
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  localStorage.clear();
});

it("switching chats starts with an empty message box", async () => {
  serve(200, boot({ me }));
  render(<App />);
  await screen.findByRole("navigation", { name: "Main" });
  act(() => {
    const store = useAppStore.getState();
    store.chatOpened({ chatId: "c1", peer: { ...me, userId: "p1", nickname: "mika" } }, false);
    store.chatOpened({ chatId: "c2", peer: { ...me, userId: "p2", nickname: "joy" } }, true);
  });
  const user = userEvent.setup();
  await user.type(await screen.findByRole("textbox", { name: "Message" }), "for joy only");
  act(() => {
    useAppStore.getState().setActiveChat("c1");
  });
  expect(await screen.findByRole("heading", { name: "mika" })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("");
});

it("shows the maintenance screen with the owner's message while Swoony is down", async () => {
  serve(503, { error: "maintenance", message: "Back at 3 pm" });
  render(<App />);
  expect(
    await screen.findByText("Swoony is down for a short update. Please come back soon."),
  ).toBeInTheDocument();
  expect(screen.getByText("Back at 3 pm")).toBeInTheDocument();
});

it("shows the maintenance screen when removed for maintenance", async () => {
  serve(200, boot({ me }));
  render(<App />);
  await screen.findByRole("navigation", { name: "Main" });
  serve(503, { error: "maintenance", message: "" });
  act(() => {
    useAppStore.getState().kicked("maintenance");
  });
  expect(
    await screen.findByText("Swoony is down for a short update. Please come back soon."),
  ).toBeInTheDocument();
});

it("offers to use Swoony here after another tab took over", async () => {
  serve(200, boot({ me }));
  render(<App />);
  await screen.findByRole("navigation", { name: "Main" });
  act(() => {
    useAppStore.getState().openedElsewhere();
  });
  expect(await screen.findByText("Swoony is open in another tab.")).toBeInTheDocument();
  const reload = vi.fn();
  vi.stubGlobal("location", { reload });
  await userEvent.click(screen.getByRole("button", { name: "Use Swoony here" }));
  expect(reload).toHaveBeenCalled();
});
