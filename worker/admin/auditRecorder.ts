import type { AppDeps } from "../deps";
import { clientIp, networkKey, requestCountry } from "../http/requestInfo";
import type { ActionResult } from "./actions";

export interface RecordedAction {
  actor: string;
  action: string;
  caseRef: string | null;
  result: ActionResult;
  exportSha256?: string;
}

function resultLabel(result: ActionResult): string {
  if (result.status === 200) return "ok";
  const body = result.body;
  if (typeof body === "object" && body !== null && "error" in body) return String(body.error);
  return `status_${String(result.status)}`;
}

export async function recordAction(
  deps: AppDeps,
  request: Request,
  recorded: RecordedAction,
): Promise<void> {
  const { target } = recorded.result;
  const [targetHash, adminNetworkHash] = await Promise.all([
    target.value === null ? null : deps.hasher.hash(target.value),
    deps.hasher.hash(networkKey(clientIp(request))),
  ]);
  await deps.audit.record({
    actor: recorded.actor,
    action: recorded.action,
    caseRef: recorded.caseRef,
    targetKind: target.kind,
    targetHash,
    result: resultLabel(recorded.result),
    resultCount: recorded.result.count ?? null,
    exportSha256: recorded.exportSha256 ?? null,
    adminNetworkHash,
    adminCountry: requestCountry(request),
  });
}

export async function purgeAuditLog(deps: AppDeps, now: number): Promise<number> {
  const targets = await deps.retention.heldTargets(now);
  const held = await Promise.all(targets.map((target) => deps.hasher.hash(target)));
  return deps.audit.purge(now, new Set(held));
}
