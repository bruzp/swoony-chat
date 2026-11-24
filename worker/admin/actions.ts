import { LIMITS } from "@shared/config";
import { CHAT_ID_PATTERN } from "@shared/protocol/chat";
import { z } from "zod";
import type { AppDeps } from "../deps";
import { networkKey } from "../http/requestInfo";
import { lobbyStub } from "../lobby/lobbyStub";

const USER_ID_MAX = 64;
const timestamp = z.int().min(0);
const userId = z.string().min(1).max(USER_ID_MAX);
export const chatIdSchema = z.string().regex(CHAT_ID_PATTERN);

export const lookupSchema = z
  .object({
    nickname: z.string().min(1).max(LIMITS.nickname.max).exactOptional(),
    userId: userId.exactOptional(),
    from: timestamp,
    to: timestamp,
  })
  .refine(
    (query) =>
      query.nickname !== undefined ||
      query.userId !== undefined ||
      query.to - query.from <= LIMITS.adminUnfilteredLookupMaxMs,
  );
const banSchema = z.object({ userId });
const takedownSchema = z.object({ chatId: chatIdSchema });
const holdSchema = z
  .object({
    userId: userId.exactOptional(),
    chatId: chatIdSchema.exactOptional(),
    until: timestamp,
  })
  .refine((hold) => hold.userId !== undefined || hold.chatId !== undefined);

export type TargetKind = "user" | "chat" | "nickname" | "window" | "site";

export interface ActionTarget {
  kind: TargetKind;
  value: string | null;
}

export interface ActionResult {
  status: number;
  body: unknown;
  target: ActionTarget;
  count?: number;
}

export interface ActionContext {
  env: Env;
  deps: AppDeps;
  body: unknown;
}

export type AdminAction = (context: ActionContext) => Promise<ActionResult | null>;

export function lookupTarget(query: { nickname?: string; userId?: string }): ActionTarget {
  if (query.userId !== undefined) return { kind: "user", value: query.userId };
  if (query.nickname !== undefined)
    return { kind: "nickname", value: query.nickname.toLowerCase() };
  return { kind: "window", value: null };
}

const lookup: AdminAction = async ({ deps, body }) => {
  const query = lookupSchema.safeParse(body);
  if (!query.success) return null;
  const records = await deps.retention.lookup(query.data);
  const count = records.connections.length + records.chats.length + records.content.length;
  return { status: 200, body: records, target: lookupTarget(query.data), count };
};

const ban: AdminAction = async ({ env, deps, body }) => {
  const request = banSchema.safeParse(body);
  if (!request.success) return null;
  const target: ActionTarget = { kind: "user", value: request.data.userId };
  const connection = await deps.retention.latestConnection(request.data.userId);
  if (!connection) return { status: 404, body: { error: "no_record" }, target };
  const networkHash = await deps.hasher.hash(networkKey(connection.ip));
  const longestBan = LIMITS.deviceBanLadderMs.length - 1;
  const until = await deps.bans.issueBan(connection.deviceHash, networkHash, longestBan);
  const kicked = await lobbyStub(env).adminRemove(request.data.userId);
  return { status: 200, body: { ...until, kicked }, target };
};

const takedown: AdminAction = async ({ env, deps, body }) => {
  const request = takedownSchema.safeParse(body);
  if (!request.success) return null;
  const chatId = request.data.chatId;
  const room = env.CHAT_ROOM.getByName(chatId);
  const evidence = await room.snapshot();
  if (evidence.length > 0) await deps.retention.snapshotTakedown(chatId, evidence);
  await room.takedown();
  await lobbyStub(env).chatClosed(chatId);
  const { deleted, held } = await deps.retention.deleteContent(chatId, deps.now());
  const counts = { evidenceSaved: evidence.length, contentDeleted: deleted, contentHeld: held };
  return { status: 200, body: counts, target: { kind: "chat", value: chatId } };
};

const hold: AdminAction = async ({ deps, body }) => {
  const request = holdSchema.safeParse(body);
  if (!request.success) return null;
  const { until, ...target } = request.data;
  const changed = await deps.retention.setHold(target, until);
  const actionTarget: ActionTarget =
    target.userId !== undefined
      ? { kind: "user", value: target.userId }
      : { kind: "chat", value: target.chatId ?? null };
  return { status: 200, body: { changed }, target: actionTarget, count: changed };
};

export const recordActions: Readonly<Record<string, AdminAction>> = { lookup, ban, takedown, hold };

export function findAction(
  actions: Readonly<Record<string, AdminAction>>,
  name: string,
): AdminAction | null {
  return Object.hasOwn(actions, name) ? (actions[name] ?? null) : null;
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
