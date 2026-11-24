import { vi } from "vitest";

export function pretendTouchScreen(): void {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) =>
    Object.assign(new EventTarget(), {
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
    }),
  );
}
