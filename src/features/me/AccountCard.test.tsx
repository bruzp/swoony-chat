import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it } from "vitest";
import { initialAppData, useAppStore } from "@/app/store";
import { lobbyUser, renderWithLobby, sentOfType } from "@/features/lobby/testing";
import { AccountCard } from "./AccountCard";

beforeEach(() => {
  useAppStore.setState(initialAppData());
  useAppStore.getState().bootstrap({
    me: lobbyUser("me", { nickname: "jane", age: 21, bio: "hello" }),
    suggestedCountry: "PH",
    ban: null,
  });
});

it("shows who I am", () => {
  renderWithLobby(<AccountCard />);
  expect(screen.getByText("jane")).toBeInTheDocument();
  expect(screen.getByText("21 · PH")).toBeInTheDocument();
  expect(screen.getByText("Female, 21, Philippines")).toBeInTheDocument();
});

it("Leave asks for confirmation, then leaves", async () => {
  const { send } = renderWithLobby(<AccountCard />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Leave Swoony" }));
  const confirm = await screen.findByRole("alertdialog", { name: "Leave Swoony?" });
  expect(sentOfType(send, "leave")).toEqual([]);
  await user.click(within(confirm).getByRole("button", { name: "Leave" }));
  expect(sentOfType(send, "leave")).toEqual([{ type: "leave" }]);
});

it("the card opens my settings with bio and theme", async () => {
  renderWithLobby(<AccountCard />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "My profile and settings" }));
  const settings = await screen.findByRole("dialog");
  expect(within(settings).getByText("hello")).toBeInTheDocument();
  expect(within(settings).getByRole("button", { name: "Edit bio" })).toBeInTheDocument();
  expect(within(settings).getByRole("group", { name: "Theme" })).toBeInTheDocument();
});

it("the compact card keeps settings and Leave but hides the text", async () => {
  renderWithLobby(<AccountCard compact />);
  expect(screen.queryByText("jane")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Leave Swoony" })).toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "My profile and settings" }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
});
