import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useUnreadTitle } from "./useUnreadTitle";

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  setHidden(false);
  document.title = "Swoony";
});

it("unread title only when hidden", () => {
  document.title = "Swoony";
  const { rerender } = renderHook(
    ({ count }) => {
      useUnreadTitle(count);
    },
    { initialProps: { count: 2 } },
  );
  expect(document.title).toBe("Swoony");
  act(() => {
    setHidden(true);
  });
  expect(document.title).toBe("(2) Swoony");
  rerender({ count: 3 });
  expect(document.title).toBe("(3) Swoony");
  act(() => {
    setHidden(false);
  });
  expect(document.title).toBe("Swoony");
});

it("shows the plain title when nothing is unread", () => {
  setHidden(true);
  renderHook(() => {
    useUnreadTitle(0);
  });
  expect(document.title).toBe("Swoony");
});
