import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useBackToList } from "./useBackToList";

function chatIdProps(id: string | null): { id: string | null } {
  return { id };
}

beforeEach(() => {
  history.replaceState(null, "");
});

it("back button closes the chat instead of leaving", () => {
  const close = vi.fn();
  const before = history.length;
  renderHook(() => {
    useBackToList("c1", close);
  });
  expect(history.length).toBe(before + 1);
  act(() => {
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
  });
  expect(close).toHaveBeenCalledOnce();
});

it("switching chats replaces the entry instead of stacking more", () => {
  const close = vi.fn();
  const before = history.length;
  const { rerender } = renderHook(
    ({ id }) => {
      useBackToList(id, close);
    },
    { initialProps: chatIdProps("c1") },
  );
  rerender({ id: "c2" });
  expect(history.length).toBe(before + 1);
  expect(close).not.toHaveBeenCalled();
});

it("closing from the app steps back over its own entry", () => {
  const back = vi.spyOn(history, "back").mockImplementation(() => undefined);
  const close = vi.fn();
  const { rerender } = renderHook(
    ({ id }) => {
      useBackToList(id, close);
    },
    { initialProps: chatIdProps("c1") },
  );
  rerender({ id: null });
  expect(back).toHaveBeenCalledOnce();
  back.mockRestore();
});

it("reuses the entry left from before a reload when the chat is restored", () => {
  history.replaceState({ swoonyChat: "c1" }, "");
  const close = vi.fn();
  const before = history.length;
  const { rerender } = renderHook(
    ({ id }) => {
      useBackToList(id, close);
    },
    { initialProps: chatIdProps(null) },
  );
  rerender({ id: "c1" });
  expect(history.length).toBe(before);
  expect(history.state).toEqual({ swoonyChat: "c1" });
});

it("does not step back on load over an entry left from before a reload", () => {
  history.replaceState({ swoonyChat: "c1" }, "");
  const back = vi.spyOn(history, "back").mockImplementation(() => undefined);
  renderHook(() => {
    useBackToList(null, vi.fn());
  });
  expect(back).not.toHaveBeenCalled();
  back.mockRestore();
});
