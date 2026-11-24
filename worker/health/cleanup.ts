import { purgeAuditLog } from "../admin/auditRecorder";
import type { AppDeps } from "../deps";
import { purgeExpired as purgeModeration } from "../moderation/retention";

export const CLEANUP_JOB = "daily_cleanup";

type DeletedCounts = Record<string, number>;

interface Stage {
  name: "moderation_purge" | "retention_purge" | "audit_purge" | "job_history_purge";
  run: () => Promise<DeletedCounts>;
}

function stagesFor(env: Env, deps: AppDeps, now: number): Stage[] {
  return [
    { name: "moderation_purge", run: () => purgeModeration(env.DB, now) },
    { name: "retention_purge", run: () => deps.retention.purgeExpired(now) },
    {
      name: "audit_purge",
      run: async () => ({ admin_audit: await purgeAuditLog(deps, now) }),
    },
    {
      name: "job_history_purge",
      run: async () => ({ job_runs: await deps.jobs.purgeOld(now) }),
    },
  ];
}

export async function runDailyCleanup(env: Env, deps: AppDeps, now: number): Promise<void> {
  const runId = await deps.jobs.start(CLEANUP_JOB, now);
  const stages = stagesFor(env, deps, now);
  const outcomes = await Promise.allSettled(stages.map((stage) => stage.run()));
  const failed = stages.filter((_, index) => outcomes[index]?.status === "rejected");
  if (failed.length === 0) {
    const deleted = outcomes.reduce<DeletedCounts>(
      (all, outcome) => (outcome.status === "fulfilled" ? { ...all, ...outcome.value } : all),
      {},
    );
    await deps.jobs.succeed(runId, deps.now(), deleted);
    return;
  }
  const errorCode = failed.map((stage) => `${stage.name}_failed`).join(",");
  console.error("cleanup_failed", { errorCode });
  await deps.jobs.fail(runId, deps.now(), errorCode);
  await deps.alerts.notify(
    "cleanup_failed",
    "Swoony: the daily clean-up failed",
    `The daily clean-up job failed at step "${errorCode}". The other steps still ran. Old records ` +
      "may not be deleted on time. Open System health on the admin page and contact the developer.",
  );
  throw new Error(`daily cleanup failed: ${errorCode}`);
}
