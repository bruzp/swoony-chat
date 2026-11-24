import type { LegalQuery, LegalRecords } from "@shared/legal/records";
import {
  EXPORT_PARTS_HEADER,
  EXPORT_SHA256_HEADER,
  type ActiveHold,
  type AuditPage,
  type ExportFormat,
  type MaintenanceState,
  type SystemHealth,
} from "@shared/protocol/admin";

const API_PREFIX = "/api/s-admin/";
const FILE_NAME_PATTERN = /filename="([^"]+)"/;

export class SessionEndedError extends Error {
  constructor() {
    super("Admin session ended");
    this.name = "SessionEndedError";
  }
}

export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`Admin request failed: ${String(status)} ${code}`);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
  }
}

const HIDDEN_NOT_FOUND = "not_found";

function isSignInRedirect(response: Response): boolean {
  return (
    response.type === "opaqueredirect" ||
    response.status === 0 ||
    response.status === 401 ||
    (response.status >= 300 && response.status < 400)
  );
}

async function errorCode(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "error" in body) return String(body.error);
  } catch {
    return "server";
  }
  return "server";
}

async function post(path: string, body: unknown): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}${path}`, {
      method: "POST",
      credentials: "same-origin",
      redirect: "manual",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AdminApiError(0, "network");
  }
  if (isSignInRedirect(response)) throw new SessionEndedError();
  if (response.ok) return response;
  const code = await errorCode(response);
  if (response.status === 404 && code === HIDDEN_NOT_FOUND) throw new SessionEndedError();
  throw new AdminApiError(response.status, code);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await post(path, body);
  return (await response.json()) as T;
}

export interface BanResult {
  deviceUntil: number;
  networkUntil: number;
  kicked: boolean;
}

export interface TakedownResult {
  evidenceSaved: number;
  contentDeleted: number;
  contentHeld: number;
}

export type HoldTarget = { userId: string } | { chatId: string };
export type ExportScope = { query: LegalQuery } | { chatId: string; part?: number };

export interface DownloadedFile {
  blob: Blob;
  fileName: string;
  sha256: string;
  parts: number;
}

export const adminApi = {
  whoami: () => postJson<{ email: string }>("whoami", {}),
  lookup: (caseRef: string, query: LegalQuery) =>
    postJson<LegalRecords & { truncated?: boolean }>("lookup", { caseRef, ...query }),
  ban: (caseRef: string, userId: string) => postJson<BanResult>("ban", { caseRef, userId }),
  takedown: (caseRef: string, chatId: string) =>
    postJson<TakedownResult>("takedown", { caseRef, chatId }),
  hold: (caseRef: string, target: HoldTarget, until: number) =>
    postJson<{ changed: number }>("hold", { caseRef, ...target, until }),
  holds: () => postJson<{ holds: ActiveHold[] }>("holds", {}),
  audit: (before?: number) => postJson<AuditPage>("audit", before === undefined ? {} : { before }),
  health: () => postJson<SystemHealth>("health", {}),
  maintenance: () => postJson<MaintenanceState>("maintenance", {}),
  setMaintenance: (on: boolean, message: string) =>
    postJson<MaintenanceState>("maintenance", { set: { on, message } }),
  exportFile: async (
    caseRef: string,
    format: ExportFormat,
    scope: ExportScope,
  ): Promise<DownloadedFile> => {
    const response = await post("export", { caseRef, format, scope });
    const disposition = response.headers.get("Content-Disposition") ?? "";
    const fileName = FILE_NAME_PATTERN.exec(disposition)?.[1] ?? `swoony-export.${format}`;
    return {
      blob: await response.blob(),
      fileName,
      sha256: response.headers.get(EXPORT_SHA256_HEADER) ?? "",
      parts: Number(response.headers.get(EXPORT_PARTS_HEADER) ?? "1") || 1,
    };
  },
};

export type AdminApi = typeof adminApi;
