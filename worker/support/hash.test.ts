import { expect, it } from "vitest";
import { sha256Hex } from "./hash";

it("sha256Hex matches the known digest", async () => {
  expect(await sha256Hex("abc")).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
