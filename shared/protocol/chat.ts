import { z } from "zod";
import type { ModerationRejection } from "../text/moderateText";

export const CHAT_ENDED_CLOSE_CODE = 4001;
export const CHAT_ID_PATTERN = /^[0-9a-f]{64}$/;
const CLIENT_ID_MAX = 64;

export interface ChatMessage {
  seq: number;
  from: string;
  text: string;
  sentAt: number;
}

export type ChatMessageForViewer = ChatMessage & { clientId?: string };

export type ChatRejection = ModerationRejection | "slow_down" | "spam";

export type ChatClientMessage =
  | { type: "send"; clientId: string; text: string }
  | { type: "resume"; afterSeq: number }
  | { type: "typing" }
  | { type: "seen"; seq: number };

export const chatClientMessageSchema: z.ZodType<ChatClientMessage> = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("send"),
    clientId: z.string().min(1).max(CLIENT_ID_MAX),
    text: z.string(),
  }),
  z.object({ type: z.literal("resume"), afterSeq: z.int().min(0) }),
  z.object({ type: z.literal("typing") }),
  z.object({ type: z.literal("seen"), seq: z.int().min(1) }),
]);

export type ChatServerMessage =
  | ({ type: "message" } & ChatMessageForViewer)
  | { type: "rejected"; clientId: string; reason: ChatRejection }
  | { type: "history"; messages: ChatMessageForViewer[]; peerSeen: number }
  | { type: "typing" }
  | { type: "seen"; seq: number }
  | { type: "ended" };
