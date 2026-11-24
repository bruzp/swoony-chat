import type { AppDeps } from "../deps";

export const ADMIN_PAGE_PATH = "/s-admin";
const NOT_FOUND_ASSET = "/__not_found__";

export function isAdminPagePath(pathname: string): boolean {
  return pathname === ADMIN_PAGE_PATH || pathname.startsWith(`${ADMIN_PAGE_PATH}/`);
}

export function notFoundPage(request: Request, env: Env): Promise<Response> {
  return env.ASSETS.fetch(new Request(new URL(NOT_FOUND_ASSET, request.url)));
}

export async function serveAdminPage(request: Request, env: Env, deps: AppDeps): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return notFoundPage(request, env);
  const email = deps.access ? await deps.access.verify(request) : null;
  if (!email) return notFoundPage(request, env);
  return env.ASSETS.fetch(request);
}
