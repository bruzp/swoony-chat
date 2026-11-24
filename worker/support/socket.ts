import { LIMITS } from "@shared/config";
import { REPLACED_CLOSE_CODE } from "@shared/protocol/lobby";
import type { z } from "zod";

const encoder = new TextEncoder();

export function frameBytes(message: string | ArrayBuffer): number {
  if (typeof message !== "string") return message.byteLength;
  if (message.length > LIMITS.maxFrameBytes) return message.length;
  return encoder.encode(message).byteLength;
}

export function parseFrame<T>(message: string | ArrayBuffer, schema: z.ZodType<T>): T | null {
  if (typeof message !== "string") return null;
  let payload: unknown;
  try {
    payload = JSON.parse(message);
  } catch {
    return null;
  }
  const parsed = schema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export function isOpen(socket: WebSocket): boolean {
  return socket.readyState === WebSocket.OPEN;
}

export function closeQuietly(socket: WebSocket, code: number, reason: string): void {
  try {
    socket.close(code, reason);
  } catch {
    return;
  }
}

function openedAtOf(socket: WebSocket): number {
  const attachment = socket.deserializeAttachment() as { openedAt?: number } | null;
  return attachment?.openedAt ?? 0;
}

export function makeRoomForSocket(sockets: readonly WebSocket[]): void {
  const open = sockets.filter(isOpen).sort((a, b) => openedAtOf(a) - openedAtOf(b));
  const excess = open.length - LIMITS.socketsPerUser + 1;
  for (const socket of open.slice(0, Math.max(0, excess))) {
    closeQuietly(socket, REPLACED_CLOSE_CODE, "replaced");
  }
}
