import type { ChatRecord, ConnectionRecord, ContentRecord } from "./records";

const CONNECTION_HEADER = [
  "user_id",
  "nickname",
  "ip",
  "country",
  "detected_country",
  "joined_at",
  "left_at",
];
const CHAT_HEADER = ["chat_id", "user_a", "user_b", "started_at", "ended_at"];
const MESSAGE_HEADER = [
  "chat_id",
  "snapshot_kind",
  "report_reason",
  "saved_at",
  "from_user_id",
  "sent_at",
  "text",
];
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

function cell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function isoTime(at: number | null): string {
  return at === null ? "" : new Date(at).toISOString();
}

function toCsv(header: readonly string[], rows: readonly string[][]): string {
  return [header, ...rows.map((row) => row.map(cell))]
    .map((row) => `${row.join(",")}\r\n`)
    .join("");
}

export function connectionsCsv(connections: readonly ConnectionRecord[]): string {
  return toCsv(
    CONNECTION_HEADER,
    connections.map((connection) => [
      connection.userId,
      connection.nickname,
      connection.ip,
      connection.country,
      connection.detectedCountry ?? "",
      isoTime(connection.joinedAt),
      isoTime(connection.leftAt),
    ]),
  );
}

export function chatsCsv(chats: readonly ChatRecord[]): string {
  return toCsv(
    CHAT_HEADER,
    chats.map((chat) => [
      chat.chatId,
      chat.userA,
      chat.userB,
      isoTime(chat.startedAt),
      isoTime(chat.endedAt),
    ]),
  );
}

export function messagesCsv(content: readonly ContentRecord[]): string {
  return toCsv(
    MESSAGE_HEADER,
    content.flatMap((entry) =>
      entry.messages.map((message) => [
        entry.chatId,
        entry.kind,
        entry.reason ?? "",
        isoTime(entry.createdAt),
        message.from,
        isoTime(message.sentAt),
        message.text,
      ]),
    ),
  );
}
