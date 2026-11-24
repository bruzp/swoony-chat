import { z } from "zod";

export const CASE_REF_PATTERN = /^[A-Za-z0-9/-]{3,40}$/;
export const caseRefSchema = z.string().regex(CASE_REF_PATTERN);

export function caseRefForFileName(caseRef: string): string {
  return caseRef.replaceAll("/", "-");
}

export type HoldTargetKind = "user" | "chat";
export type HoldTable = "connections" | "chats" | "content";

export interface ActiveHold {
  table: HoldTable;
  targetKind: HoldTargetKind;
  target: string;
  until: number;
  records: number;
}

export type WebAdminError =
  | { error: "invalid_request" }
  | { error: "invalid_case_ref" }
  | { error: "no_record" }
  | { error: "bad_origin" }
  | { error: "unsupported_media_type" }
  | { error: "method_not_allowed" }
  | { error: "rate_limited" }
  | { error: "export_too_large" }
  | { error: "not_found" };

export interface AuditRow {
  id: number;
  at: number;
  actor: string;
  action: string;
  caseRef: string | null;
  targetKind: string | null;
  targetHash: string | null;
  result: string;
  resultCount: number | null;
  exportSha256: string | null;
  adminCountry: string | null;
}

export interface AuditChainStatus {
  intact: boolean;
  checked: number;
  brokenAt: number | null;
  complete: boolean;
}

export interface AuditPage {
  rows: AuditRow[];
  chain: AuditChainStatus | null;
}

export type ExportFormat = "csv" | "pdf";
export const EXPORT_SHA256_HEADER = "X-Export-Sha256";
export const EXPORT_PARTS_HEADER = "X-Export-Parts";

export type HealthComponentName = "site" | "database" | "banStore" | "lobby";

export interface ComponentHealth {
  name: HealthComponentName;
  ok: boolean;
  ms: number;
}

export interface JobRun {
  id: number;
  job: string;
  startedAt: number;
  finishedAt: number | null;
  ok: boolean;
  deletedCounts: Record<string, number> | null;
  errorCode: string | null;
}

export interface SystemHealth {
  components: ComponentHealth[];
  online: number | null;
  maintenance: boolean;
  cleanupStale: boolean;
  lastRuns: JobRun[];
}

export const MAINTENANCE_MESSAGE_MAX = 200;

export interface MaintenanceState {
  on: boolean;
  message: string;
  startedAt: number | null;
  startedBy: string | null;
}

export type PublicHealthStatus = "ok" | "maintenance" | "down";
