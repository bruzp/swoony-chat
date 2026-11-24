import { describe, expect, it } from "vitest";
import { canonicalRecordsJson } from "./canonical";

describe("canonicalRecordsJson", () => {
  it("sorts keys and writes times in UTC", () => {
    const json = canonicalRecordsJson({
      connections: [],
      chats: [{ userB: "b", chatId: "c", userA: "a", startedAt: 0, endedAt: null }],
      content: [
        {
          chatId: "c",
          kind: "report_snapshot",
          reason: null,
          createdAt: 1_000,
          messages: [{ text: "hi", from: "a", sentAt: 500 }],
        },
      ],
    });
    expect(json).toBe(
      '{"chats":[{"chatId":"c","endedAt":null,"startedAt":"1970-01-01T00:00:00.000Z","userA":"a","userB":"b"}],' +
        '"connections":[],' +
        '"content":[{"chatId":"c","createdAt":"1970-01-01T00:00:01.000Z","kind":"report_snapshot",' +
        '"messages":[{"from":"a","sentAt":"1970-01-01T00:00:00.500Z","text":"hi"}],"reason":null}]}',
    );
  });

  it("fingerprints only the record lists, ignoring extra fields like truncated", () => {
    const records = { connections: [], chats: [], content: [] };
    expect(canonicalRecordsJson({ ...records, truncated: true } as typeof records)).toBe(
      canonicalRecordsJson(records),
    );
  });
});
