import { isCleanNickname } from "@shared/text/profanity";
import { afterEach, expect, it, vi } from "vitest";
import { uniqueName } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

it("uniqueName skips random names that the nickname filter would reject", () => {
  const draws = [
    [0xb0, 0x0b, 0x46],
    [0x12, 0x34, 0x56],
  ];
  vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
    if (array instanceof Uint8Array) array.set(draws.shift() ?? [0, 0, 0]);
    return array;
  });
  expect(isCleanNickname("ub00b46")).toBe(false);
  expect(uniqueName()).toBe("u123456");
});
