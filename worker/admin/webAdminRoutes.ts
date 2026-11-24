import { MAINTENANCE_MESSAGE_MAX, type AuditPage } from "@shared/protocol/admin";
import { z } from "zod";
import type { AppDeps } from "../deps";
import { json } from "../http/json";
import { clientIp, isSameOrigin, networkKey } from "../http/requestInfo";
import { lobbyStub } from "../lobby/lobbyStub";
import { findAction, readJsonBody, recordActions, type ActionResult } from "./actions";
import { recordAction } from "./auditRecorder";
import { systemHealth } from "../health/healthChecks";
import { exportRoute } from "./export/exportRoute";
import { fail, readCaseRef, type WebRoute } from "./webRoute";

export const WEB_ADMIN_PATH_PREFIX = "/api/s-admin/";
const JSON_CONTENT_TYPE = "application/json";

function respond(result: ActionResult | null): Response {
  if (!result) return fail({ error: "invalid_request" }, 400);
  return json(result.body, result.status);
}

function caseRoute(name: string): WebRoute {
  const action = findAction(recordActions, name);
  if (!action) throw new Error(`unknown admin action ${name}`);
  return async (context) => {
    const caseRef = readCaseRef(context.body);
    if (caseRef === null) return fail({ error: "invalid_case_ref" }, 400);
    const result = await action(context);
    if (result) {
      await recordAction(context.deps, context.request, {
        actor: context.actor,
        action: name,
        caseRef,
        result,
      });
    }
    return respond(result);
  };
}

const auditPageSchema = z.object({ before: z.int().min(1).exactOptional() });

const audit: WebRoute = async ({ deps, body }) => {
  const page = auditPageSchema.safeParse(body);
  if (!page.success) return fail({ error: "invalid_request" }, 400);
  const firstPage = page.data.before === undefined;
  const [rows, chain] = await Promise.all([
    deps.audit.list(page.data),
    firstPage ? deps.audit.verify() : null,
  ]);
  const result: AuditPage = { rows, chain };
  return json(result);
};

const holds: WebRoute = async ({ deps }) => {
  return json({ holds: await deps.retention.activeHolds(deps.now()) });
};

const whoami: WebRoute = ({ actor }) => Promise.resolve(json({ email: actor }));

const health: WebRoute = async ({ env, deps }) => json(await systemHealth(env, deps));

function plainText(text: string): string {
  return Array.from(text, (char) => {
    const codePoint = char.codePointAt(0) ?? 0;
    return codePoint < 0x20 || codePoint === 0x7f ? " " : char;
  })
    .join("")
    .trim();
}

const maintenanceSchema = z.object({
  set: z
    .object({ on: z.boolean(), message: z.string().max(MAINTENANCE_MESSAGE_MAX) })
    .exactOptional(),
});

const maintenance: WebRoute = async ({ request, env, deps, body, actor }) => {
  const parsed = maintenanceSchema.safeParse(body);
  if (!parsed.success) return fail({ error: "invalid_request" }, 400);
  const lobby = lobbyStub(env);
  const change = parsed.data.set;
  if (!change) return json(await lobby.getMaintenance());
  const message = plainText(change.message);
  const state = await lobby.setMaintenance(change.on, message, actor);
  await recordAction(deps, request, {
    actor,
    action: change.on ? "maintenance_on" : "maintenance_off",
    caseRef: null,
    result: { status: 200, body: null, target: { kind: "site", value: null } },
  });
  return json(state);
};

const routes: Readonly<Record<string, WebRoute>> = {
  whoami,
  maintenance,
  health,
  lookup: caseRoute("lookup"),
  ban: caseRoute("ban"),
  takedown: caseRoute("takedown"),
  hold: caseRoute("hold"),
  holds,
  audit,
  export: exportRoute,
};

function isJson(request: Request): boolean {
  const contentType = request.headers.get("Content-Type") ?? "";
  return contentType.split(";")[0]?.trim().toLowerCase() === JSON_CONTENT_TYPE;
}

async function withinRateLimit(request: Request, env: Env, deps: AppDeps): Promise<boolean> {
  const networkHash = await deps.hasher.hash(networkKey(clientIp(request)));
  try {
    return await lobbyStub(env).hitWebAdminLimit(networkHash, deps.now());
  } catch {
    console.error("web_admin_limit_unavailable");
    return true;
  }
}

export async function handleWebAdmin(request: Request, env: Env, deps: AppDeps): Promise<Response> {
  const actor = deps.access ? await deps.access.verify(request) : null;
  if (!actor) return fail({ error: "not_found" }, 404);
  if (!(await withinRateLimit(request, env, deps))) return fail({ error: "rate_limited" }, 429);
  const name = new URL(request.url).pathname.slice(WEB_ADMIN_PATH_PREFIX.length);
  const route = Object.hasOwn(routes, name) ? routes[name] : undefined;
  if (!route) return fail({ error: "not_found" }, 404);
  if (request.method !== "POST") return fail({ error: "method_not_allowed" }, 405);
  if (!isSameOrigin(request)) return fail({ error: "bad_origin" }, 403);
  if (!isJson(request)) return fail({ error: "unsupported_media_type" }, 415);
  const body = await readJsonBody(request);
  if (body === undefined) return fail({ error: "invalid_request" }, 400);
  return route({ request, env, deps, body, actor });
}
