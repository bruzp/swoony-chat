import { json } from "../http/json";
import type { AppDeps } from "../deps";
import { clientIp, networkKey } from "../http/requestInfo";
import { lobbyStub } from "../lobby/lobbyStub";
import { findAction, readJsonBody, recordActions } from "./actions";
import { recordAction } from "./auditRecorder";

const CLI_ACTOR = "cli";

export const ADMIN_PATH_PREFIX = "/api/admin/";

function hidden(): Response {
  return json({ error: "not_found" }, 404);
}

export async function handleAdmin(request: Request, env: Env, deps: AppDeps): Promise<Response> {
  if (!deps.admin) return hidden();
  const networkHash = await deps.hasher.hash(networkKey(clientIp(request)));
  if (!(await lobbyStub(env).hitAdminLimit(networkHash, deps.now()))) return hidden();
  if (!(await deps.admin.verify(request.headers.get("Authorization")))) return hidden();
  const name = new URL(request.url).pathname.slice(ADMIN_PATH_PREFIX.length);
  const action = request.method === "POST" ? findAction(recordActions, name) : null;
  if (!action) return hidden();
  const result = await action({ env, deps, body: await readJsonBody(request) });
  if (!result) return json({ error: "invalid_request" }, 400);
  const targetHash = result.target.value ? await deps.hasher.hash(result.target.value) : null;
  console.info("admin_action", { action: name, targetHash });
  await recordAction(deps, request, { actor: CLI_ACTOR, action: name, caseRef: null, result });
  return json(result.body, result.status);
}
