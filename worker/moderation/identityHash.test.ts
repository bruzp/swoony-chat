import { expect, it } from "vitest";
import { IdentityHasher } from "./identityHash";

const SECRET = "x".repeat(32);

it("IdentityHasher is deterministic and keyed", async () => {
  const a = new IdentityHasher(SECRET);
  const b = new IdentityHasher("z".repeat(32));
  expect(await a.hash("1.2.3.4")).toBe(await a.hash("1.2.3.4"));
  expect(await a.hash("1.2.3.4")).not.toBe(await b.hash("1.2.3.4"));
  expect(await a.hash("1.2.3.4")).toMatch(/^[0-9a-f]{64}$/);
});

it("IdentityHasher rejects short secrets", () => {
  expect(() => new IdentityHasher("short")).toThrow();
});
