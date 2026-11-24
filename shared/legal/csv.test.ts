import { describe, expect, it } from "vitest";
import { chatsCsv, connectionsCsv, messagesCsv } from "./csv";

describe("connectionsCsv", () => {
  it("writes a header and one row per connection with ISO times", () => {
    const csv = connectionsCsv([
      {
        userId: "u1",
        nickname: "Mika",
        ip: "1.2.3.4",
        country: "PH",
        detectedCountry: null,
        joinedAt: 0,
        leftAt: null,
      },
    ]);
    expect(csv).toBe(
      "user_id,nickname,ip,country,detected_country,joined_at,left_at\r\n" +
        "u1,Mika,1.2.3.4,PH,,1970-01-01T00:00:00.000Z,\r\n",
    );
  });

  it("quotes fields with commas, quotes or formula characters", () => {
    const csv = connectionsCsv([
      {
        userId: 'a,"b"',
        nickname: "=cmd",
        ip: "::1",
        country: "PH",
        detectedCountry: "PH",
        joinedAt: 0,
        leftAt: 1_000,
      },
    ]);
    expect(csv.split("\r\n")[1]).toBe(
      '"a,""b""",\'=cmd,::1,PH,PH,1970-01-01T00:00:00.000Z,1970-01-01T00:00:01.000Z',
    );
  });
});

describe("chatsCsv", () => {
  it("writes one row per chat", () => {
    const csv = chatsCsv([{ chatId: "c1", userA: "a", userB: "b", startedAt: 0, endedAt: null }]);
    expect(csv).toBe(
      "chat_id,user_a,user_b,started_at,ended_at\r\nc1,a,b,1970-01-01T00:00:00.000Z,\r\n",
    );
  });
});

describe("messagesCsv", () => {
  it("writes one row per saved message with its snapshot details", () => {
    const csv = messagesCsv([
      {
        chatId: "c1",
        kind: "report_snapshot",
        reason: "spam",
        createdAt: 2_000,
        messages: [{ from: "a", text: '+hi, "you"\nbye 😀', sentAt: 1_000 }],
      },
    ]);
    expect(csv).toBe(
      "chat_id,snapshot_kind,report_reason,saved_at,from_user_id,sent_at,text\r\n" +
        'c1,report_snapshot,spam,1970-01-01T00:00:02.000Z,a,1970-01-01T00:00:01.000Z,"\'+hi, ""you""\nbye 😀"\r\n',
    );
  });
});
