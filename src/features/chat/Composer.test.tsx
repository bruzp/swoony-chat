import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { pretendTouchScreen } from "@/test/touchScreen";
import { Composer } from "./Composer";

function renderComposer(disabled = false) {
  const onSend = vi.fn(() => true);
  render(<Composer onSend={onSend} disabled={disabled} />);
  return { onSend, box: screen.getByRole("textbox", { name: "Message" }) };
}

it("Enter sends and Shift+Enter adds a newline", async () => {
  const { onSend, box } = renderComposer();
  const user = userEvent.setup();
  await user.type(box, "hello{Shift>}{Enter}{/Shift}there");
  expect(box).toHaveValue("hello\nthere");
  await user.keyboard("{Enter}");
  expect(onSend).toHaveBeenCalledWith("hello\nthere");
  expect(box).toHaveValue("");
});

it("the Send button sends the trimmed text", async () => {
  const { onSend, box } = renderComposer();
  const user = userEvent.setup();
  await user.type(box, "  hi  ");
  await user.click(screen.getByRole("button", { name: "Send" }));
  expect(onSend).toHaveBeenCalledWith("hi");
});

it("does not send an empty message", async () => {
  const { onSend } = renderComposer();
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(onSend).not.toHaveBeenCalled();
});

it.each([
  ["see www.example.com", "Links aren't allowed in chats."],
  ["call me 0917 123 4567", "For your safety, sharing contact details isn't allowed."],
  ["fuck off", "Let's keep it friendly."],
])("Composer blocks %s client-side with friendly copy", async (text, copy) => {
  const { onSend, box } = renderComposer();
  const user = userEvent.setup();
  await user.type(box, text);
  await user.keyboard("{Enter}");
  expect(onSend).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent(copy);
  expect(box).toHaveValue(text);
  expect(box).toHaveAccessibleDescription(copy);
  await user.type(box, "!");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("clears the box even when the socket is down, since the failed bubble keeps the text", async () => {
  const onSend = vi.fn(() => false);
  render(<Composer onSend={onSend} disabled={false} />);
  const box = screen.getByRole("textbox", { name: "Message" });
  const user = userEvent.setup();
  await user.type(box, "hi{Enter}");
  expect(box).toHaveValue("");
});

it("is disabled when the chat cannot take messages", () => {
  const { box } = renderComposer(true);
  expect(box).toBeDisabled();
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
});

it("opens an emoji picker", async () => {
  renderComposer();
  await userEvent.click(screen.getByRole("button", { name: "Add emoji" }));
  expect(await screen.findByRole("dialog", { name: "Emoji" })).toBeInTheDocument();
});

it("keeps the phone keyboard closed when the emoji picker opens on a touch screen", async () => {
  pretendTouchScreen();
  renderComposer();
  await userEvent.click(screen.getByRole("button", { name: "Add emoji" }));
  const picker = await screen.findByRole("dialog", { name: "Emoji" });
  expect(picker.contains(document.activeElement) && document.activeElement?.tagName).not.toBe(
    "INPUT",
  );
  vi.restoreAllMocks();
});

it("uses fewer, larger emoji per row on touch screens so each one is easy to tap", async () => {
  pretendTouchScreen();
  renderComposer();
  await userEvent.click(screen.getByRole("button", { name: "Add emoji" }));
  const picker = await screen.findByRole("dialog", { name: "Emoji" });
  expect(within(picker).getByRole("grid")).toHaveAttribute("aria-colcount", "8");
  vi.restoreAllMocks();
});

it("labels the phone keyboard's action key as a new line, since Enter adds one on touch screens", () => {
  pretendTouchScreen();
  const { box } = renderComposer();
  expect(box).toHaveAttribute("enterkeyhint", "enter");
  vi.restoreAllMocks();
});

it("labels the action key Send on devices where Enter sends", () => {
  const { box } = renderComposer();
  expect(box).toHaveAttribute("enterkeyhint", "send");
});

it("reports typing while there is text, not when the box is cleared", async () => {
  const onTyping = vi.fn();
  render(<Composer onSend={vi.fn()} onTyping={onTyping} disabled={false} />);
  const box = screen.getByRole("textbox", { name: "Message" });
  const user = userEvent.setup();
  await user.type(box, "hi");
  expect(onTyping).toHaveBeenCalledTimes(2);
  await user.clear(box);
  expect(onTyping).toHaveBeenCalledTimes(2);
});
