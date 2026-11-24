import type { PublicUser } from "@shared/profile";
import type { EnterRequest, SessionBootstrap } from "@shared/protocol/api";

const SESSION_PATH = "/api/session";

export type EnterResult =
  | { ok: true; me: PublicUser }
  | { ok: false; error: string; field?: string; until?: number; message?: string };

export class MaintenanceError extends Error {
  readonly notice: string;

  constructor(notice: string) {
    super("Swoony is in maintenance");
    this.name = "MaintenanceError";
    this.notice = notice;
  }
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`Request failed: ${String(status)} ${code}`);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

interface ErrorBody {
  error: string;
  field?: unknown;
  until?: unknown;
  message?: unknown;
}

function isErrorBody(body: unknown): body is ErrorBody {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { error?: unknown }).error === "string"
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function fetchSession(): Promise<SessionBootstrap> {
  const response = await fetch(SESSION_PATH, { credentials: "same-origin" });
  const body = await readJson(response);
  if (!response.ok) {
    if (isErrorBody(body) && body.error === "maintenance") {
      throw new MaintenanceError(typeof body.message === "string" ? body.message : "");
    }
    throw new ApiRequestError(response.status, isErrorBody(body) ? body.error : "server");
  }
  return body as SessionBootstrap;
}

export async function enter(request: EnterRequest): Promise<EnterResult> {
  let response: Response;
  try {
    response = await fetch(SESSION_PATH, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch {
    return { ok: false, error: "network" };
  }
  const body = await readJson(response);
  if (response.ok && typeof body === "object" && body !== null && "me" in body) {
    return { ok: true, me: (body as { me: PublicUser }).me };
  }
  if (!isErrorBody(body)) return { ok: false, error: "server" };
  return {
    ok: false,
    error: body.error,
    ...(typeof body.field === "string" ? { field: body.field } : {}),
    ...(typeof body.until === "number" ? { until: body.until } : {}),
    ...(typeof body.message === "string" ? { message: body.message } : {}),
  };
}

export function socketUrl(path: string): string {
  const url = new URL(path, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
