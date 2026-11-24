import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { useDetailsPane } from "./detailsPane";

vi.mock("./AdSlot", () => ({
  AdSlot: ({ placement }: { placement: string }) => <i data-ad={placement} />,
}));

function matchScreen({ desktop, wide = false }: { desktop: boolean; wide?: boolean }) {
  vi.spyOn(window, "matchMedia").mockImplementation((query) =>
    Object.assign(new EventTarget() as MediaQueryList, {
      matches: query.includes("1280px") ? wide : desktop,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

const panels = {
  online: <p>online panel</p>,
  chats: <p>chats panel</p>,
  me: <p>me panel</p>,
  account: <p>account card</p>,
  accountRail: <p>account rail</p>,
  emptyChat: "pick someone",
};

function PaneProbe() {
  const pane = useDetailsPane();
  return (
    <>
      <p>{pane.shown ? "pane shown" : "pane not shown"}</p>
      {pane.toggle && (
        <button type="button" onClick={pane.toggle}>
          toggle pane
        </button>
      )}
    </>
  );
}

it("on desktop shows the list with my account card and the chat area, no Me panel", () => {
  matchScreen({ desktop: true });
  render(<AppShell {...panels} chat={null} details={null} />);
  const nav = screen.getByRole("navigation", { name: "Main" });
  expect(within(nav).queryByRole("button", { name: "Me" })).toBeNull();
  expect(screen.getByText("online panel")).toBeInTheDocument();
  expect(screen.getByText("account card")).toBeInTheDocument();
  expect(screen.getByText("pick someone")).toBeInTheDocument();
  expect(screen.queryByText("me panel")).toBeNull();
});

it("on mobile an open chat takes the whole screen", () => {
  matchScreen({ desktop: false });
  render(<AppShell {...panels} chat={<p>chat view</p>} details={null} />);
  expect(screen.getByText("chat view")).toBeInTheDocument();
  expect(screen.queryByRole("navigation")).toBeNull();
});

it("on mobile the list stays mounted under an open chat, so going back keeps your place", () => {
  matchScreen({ desktop: false });
  const mounts = vi.fn();
  function OnlineProbe() {
    useEffect(mounts, []);
    return <p>online panel</p>;
  }
  const view = render(<AppShell {...panels} online={<OnlineProbe />} chat={null} details={null} />);
  view.rerender(
    <AppShell {...panels} online={<OnlineProbe />} chat={<p>chat view</p>} details={null} />,
  );
  view.rerender(<AppShell {...panels} online={<OnlineProbe />} chat={null} details={null} />);
  expect(mounts).toHaveBeenCalledTimes(1);
  expect(screen.getByText("online panel")).toBeVisible();
});

it("on desktop the list sidebar collapses to a rail and expands again", async () => {
  matchScreen({ desktop: true });
  const user = userEvent.setup();
  render(<AppShell {...panels} chat={null} details={null} />);
  await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
  expect(screen.queryByText("online panel")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
  expect(screen.getByText("online panel")).toBeInTheDocument();
});

it("keyboard focus moves to the opposite toggle after collapsing and expanding", async () => {
  matchScreen({ desktop: true });
  const user = userEvent.setup();
  render(<AppShell {...panels} chat={null} details={null} />);
  await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
  expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
  expect(screen.getByRole("button", { name: "Collapse sidebar" })).toHaveFocus();
});

it("on desktop the collapsed rail opens the tab that was picked", async () => {
  matchScreen({ desktop: true });
  const user = userEvent.setup();
  render(<AppShell {...panels} chat={null} details={null} />);
  await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
  await user.click(screen.getByRole("button", { name: "Chats" }));
  expect(screen.getByText("chats panel")).toBeInTheDocument();
});

it("the collapsed sidebar still shows my account at the bottom", async () => {
  matchScreen({ desktop: true });
  const user = userEvent.setup();
  render(<AppShell {...panels} chat={null} details={null} />);
  expect(screen.queryByText("account rail")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
  expect(screen.getByText("account rail")).toBeInTheDocument();
});

it("on a wide desktop the chat details pane shows beside an open chat by default", () => {
  matchScreen({ desktop: true, wide: true });
  render(<AppShell {...panels} chat={<PaneProbe />} details={<p>chat details</p>} />);
  expect(screen.getByRole("complementary", { name: "Chat details" })).toBeInTheDocument();
  expect(screen.getByText("pane shown")).toBeInTheDocument();
});

it("on a wide desktop the details pane can be hidden and stays hidden after a reload", async () => {
  matchScreen({ desktop: true, wide: true });
  const user = userEvent.setup();
  const { unmount } = render(
    <AppShell {...panels} chat={<PaneProbe />} details={<p>chat details</p>} />,
  );
  await user.click(screen.getByRole("button", { name: "toggle pane" }));
  expect(screen.queryByRole("complementary", { name: "Chat details" })).toBeNull();
  expect(screen.getByText("pane not shown")).toBeInTheDocument();
  unmount();
  render(<AppShell {...panels} chat={<PaneProbe />} details={<p>chat details</p>} />);
  expect(screen.getByText("pane not shown")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "toggle pane" }));
  expect(screen.getByText("pane shown")).toBeInTheDocument();
});

it("on a smaller desktop the details pane makes room for the chat", () => {
  matchScreen({ desktop: true, wide: false });
  render(<AppShell {...panels} chat={<PaneProbe />} details={<p>chat details</p>} />);
  expect(screen.queryByText("chat details")).toBeNull();
  expect(screen.getByText("pane not shown")).toBeInTheDocument();
});

it("on mobile there is no details pane", () => {
  matchScreen({ desktop: false, wide: true });
  render(<AppShell {...panels} chat={<PaneProbe />} details={<p>chat details</p>} />);
  expect(screen.queryByText("chat details")).toBeNull();
  expect(screen.getByText("pane not shown")).toBeInTheDocument();
});

it("the empty chat area reserves an ad position", () => {
  matchScreen({ desktop: true });
  const { container } = render(<AppShell {...panels} chat={null} details={null} />);
  expect(container.querySelector("[data-ad='chat-empty']")).not.toBeNull();
});

it("picking a tab in the collapsed rail keeps keyboard focus on that tab", async () => {
  matchScreen({ desktop: true });
  const user = userEvent.setup();
  render(<AppShell {...panels} chat={null} details={null} />);
  await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
  await user.click(screen.getByRole("button", { name: "Chats" }));
  expect(screen.getByRole("button", { name: "Chats" })).toHaveFocus();
});

it("on mobile a refresh keeps the tab I was on", async () => {
  matchScreen({ desktop: false });
  const user = userEvent.setup();
  const first = render(<AppShell {...panels} chat={null} details={null} />);
  await user.click(screen.getByRole("button", { name: "Chats" }));
  first.unmount();
  render(<AppShell {...panels} chat={null} details={null} />);
  expect(screen.getByText("chats panel")).toBeInTheDocument();
});

it("on desktop a refresh keeps the tab I was on", async () => {
  matchScreen({ desktop: true });
  const user = userEvent.setup();
  const first = render(<AppShell {...panels} chat={null} details={null} />);
  await user.click(screen.getByRole("button", { name: "Chats" }));
  first.unmount();
  render(<AppShell {...panels} chat={null} details={null} />);
  expect(screen.getByText("chats panel")).toBeInTheDocument();
});

it("on desktop a remembered Me tab falls back to Online", async () => {
  matchScreen({ desktop: false });
  const user = userEvent.setup();
  const first = render(<AppShell {...panels} chat={null} details={null} />);
  await user.click(screen.getByRole("button", { name: "Me" }));
  first.unmount();
  matchScreen({ desktop: true });
  render(<AppShell {...panels} chat={null} details={null} />);
  expect(screen.getByText("online panel")).toBeInTheDocument();
});

it("shows no ad beside an open chat, as AdSense forbids ads on private-chat screens", () => {
  matchScreen({ desktop: true, wide: true });
  const { container } = render(
    <AppShell {...panels} chat={<p>chat view</p>} details={<p>chat details</p>} />,
  );
  expect(screen.getByText("chat details")).toBeInTheDocument();
  expect(container.querySelector("[data-ad]")).toBeNull();
});

it("keeps the details pane showing for a device that only saved the list choice", () => {
  localStorage.setItem("swoony-panels", JSON.stringify({ list: false }));
  matchScreen({ desktop: true, wide: true });
  render(<AppShell {...panels} chat={<PaneProbe />} details={<p>chat details</p>} />);
  expect(screen.getByText("pane shown")).toBeInTheDocument();
  expect(screen.getByText("account rail")).toBeInTheDocument();
});
