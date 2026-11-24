import { screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { initialAppData, useAppStore } from "@/app/store";
import { OnlineList } from "./OnlineList";
import { lobbyUser, renderWithLobby } from "./testing";

vi.mock("@shared/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/config")>()),
  ADS_ENABLED: true,
}));

beforeEach(() => {
  useAppStore.setState(initialAppData());
  useAppStore.getState().bootstrap({ me: lobbyUser("me"), suggestedCountry: "PH", ban: null });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(2000);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(375);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(60);
});

function seed(countries: string[]) {
  const store = useAppStore.getState();
  const request = store.requestList(null);
  store.page({
    type: "page",
    requestId: request.requestId,
    users: countries.map((country, i) =>
      lobbyUser(`u${String(i)}`, { nickname: `user_${String(i)}`, country }),
    ),
    nextCursor: null,
    online: countries.length + 1,
  });
}

function rowOrder(): string[] {
  const list = screen.getByRole("list", { name: "People online" });
  return [...list.querySelectorAll("[role=presentation], [role=listitem]")].map((row) => {
    if (row.querySelector("[data-ad-placement]")) return "ad";
    if (row.getAttribute("role") === "presentation") return "header";
    return "user";
  });
}

it("puts the ad after the fifth person", () => {
  seed(Array.from({ length: 8 }, () => "PH"));
  renderWithLobby(<OnlineList />);
  expect(rowOrder()).toEqual([
    "header",
    ...Array.from({ length: 5 }, () => "user"),
    "ad",
    "user",
    "user",
    "user",
  ]);
});

it("never puts the ad directly before a group header", () => {
  seed(["PH", "PH", "PH", "PH", "PH", "US", "US", "US"]);
  renderWithLobby(<OnlineList />);
  const order = rowOrder();
  expect(order).toEqual([
    "header",
    ...Array.from({ length: 5 }, () => "user"),
    "header",
    "user",
    "ad",
    "user",
    "user",
  ]);
});
