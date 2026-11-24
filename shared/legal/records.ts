import type { ReportReason } from "../config";

export interface RetainedMessage {
  from: string;
  text: string;
  sentAt: number;
}

export type ContentKind = "report_snapshot" | "all_content" | "takedown_snapshot";

export interface ConnectionRecord {
  userId: string;
  nickname: string;
  ip: string;
  country: string;
  detectedCountry: string | null;
  joinedAt: number;
  leftAt: number | null;
}

export interface ChatRecord {
  chatId: string;
  userA: string;
  userB: string;
  startedAt: number;
  endedAt: number | null;
}

export interface ContentRecord {
  chatId: string;
  kind: ContentKind;
  reason: ReportReason | null;
  messages: RetainedMessage[];
  createdAt: number;
}

export interface LegalRecords {
  connections: ConnectionRecord[];
  chats: ChatRecord[];
  content: ContentRecord[];
}

export interface LegalQuery {
  nickname?: string;
  userId?: string;
  from: number;
  to: number;
}

export function messageCount(records: LegalRecords): number {
  return records.content.reduce((total, entry) => total + entry.messages.length, 0);
}
