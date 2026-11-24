import type { LegalRecords } from "@shared/legal/records";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionEndedError, type AdminApi } from "./adminApi";
import { AdminApp } from "./AdminApp";

const USER_ID = "3f2b8c4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const CHAT_ID = "a".repeat(64);

const RECORDS: LegalRecords = {
  connections: [
    {
      userId: USER_ID,
      nickname: "mika_24",
      ip: "112.198.64.21",
      country: "PH",
      detectedCountry: "PH",
      joinedAt: Date.UTC(2026, 10, 12, 13),
      leftAt: null,
    },
  ],
  chats: [
    {
      chatId: CHAT_ID,
      userA: USER_ID,
      userB: "peer",
      startedAt: Date.UTC(2026, 10, 12, 13, 20),
      endedAt: null,
    },
  ],
  content: [
    {
      chatId: CHAT_ID,
      kind: "report_snapshot",
      reason: "harassment",
      createdAt: Date.UTC(2026, 10, 12, 14),
      messages: [{ from: USER_ID, text: "saved words", sentAt: Date.UTC(2026, 10, 12, 13, 30) }],
    },
  ],
};

function fakeApi(overrides: Partial<AdminApi> = {}): AdminApi {
  return {
    whoami: vi.fn(() => Promise.resolve({ email: "owner@example.com" })),
    lookup: vi.fn(() => Promise.resolve(RECORDS)),
    ban: vi.fn(() => Promise.resolve({ deviceUntil: 1, networkUntil: 1, kicked: true })),
    takedown: vi.fn(() => Promise.resolve({ evidenceSaved: 1, contentDeleted: 0, contentHeld: 1 })),
    hold: vi.fn(() => Promise.resolve({ changed: 2 })),
    holds: vi.fn(() => Promise.resolve({ holds: [] })),
    audit: vi.fn(() =>
      Promise.resolve({
        rows: [],
        chain: { intact: true, checked: 0, brokenAt: null, complete: true },
      }),
    ),
    exportFile: vi.fn(() =>
      Promise.resolve({
        blob: new Blob(["x"]),
        fileName: "NBI-1-2026-11-19.pdf",
        sha256: "ab12",
        parts: 1,
      }),
    ),
    health: vi.fn(() => Promise.reject(new Error("unused"))),
    maintenance: vi.fn(() => Promise.reject(new Error("unused"))),
    setMaintenance: vi.fn(() => Promise.reject(new Error("unused"))),
    ...overrides,
  };
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
});

async function search(user: ReturnType<typeof userEvent.setup>, caseRef = "NBI-2026-1142") {
  await user.type(screen.getByLabelText("Nickname or user ID"), "mika_24");
  if (caseRef) await user.type(screen.getByLabelText("Case reference"), caseRef);
  await user.click(screen.getByRole("button", { name: "Search records" }));
}

describe("case lookup", () => {
  it("asks for a valid case reference before searching", async () => {
    const api = fakeApi();
    const user = userEvent.setup();
    render(<AdminApp api={api} />);
    await search(user, "");
    expect(await screen.findByText(/Enter a case reference/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Case reference"), "a b");
    await user.click(screen.getByRole("button", { name: "Search records" }));
    expect(api.lookup).not.toHaveBeenCalled();
  });

  it("explains the case reference box instead of showing a value-like example", () => {
    render(<AdminApp api={fakeApi()} />);
    const box = screen.getByLabelText("Case reference");
    expect(box).toHaveAttribute("placeholder", "e.g. NBI-2026-1142");
    expect(box).toHaveAccessibleDescription(
      "The number on the notice. No number? Use your own, like SWOONY-2026-001.",
    );
  });

  it("searches by nickname with the case reference and shows the records", async () => {
    const api = fakeApi();
    const user = userEvent.setup();
    render(<AdminApp api={api} />);
    await search(user);
    expect(api.lookup).toHaveBeenCalledWith(
      "NBI-2026-1142",
      expect.objectContaining({ nickname: "mika_24" }),
    );
    expect(await screen.findByText("112.198.64.21")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Saved messages/ }));
    expect(screen.getByText("saved words")).toBeInTheDocument();
  });

  it("searches by user ID when the text is a user ID", async () => {
    const api = fakeApi();
    const user = userEvent.setup();
    render(<AdminApp api={api} />);
    await user.type(screen.getByLabelText("Nickname or user ID"), USER_ID);
    await user.type(screen.getByLabelText("Case reference"), "NBI-1");
    await user.click(screen.getByRole("button", { name: "Search records" }));
    expect(api.lookup).toHaveBeenCalledWith("NBI-1", expect.objectContaining({ userId: USER_ID }));
  });

  it("confirms a ban, repeating the target and case reference, then sends it", async () => {
    const api = fakeApi();
    const user = userEvent.setup();
    render(<AdminApp api={api} />);
    await search(user);
    await user.click(await screen.findByRole("button", { name: `Ban ${USER_ID}` }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(USER_ID)).toBeInTheDocument();
    expect(within(dialog).getByText("NBI-2026-1142")).toBeInTheDocument();
    expect(api.ban).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Ban user" }));
    expect(api.ban).toHaveBeenCalledWith("NBI-2026-1142", USER_ID);
  });

  it("holds and takes down a chat with the case reference", async () => {
    const api = fakeApi();
    const user = userEvent.setup();
    render(<AdminApp api={api} />);
    await search(user);
    await user.click(screen.getByRole("tab", { name: /Chats/ }));
    await user.click(screen.getByRole("button", { name: `Hold ${CHAT_ID}` }));
    await user.click(screen.getByRole("button", { name: "Hold for 1 year" }));
    expect(api.hold).toHaveBeenCalledWith("NBI-2026-1142", { chatId: CHAT_ID }, expect.any(Number));
    await user.click(screen.getByRole("button", { name: `Take down ${CHAT_ID}` }));
    await user.click(screen.getByRole("button", { name: "Take down chat" }));
    expect(api.takedown).toHaveBeenCalledWith("NBI-2026-1142", CHAT_ID);
  });

  it("downloads the search as CSV and PDF through the export route", async () => {
    const api = fakeApi();
    const user = userEvent.setup();
    render(<AdminApp api={api} />);
    await search(user);
    await user.click(await screen.findByRole("button", { name: "Download CSV" }));
    await user.click(screen.getByRole("button", { name: "Export case file (PDF)" }));
    const calls = vi.mocked(api.exportFile).mock.calls;
    expect(calls.map(([caseRef, format]) => [caseRef, format])).toEqual([
      ["NBI-2026-1142", "csv"],
      ["NBI-2026-1142", "pdf"],
    ]);
    expect(calls[0]?.[2]).toMatchObject({ query: { nickname: "mika_24" } });
    expect(await screen.findAllByText(/ab12/)).not.toHaveLength(0);
  });

  it("downloads one saved chat as a PDF", async () => {
    const api = fakeApi();
    const user = userEvent.setup();
    render(<AdminApp api={api} />);
    await search(user);
    await user.click(screen.getByRole("tab", { name: /Saved messages/ }));
    await user.click(screen.getByRole("button", { name: `PDF of chat ${CHAT_ID}` }));
    expect(api.exportFile).toHaveBeenCalledWith("NBI-2026-1142", "pdf", { chatId: CHAT_ID });
  });

  it("offers the other parts of a chat too long for one file", async () => {
    const api = fakeApi({
      exportFile: vi.fn(() =>
        Promise.resolve({ blob: new Blob(["x"]), fileName: "a.pdf", sha256: "ab12", parts: 3 }),
      ),
    });
    const user = userEvent.setup();
    render(<AdminApp api={api} />);
    await search(user);
    await user.click(screen.getByRole("tab", { name: /Saved messages/ }));
    await user.click(screen.getByRole("button", { name: `PDF of chat ${CHAT_ID}` }));
    expect(await screen.findByText(/comes in 3 parts/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "PDF part 2 of 3" }));
    expect(api.exportFile).toHaveBeenLastCalledWith("NBI-2026-1142", "pdf", {
      chatId: CHAT_ID,
      part: 2,
    });
    expect(screen.getByRole("button", { name: "PDF part 3 of 3" })).toBeInTheDocument();
  });

  it("says when a search was cut short at the row cap", async () => {
    const api = fakeApi({ lookup: vi.fn(() => Promise.resolve({ ...RECORDS, truncated: true })) });
    const user = userEvent.setup();
    render(<AdminApp api={api} />);
    await search(user);
    expect(await screen.findByText(/Showing the first 5,000/)).toBeInTheDocument();
  });

  it("says when a search found no connections or chats", async () => {
    const empty = { connections: [], chats: [], content: [] };
    const api = fakeApi({ lookup: vi.fn(() => Promise.resolve(empty)) });
    const user = userEvent.setup();
    render(<AdminApp api={api} />);
    await search(user);
    expect(await screen.findByText("No connections for this search.")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Chats/ }));
    expect(screen.getByText("No chats for this search.")).toBeInTheDocument();
  });

  it("disables the export buttons while a file is being prepared", async () => {
    const api = fakeApi({ exportFile: vi.fn(() => new Promise<never>(() => undefined)) });
    const user = userEvent.setup();
    render(<AdminApp api={api} />);
    await search(user);
    await user.click(await screen.findByRole("button", { name: "Download CSV" }));
    expect(screen.getByRole("button", { name: "Download CSV" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export case file (PDF)" })).toBeDisabled();
    expect(screen.getByText("Preparing file…")).toBeInTheDocument();
    expect(api.exportFile).toHaveBeenCalledTimes(1);
  });

  it("keeps the confirm dialog open until the action finishes, then reports it and refreshes", async () => {
    let finish: (value: {
      deviceUntil: number;
      networkUntil: number;
      kicked: boolean;
    }) => void = () => undefined;
    const api = fakeApi({
      ban: vi.fn(
        () =>
          new Promise<{ deviceUntil: number; networkUntil: number; kicked: boolean }>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const user = userEvent.setup();
    render(<AdminApp api={api} />);
    await search(user);
    await user.click(await screen.findByRole("button", { name: `Ban ${USER_ID}` }));
    await user.click(screen.getByRole("button", { name: "Ban user" }));
    expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
    finish({ deviceUntil: Date.UTC(2026, 10, 19, 4), networkUntil: 1, kicked: true });
    expect(await screen.findByText(/Banned .* removed/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(api.lookup).toHaveBeenCalledTimes(2);
  });

  it("keeps the confirm dialog open when tapping outside it", async () => {
    const api = fakeApi();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<AdminApp api={api} />);
    await search(user);
    await user.click(await screen.findByRole("button", { name: `Ban ${USER_ID}` }));
    await user.click(document.body);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(api.ban).not.toHaveBeenCalled();
  });

  it("asks for a single day before sending a search without a nickname", async () => {
    const api = fakeApi();
    const user = userEvent.setup();
    render(<AdminApp api={api} />);
    await user.type(screen.getByLabelText("Case reference"), "NBI-1");
    await user.click(screen.getByRole("button", { name: "Search records" }));
    expect(
      screen.getByText("Without a nickname or user ID, pick one day (From and To the same)."),
    ).toBeInTheDocument();
    expect(api.lookup).not.toHaveBeenCalled();
  });

  it("keeps the search results when switching to another page and back", async () => {
    const api = fakeApi();
    const user = userEvent.setup();
    render(<AdminApp api={api} />);
    await search(user);
    expect(await screen.findByText("112.198.64.21")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Holds" }));
    expect(screen.getByText("112.198.64.21")).not.toBeVisible();
    await user.click(screen.getByRole("button", { name: "Case lookup" }));
    expect(screen.getByText("112.198.64.21")).toBeVisible();
    expect(api.lookup).toHaveBeenCalledTimes(1);
  });

  it("says when a hold matched no records", async () => {
    const api = fakeApi({ hold: vi.fn(() => Promise.resolve({ changed: 0 })) });
    const user = userEvent.setup();
    render(<AdminApp api={api} />);
    await search(user);
    await user.click(await screen.findByRole("button", { name: `Hold ${USER_ID}` }));
    await user.click(screen.getByRole("button", { name: "Hold for 1 year" }));
    expect(await screen.findByText(/Nothing was held/)).toBeInTheDocument();
  });

  it("shows a readable error from the server", async () => {
    const { AdminApiError } = await import("./adminApi");
    const api = fakeApi({
      lookup: vi.fn(() => Promise.reject(new AdminApiError(429, "rate_limited"))),
    });
    const user = userEvent.setup();
    render(<AdminApp api={api} />);
    await search(user);
    expect(await screen.findByText(/Too many requests/)).toBeInTheDocument();
  });
});

describe("session", () => {
  it("shows the sign-in message when the session has ended", async () => {
    const api = fakeApi({ lookup: vi.fn(() => Promise.reject(new SessionEndedError())) });
    const user = userEvent.setup();
    render(<AdminApp api={api} />);
    await search(user);
    expect(await screen.findByText("Your session ended. Sign in again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in again" })).toBeInTheDocument();
  });

  it("shows who is signed in", async () => {
    render(<AdminApp api={fakeApi()} />);
    expect(await screen.findByText("owner@example.com")).toBeInTheDocument();
  });
});

describe("other pages", () => {
  it("lists active holds", async () => {
    const api = fakeApi({
      holds: vi.fn(() =>
        Promise.resolve({
          holds: [
            {
              table: "connections" as const,
              targetKind: "user" as const,
              target: USER_ID,
              until: Date.UTC(2027, 10, 19),
              records: 2,
            },
          ],
        }),
      ),
    });
    const user = userEvent.setup();
    render(<AdminApp api={api} />);
    await user.click(screen.getByRole("button", { name: "Holds" }));
    expect(await screen.findByText(USER_ID)).toBeInTheDocument();
  });

  it("shows loading states while the Holds, Activity and Health pages fetch", async () => {
    const never = () => new Promise<never>(() => undefined);
    const api = fakeApi({ holds: vi.fn(never), audit: vi.fn(never), health: vi.fn(never) });
    const user = userEvent.setup();
    render(<AdminApp api={api} />);
    for (const page of ["Holds", "Activity log", "System health"]) {
      await user.click(screen.getByRole("button", { name: page }));
      expect(screen.getByText("Loading…")).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Check again" })).toBeDisabled();
  });

  it("says when the Holds list stops at its limit", async () => {
    const hold = (i: number) => ({
      table: "chats" as const,
      targetKind: "chat" as const,
      target: `chat-${String(i)}`,
      until: Date.UTC(2027, 10, 19),
      records: 1,
    });
    const holds = Array.from({ length: 500 }, (_, i) => hold(i));
    const api = fakeApi({ holds: vi.fn(() => Promise.resolve({ holds })) });
    const user = userEvent.setup();
    render(<AdminApp api={api} />);
    await user.click(screen.getByRole("button", { name: "Holds" }));
    expect(await screen.findByText(/Showing the first 500 holds/)).toBeInTheDocument();
  });

  it("labels the clean-up checkpoint without calling it yearly, since it runs daily", async () => {
    const checkpoint = {
      id: 3,
      at: Date.UTC(2026, 10, 19, 3),
      actor: "system",
      action: "checkpoint",
      caseRef: null,
      targetKind: null,
      targetHash: null,
      result: "ok",
      resultCount: 0,
      exportSha256: null,
      adminCountry: null,
    };
    const api = fakeApi({
      audit: vi.fn(() =>
        Promise.resolve({
          rows: [checkpoint],
          chain: { intact: true, checked: 1, brokenAt: null, complete: true },
        }),
      ),
    });
    const user = userEvent.setup();
    render(<AdminApp api={api} />);
    await user.click(screen.getByRole("button", { name: "Activity log" }));
    expect(await screen.findByText("Clean-up checkpoint")).toBeInTheDocument();
  });

  it("says when the activity log is empty", async () => {
    const api = fakeApi();
    const user = userEvent.setup();
    render(<AdminApp api={api} />);
    await user.click(screen.getByRole("button", { name: "Activity log" }));
    expect(await screen.findByText("No activity yet.")).toBeInTheDocument();
  });

  it("loads older activity once even when Show older is clicked twice", async () => {
    const row = (id: number) => ({
      id,
      at: Date.UTC(2026, 10, 19, 6),
      actor: "owner@example.com",
      action: "lookup",
      caseRef: "NBI-9",
      targetKind: "user",
      targetHash: "f".repeat(64),
      result: "ok",
      resultCount: 1,
      exportSha256: null,
      adminCountry: "PH",
    });
    const firstPage = Array.from({ length: 50 }, (_, i) => row(100 - i));
    let finishOlder: (page: { rows: ReturnType<typeof row>[]; chain: null }) => void = () =>
      undefined;
    const audit = vi
      .fn()
      .mockResolvedValueOnce({
        rows: firstPage,
        chain: { intact: true, checked: 50, brokenAt: null, complete: true },
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOlder = resolve;
          }),
      );
    const api = fakeApi({ audit });
    const user = userEvent.setup();
    render(<AdminApp api={api} />);
    await user.click(screen.getByRole("button", { name: "Activity log" }));
    const older = await screen.findByRole("button", { name: "Show older entries" });
    await user.click(older);
    expect(older).toBeDisabled();
    await user.click(older);
    expect(audit).toHaveBeenCalledTimes(2);
    finishOlder({ rows: [row(1)], chain: null });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Show older entries" })).toBeNull();
    });
  });

  it("says when only part of a very long activity log was checked", async () => {
    const api = fakeApi({
      audit: vi.fn(() =>
        Promise.resolve({
          rows: [],
          chain: { intact: true, checked: 50_000, brokenAt: null, complete: false },
        }),
      ),
    });
    const user = userEvent.setup();
    render(<AdminApp api={api} />);
    await user.click(screen.getByRole("button", { name: "Activity log" }));
    expect(await screen.findByText(/first 50,000 entries check out/)).toBeInTheDocument();
  });

  it("shows the activity log and whether its chain is intact", async () => {
    const api = fakeApi({
      audit: vi.fn(() =>
        Promise.resolve({
          rows: [
            {
              id: 7,
              at: Date.UTC(2026, 10, 19, 6),
              actor: "owner@example.com",
              action: "export",
              caseRef: "NBI-9",
              targetKind: "user",
              targetHash: "f".repeat(64),
              result: "ok",
              resultCount: 3,
              exportSha256: "e".repeat(64),
              adminCountry: "PH",
            },
          ],
          chain: { intact: false, checked: 1, brokenAt: 7, complete: true },
        }),
      ),
    });
    const user = userEvent.setup();
    render(<AdminApp api={api} />);
    await user.click(screen.getByRole("button", { name: "Activity log" }));
    expect(await screen.findByText("NBI-9")).toBeInTheDocument();
    expect(screen.getByText(/Chain broken at entry 7/)).toBeInTheDocument();
  });

  it("shows the runbook", async () => {
    const user = userEvent.setup();
    render(<AdminApp api={fakeApi()} />);
    await user.click(screen.getByRole("button", { name: "Runbook" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /runbook/i, level: 1 })).toBeInTheDocument();
    });
  });
});
