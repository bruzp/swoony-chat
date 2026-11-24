import { z } from "zod";
import { REPORT_REASONS, type ReportReason } from "../config";
import { userFilterSchema, type PublicUser, type UserFilter } from "../profile";
import type { ModerationRejection } from "../text/moderateText";

export interface OpenChat {
  chatId: string;
  peer: PublicUser;
}

export type NoticeCode = "slow_down";
export type LobbyErrorCode = "bad_message" | "user_unavailable" | "slow_down";
export type KickReason = "idle" | "abuse" | "banned" | "maintenance";
export const KICKED_CLOSE_CODE = 4000;
export const LEFT_CLOSE_CODE = 4002;
export const REPLACED_CLOSE_CODE = 4003;

export const LIST_CURSOR_PATTERN = /^(?:[01]:)?\d{1,16}:[A-Za-z0-9-]{1,64}$/;
const REQUEST_ID_MAX = 64;
const USER_ID_MAX = 64;

export type LobbyClientMessage =
  | { type: "list"; requestId: string; filter: UserFilter; cursor?: string }
  | { type: "setBio"; bio: string }
  | { type: "leave" }
  | { type: "openChat"; userId: string }
  | { type: "block"; userId: string }
  | { type: "report"; userId: string; reason: ReportReason };

export const lobbyClientMessageSchema: z.ZodType<LobbyClientMessage> = z.discriminatedUnion(
  "type",
  [
    z.object({
      type: z.literal("list"),
      requestId: z.string().min(1).max(REQUEST_ID_MAX),
      filter: userFilterSchema,
      cursor: z.string().regex(LIST_CURSOR_PATTERN).exactOptional(),
    }),
    z.object({ type: z.literal("setBio"), bio: z.string() }),
    z.object({ type: z.literal("leave") }),
    z.object({ type: z.literal("openChat"), userId: z.string().min(1).max(USER_ID_MAX) }),
    z.object({ type: z.literal("block"), userId: z.string().min(1).max(USER_ID_MAX) }),
    z.object({
      type: z.literal("report"),
      userId: z.string().min(1).max(USER_ID_MAX),
      reason: z.enum(REPORT_REASONS),
    }),
  ],
);

export type LobbyServerMessage =
  | { type: "hello"; me: PublicUser; online: number; chats: OpenChat[] }
  | { type: "notice"; code: NoticeCode }
  | { type: "error"; code: LobbyErrorCode }
  | {
      type: "page";
      requestId: string;
      users: PublicUser[];
      nextCursor: string | null;
      online: number;
    }
  | {
      type: "presence";
      joined: PublicUser[];
      left: string[];
      updated: PublicUser[];
      online: number;
    }
  | { type: "bioRejected"; reason: ModerationRejection }
  | { type: "kicked"; reason: KickReason }
  | ({ type: "chatOpened" } & OpenChat)
  | { type: "incomingChat"; chatId: string; from: PublicUser }
  | { type: "chatEnded"; chatId: string }
  | { type: "blocked"; userId: string }
  | { type: "reported"; userId: string };
