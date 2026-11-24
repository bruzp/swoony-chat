import { describe, expect, it } from "vitest";
import { lobbyClientMessageSchema } from "./lobby";

function listWithCursor(cursor: string) {
  return lobbyClientMessageSchema.safeParse({ type: "list", requestId: "r", filter: {}, cursor });
}

describe("list cursor", () => {
  it.each(["0:1700000000000:user-1", "1:5:abc", "1700000000000:user-1"])("accepts %s", (cursor) => {
    expect(listWithCursor(cursor).success).toBe(true);
  });

  it.each([
    "2:5:abc",
    "0:abc:def",
    "0:1:2:3",
    "x:5:abc",
    ":5:abc",
    "0:5:",
    "0:12345678901234567:abc",
    `0:5:${"a".repeat(65)}`,
    "0:5:a b",
    "garbage",
  ])("rejects %s", (cursor) => {
    expect(listWithCursor(cursor).success).toBe(false);
  });
});
