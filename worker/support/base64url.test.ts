import { expect, it } from "vitest";
import { fromBase64Url, toBase64Url } from "./base64url";

it("round-trips large buffers without overflowing the call stack", () => {
  const bytes = new Uint8Array(1_000_000).map((_, i) => i % 256);
  const encoded = toBase64Url(bytes);
  expect(fromBase64Url(encoded)).toEqual(bytes);
});

it("writes URL-safe text without padding", () => {
  expect(toBase64Url(new Uint8Array([251, 255]))).toBe("-_8");
});
