import { act, render, screen, waitFor, within } from "@testing-library/react";
import { useAppStore } from "@/app/store";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PublicUser } from "@shared/profile";
import * as api from "@/lib/api";
import { EntryScreen } from "./EntryScreen";

const turnstile = vi.hoisted(() => ({
  resets: 0,
  onExpire: (): void => undefined,
  onError: (): void => undefined,
}));

vi.mock("./TurnstileField", () => ({
  TurnstileField: ({
    onToken,
    onExpire,
    onError,
    resetKey,
  }: {
    onToken: (token: string) => void;
    onExpire: () => void;
    onError: () => void;
    resetKey: number;
  }) => {
    turnstile.onExpire = onExpire;
    turnstile.onError = onError;
    useEffect(() => {
      if (resetKey > 0) turnstile.resets += 1;
      onToken(`tok${resetKey > 0 ? String(resetKey) : ""}`);
    }, [onToken, resetKey]);
    return null;
  },
}));

const me: PublicUser = {
  userId: "u1",
  nickname: "mika_24",
  gender: "female",
  age: 24,
  country: "PH",
  bio: "",
};

beforeEach(() => {
  turnstile.resets = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderEntry(onEntered = vi.fn()) {
  render(<EntryScreen suggestedCountry="PH" onEntered={onEntered} />);
  return onEntered;
}

async function fillValidForm(user = userEvent.setup()) {
  await user.type(screen.getByLabelText("Nickname"), "mika_24");
  await user.click(screen.getByRole("radio", { name: "Female" }));
  await user.type(screen.getByLabelText("Age"), "24");
  await user.click(screen.getByRole("checkbox", { name: /18 or older/ }));
  return user;
}

it("pre-selects the suggested country", () => {
  renderEntry();
  expect(screen.getByLabelText("Country")).toHaveDisplayValue("Philippines");
});

it("shows the title and links to the Terms and Privacy Policy", () => {
  renderEntry();
  expect(screen.getByRole("heading", { name: "Meet someone new" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms/");
  expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy/");
});

it("explains what is missing instead of leaving Start chatting dead", async () => {
  const onEntered = renderEntry();
  const user = userEvent.setup();
  const submit = screen.getByRole("button", { name: "Start chatting" });
  expect(submit).toBeEnabled();
  await user.click(submit);
  expect(screen.getByLabelText("Nickname")).toHaveFocus();
  expect(screen.getByText("Choose a gender.")).toBeInTheDocument();
  expect(screen.getByText("Confirm you're 18 or older to continue.")).toBeInTheDocument();
  expect(onEntered).not.toHaveBeenCalled();
});

it("points at the 18+ box when it is the only thing missing", async () => {
  const onEntered = renderEntry();
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Nickname"), "mika_24");
  await user.click(screen.getByRole("radio", { name: "Female" }));
  await user.type(screen.getByLabelText("Age"), "24");
  await user.click(screen.getByRole("button", { name: "Start chatting" }));
  expect(screen.getByRole("checkbox", { name: /18 or older/ })).toHaveFocus();
  expect(onEntered).not.toHaveBeenCalled();
});

it("refuses an age under 18 and focuses it", async () => {
  const onEntered = renderEntry();
  const user = await fillValidForm();
  await user.clear(screen.getByLabelText("Age"));
  await user.type(screen.getByLabelText("Age"), "17");
  await user.click(screen.getByRole("button", { name: "Start chatting" }));
  expect(screen.getByLabelText("Age")).toHaveFocus();
  expect(onEntered).not.toHaveBeenCalled();
});

it("shows inline nickname errors from shared validation", async () => {
  renderEntry();
  const user = userEvent.setup();
  const nickname = screen.getByLabelText("Nickname");
  await user.type(nickname, "a b");
  await user.tab();
  expect(screen.getByText(/letters, numbers and _/)).toBeInTheDocument();
  expect(nickname).toHaveAttribute("aria-invalid", "true");
  expect(nickname).toHaveAccessibleDescription(/letters, numbers and _/);
});

it("asks for a different nickname when the shared filter rejects it", async () => {
  renderEntry();
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Nickname"), "fuck_you");
  await user.tab();
  expect(screen.getByText("Please choose a different nickname.")).toBeInTheDocument();
});

it("counts bio characters up to 150", async () => {
  renderEntry();
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/Bio/), "Hello");
  expect(screen.getByText("5/150")).toBeInTheDocument();
});

it("sends confirmedAdult and token, then calls onEntered", async () => {
  const enter = vi.spyOn(api, "enter").mockResolvedValue({ ok: true, me });
  const onEntered = renderEntry();
  const user = await fillValidForm();
  await user.type(screen.getByLabelText(/Bio/), "Coffee and books");
  await user.click(screen.getByRole("button", { name: "Start chatting" }));
  await waitFor(() => {
    expect(onEntered).toHaveBeenCalledWith(me);
  });
  expect(enter).toHaveBeenCalledWith({
    nickname: "mika_24",
    gender: "female",
    age: 24,
    country: "PH",
    bio: "Coffee and books",
    confirmedAdult: true,
    turnstileToken: "tok",
  });
});

it("maps nickname_taken to friendly copy and resets turnstile", async () => {
  const enter = vi
    .spyOn(api, "enter")
    .mockResolvedValueOnce({ ok: false, error: "nickname_taken" })
    .mockResolvedValueOnce({ ok: true, me });
  renderEntry();
  const user = await fillValidForm();
  await user.click(screen.getByRole("button", { name: "Start chatting" }));
  expect(
    await screen.findByText("That nickname is taken right now. Try another."),
  ).toBeInTheDocument();
  expect(turnstile.resets).toBe(1);
  expect(screen.getByLabelText("Nickname")).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Start chatting" }));
  await waitFor(() => {
    expect(enter).toHaveBeenLastCalledWith(expect.objectContaining({ turnstileToken: "tok1" }));
  });
});

it.each([
  ["bad_nickname", "Please choose a different nickname."],
  ["rate_limited", "Too many tries. Please wait a few minutes."],
  ["bot_check_failed", "We couldn't verify you're human. Please try again."],
  ["bad_origin", "Something went wrong. Please refresh and try again."],
  ["network", "Something went wrong. Please refresh and try again."],
])("maps %s to friendly copy", async (error, copy) => {
  vi.spyOn(api, "enter").mockResolvedValue({ ok: false, error });
  renderEntry();
  const user = await fillValidForm();
  await user.click(screen.getByRole("button", { name: "Start chatting" }));
  expect(await screen.findByText(copy)).toBeInTheDocument();
});

it("tells a banned visitor until when they are blocked", async () => {
  const until = Date.UTC(2030, 0, 1, 12);
  vi.spyOn(api, "enter").mockResolvedValue({ ok: false, error: "banned", until });
  renderEntry();
  const user = await fillValidForm();
  await user.click(screen.getByRole("button", { name: "Start chatting" }));
  const time = new Date(until).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  expect(await screen.findByText(`You're temporarily blocked until ${time}.`)).toBeInTheDocument();
});

it("shows a bio rejection next to the bio", async () => {
  vi.spyOn(api, "enter").mockResolvedValue({ ok: false, error: "bad_bio" });
  renderEntry();
  const user = await fillValidForm();
  await user.click(screen.getByRole("button", { name: "Start chatting" }));
  await waitFor(() => {
    expect(screen.getByLabelText(/Bio/)).toHaveAccessibleDescription(
      /links, contact details or rude words/,
    );
  });
});

it("explains a failed bot check instead of waiting forever", async () => {
  renderEntry();
  const user = await fillValidForm();
  act(() => {
    turnstile.onError();
  });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "We couldn't verify you're human. Please refresh and try again.",
  );
  expect(screen.getByRole("button", { name: "Start chatting" })).toBeDisabled();
  await user.type(screen.getByLabelText("Nickname"), "x");
  expect(screen.getByRole("alert")).toBeInTheDocument();
});

it("disables submit again when the bot check token expires", async () => {
  renderEntry();
  await fillValidForm();
  expect(screen.getByRole("button", { name: "Start chatting" })).toBeEnabled();
  act(() => {
    turnstile.onExpire();
  });
  expect(screen.getByRole("button", { name: "Start chatting" })).toBeDisabled();
  expect(screen.getByText("Checking your browser…")).toBeInTheDocument();
});

it("asks for a gender once the gender choice is left empty", async () => {
  renderEntry();
  const user = userEvent.setup();
  act(() => {
    screen.getByRole("radio", { name: "Male" }).focus();
  });
  await user.tab();
  expect(screen.getByText("Choose a gender.")).toBeInTheDocument();
});

it("rejects a bio with a link before sending it", async () => {
  const enter = vi.spyOn(api, "enter");
  renderEntry();
  const user = await fillValidForm();
  await user.type(screen.getByLabelText(/Bio/), "see www.example.com");
  await user.tab();
  expect(screen.getByLabelText(/Bio/)).toHaveAccessibleDescription(
    /links, contact details or rude words/,
  );
  await user.click(screen.getByRole("button", { name: "Start chatting" }));
  expect(screen.getByLabelText(/Bio/)).toHaveFocus();
  expect(enter).not.toHaveBeenCalled();
});

it("puts an invalid_profile answer next to its field", async () => {
  vi.spyOn(api, "enter").mockResolvedValue({ ok: false, error: "invalid_profile", field: "age" });
  renderEntry();
  const user = await fillValidForm();
  await user.click(screen.getByRole("button", { name: "Start chatting" }));
  await waitFor(() => {
    expect(screen.getByLabelText("Age")).toHaveAccessibleDescription("Please check this field.");
  });
  expect(screen.getByLabelText("Age")).toHaveFocus();
});

it("redirects to /unavailable/ when entry answers region_unavailable", async () => {
  const replace = vi.fn();
  vi.stubGlobal("location", { href: window.location.href, replace });
  vi.spyOn(api, "enter").mockResolvedValue({ ok: false, error: "region_unavailable" });
  renderEntry();
  const user = await fillValidForm();
  await user.click(screen.getByRole("button", { name: "Start chatting" }));
  await waitFor(() => {
    expect(replace).toHaveBeenCalledWith("/unavailable/");
  });
});

it("lists every country, since availability depends on where you are, not where you're from", () => {
  renderEntry();
  const country = screen.getByLabelText("Country");
  expect(within(country).getByRole("option", { name: "United Kingdom" })).toBeInTheDocument();
});

it("offers a way back to the home page", () => {
  renderEntry();
  expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
});

it("writes one-on-one with a heart, not a dashed 1-on-1", () => {
  renderEntry();
  expect(screen.queryByText(/1-on-1/)).not.toBeInTheDocument();
  expect(screen.getByText(/^Cosy/)).toHaveTextContent(
    /^Cosy 1 on 1 chats with new people\. No sign-up\.$/,
  );
});

it("shows the maintenance screen when entry answers maintenance", async () => {
  vi.spyOn(api, "enter").mockResolvedValue({ ok: false, error: "maintenance", message: "Soon" });
  renderEntry();
  const user = await fillValidForm();
  await user.click(screen.getByRole("button", { name: "Start chatting" }));
  await waitFor(() => {
    expect(useAppStore.getState().session.status).toBe("maintenance");
  });
  expect(useAppStore.getState().session).toMatchObject({
    status: "maintenance",
    maintenanceMessage: "Soon",
  });
});
