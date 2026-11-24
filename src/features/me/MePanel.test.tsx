import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it } from "vitest";
import { initialAppData, useAppStore } from "@/app/store";
import { lobbyUser, renderWithLobby, sentOfType } from "@/features/lobby/testing";
import { MePanel } from "./MePanel";

const me = lobbyUser("me", { nickname: "mika", bio: "Coffee first" });

beforeEach(() => {
  useAppStore.setState(initialAppData());
  useAppStore.getState().bootstrap({ me, suggestedCountry: "PH", ban: null });
});

it("shows my profile and bio", () => {
  renderWithLobby(<MePanel />);
  expect(screen.getByText("mika")).toBeInTheDocument();
  expect(screen.getByText("Coffee first")).toBeInTheDocument();
});

it("edits the bio and sends it to the lobby", async () => {
  const { send } = renderWithLobby(<MePanel />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Edit bio" }));
  const box = screen.getByRole("textbox", { name: "Bio" });
  expect(box).toHaveValue("Coffee first");
  await user.clear(box);
  await user.type(box, "Night owl");
  expect(screen.getByText("9/150")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(sentOfType(send, "setBio")).toEqual([{ type: "setBio", bio: "Night owl" }]);
  expect(screen.queryByRole("textbox", { name: "Bio" })).not.toBeInTheDocument();
  act(() => {
    useAppStore.getState().presence({
      type: "presence",
      joined: [],
      left: [],
      updated: [{ ...me, bio: "Night owl" }],
      online: 1,
    });
  });
  expect(screen.getByText("Night owl")).toBeInTheDocument();
});

it("rejects a bio with contact details before sending", async () => {
  const { send } = renderWithLobby(<MePanel />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Edit bio" }));
  const box = screen.getByRole("textbox", { name: "Bio" });
  await user.clear(box);
  await user.type(box, "add me on ig");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(sentOfType(send, "setBio")).toEqual([]);
  expect(box).toHaveAccessibleDescription(/links, contact details or rude words/);
});

it("keeps the editor and the text open when the bio could not be sent", async () => {
  const { send } = renderWithLobby(<MePanel />);
  send.mockReturnValue(false);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Edit bio" }));
  const box = screen.getByRole("textbox", { name: "Bio" });
  await user.clear(box);
  await user.type(box, "Night owl");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("textbox", { name: "Bio" })).toHaveValue("Night owl");
});

it("cancel keeps the old bio", async () => {
  const { send } = renderWithLobby(<MePanel />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Edit bio" }));
  await user.type(screen.getByRole("textbox", { name: "Bio" }), " and tea");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(sentOfType(send, "setBio")).toEqual([]);
  expect(screen.getByText("Coffee first")).toBeInTheDocument();
});

it("an empty bio can be saved to clear it", async () => {
  const { send } = renderWithLobby(<MePanel />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Edit bio" }));
  await user.clear(screen.getByRole("textbox", { name: "Bio" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(sentOfType(send, "setBio")).toEqual([{ type: "setBio", bio: "" }]);
});

it("leaving asks for confirmation first", async () => {
  const { send } = renderWithLobby(<MePanel />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Leave Swoony" }));
  const confirm = await screen.findByRole("alertdialog", { name: "Leave Swoony?" });
  expect(sentOfType(send, "leave")).toEqual([]);
  await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
  expect(sentOfType(send, "leave")).toEqual([]);
  await user.click(screen.getByRole("button", { name: "Leave Swoony" }));
  await user.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Leave" }),
  );
  expect(sentOfType(send, "leave")).toEqual([{ type: "leave" }]);
});
