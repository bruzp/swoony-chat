import { caseRefSchema, type WebAdminError } from "@shared/protocol/admin";
import type { AppDeps } from "../deps";
import { json } from "../http/json";

export interface WebAdminContext {
  request: Request;
  env: Env;
  deps: AppDeps;
  body: unknown;
  actor: string;
}

export type WebRoute = (context: WebAdminContext) => Promise<Response>;

export function fail(error: WebAdminError, status: number): Response {
  return json(error, status);
}

export function readCaseRef(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("caseRef" in body)) return null;
  const parsed = caseRefSchema.safeParse(body.caseRef);
  return parsed.success ? parsed.data : null;
}
