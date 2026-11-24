import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { initialAppData, useAppStore } from "@/app/store";
import { pretendTouchScreen } from "@/test/touchScreen";
import { FilterBar } from "./FilterBar";
import { lobbyUser, renderWithLobby, sentOfType } from "./testing";

beforeEach(() => {
  useAppStore.setState(initialAppData());
  useAppStore.getState().bootstrap({ me: lobbyUser("me"), suggestedCountry: "PH", ban: null });
  const store = useAppStore.getState();
  const request = store.requestList(null);
  store.page({
    type: "page",
    requestId: request.requestId,
    users: [lobbyUser("a")],
    nextCursor: "1:a",
    online: 2,
  });
});

it("changing a filter resets list and requests page 1", async () => {
  const { send } = renderWithLobby(<FilterBar />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Gender/ }));
  const panel = await screen.findByRole("dialog");
  await user.click(within(panel).getByRole("checkbox", { name: "Female" }));
  await user.keyboard("{Escape}");
  const lists = sentOfType(send, "list");
  expect(lists).toEqual([expect.objectContaining({ filter: { genders: ["female"] } })]);
  expect(lists[0]).not.toHaveProperty("cursor");
  expect(useAppStore.getState().lobby).toMatchObject({
    users: [],
    nextCursor: null,
    filter: { genders: ["female"] },
  });
  expect(screen.getByRole("button", { name: /Female/ })).toBeInTheDocument();
});

it("genders sit in one dropdown instead of a chip each", () => {
  renderWithLobby(<FilterBar />);
  expect(screen.queryByRole("button", { name: "Male" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Gender/ })).toBeInTheDocument();
});

it("unticking every gender clears the gender filter", async () => {
  useAppStore.getState().setFilter({ genders: ["male"] });
  const { send } = renderWithLobby(<FilterBar />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Male/ }));
  const panel = await screen.findByRole("dialog");
  await user.click(within(panel).getByRole("checkbox", { name: "Male" }));
  await user.keyboard("{Escape}");
  expect(sentOfType(send, "list").at(-1)).toMatchObject({ filter: {} });
});

it("filters by an age range", async () => {
  const { send } = renderWithLobby(<FilterBar />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Age/ }));
  const panel = await screen.findByRole("dialog");
  await user.clear(within(panel).getByLabelText("From"));
  await user.type(within(panel).getByLabelText("From"), "25");
  await user.clear(within(panel).getByLabelText("To"));
  await user.type(within(panel).getByLabelText("To"), "30");
  await user.click(within(panel).getByRole("button", { name: "Apply" }));
  expect(sentOfType(send, "list").at(-1)).toMatchObject({ filter: { minAge: 25, maxAge: 30 } });
  expect(screen.getByRole("button", { name: /Age 25–30/ })).toBeInTheDocument();
});

it("filters by countries picked from a searchable list once the picker closes", async () => {
  const { send } = renderWithLobby(<FilterBar />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Country/ }));
  const panel = await screen.findByRole("dialog");
  await user.type(within(panel).getByLabelText("Search countries"), "phil");
  expect(within(panel).queryByRole("checkbox", { name: "Japan" })).not.toBeInTheDocument();
  await user.click(within(panel).getByRole("checkbox", { name: "Philippines" }));
  await user.clear(within(panel).getByLabelText("Search countries"));
  await user.type(within(panel).getByLabelText("Search countries"), "japan");
  await user.click(within(panel).getByRole("checkbox", { name: "Japan" }));
  expect(sentOfType(send, "list")).toHaveLength(0);
  await user.keyboard("{Escape}");
  expect(sentOfType(send, "list")).toEqual([
    expect.objectContaining({ filter: { countries: ["PH", "JP"] } }),
  ]);
  expect(screen.getByRole("button", { name: /2 countries/ })).toBeInTheDocument();
});

it("closing the country picker without changes sends nothing", async () => {
  const { send } = renderWithLobby(<FilterBar />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Country/ }));
  await screen.findByRole("dialog");
  await user.keyboard("{Escape}");
  expect(sentOfType(send, "list")).toHaveLength(0);
});

it("Clear removes every filter", async () => {
  useAppStore.getState().setFilter({ genders: ["male"], minAge: 30 });
  const { send } = renderWithLobby(<FilterBar />);
  await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(sentOfType(send, "list").at(-1)).toMatchObject({ filter: {} });
  expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
});

it("each filter dropdown is named for screen readers", async () => {
  renderWithLobby(<FilterBar />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Gender/ }));
  expect(await screen.findByRole("dialog", { name: "Gender" })).toBeInTheDocument();
});

it("pins my own country on top of the country list, then the rest A to Z", async () => {
  renderWithLobby(<FilterBar />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Country/ }));
  const panel = await screen.findByRole("dialog");
  expect(within(panel).getByText("Your country")).toBeInTheDocument();
  const names = within(panel)
    .getAllByRole("checkbox")
    .map((box) => box.closest("label")?.textContent);
  expect(names[0]).toBe("Philippines");
  const rest = names.slice(1);
  expect(rest).not.toContain("Philippines");
  expect(rest).toEqual([...rest].sort((a, b) => (a ?? "").localeCompare(b ?? "")));
});

it("keeps my pinned country while searching only if it matches", async () => {
  renderWithLobby(<FilterBar />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Country/ }));
  const panel = await screen.findByRole("dialog");
  await user.type(within(panel).getByLabelText("Search countries"), "phil");
  expect(within(panel).getByText("Your country")).toBeInTheDocument();
  await user.clear(within(panel).getByLabelText("Search countries"));
  await user.type(within(panel).getByLabelText("Search countries"), "japan");
  expect(within(panel).queryByText("Your country")).not.toBeInTheDocument();
  expect(within(panel).getAllByRole("checkbox")).toHaveLength(1);
});

it("keeps the phone keyboard closed when the country list opens on a touch screen", async () => {
  pretendTouchScreen();
  renderWithLobby(<FilterBar />);
  await userEvent.setup().click(screen.getByRole("button", { name: /Country/ }));
  await screen.findByRole("dialog", { name: "Country" });
  expect(screen.getByPlaceholderText("Search countries")).not.toHaveFocus();
  vi.restoreAllMocks();
});

it("focuses the country search on devices with a mouse", async () => {
  renderWithLobby(<FilterBar />);
  await userEvent.setup().click(screen.getByRole("button", { name: /Country/ }));
  await screen.findByRole("dialog", { name: "Country" });
  expect(screen.getByPlaceholderText("Search countries")).toHaveFocus();
});
