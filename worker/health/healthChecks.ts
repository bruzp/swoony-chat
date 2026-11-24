import { LIMITS } from "@shared/config";
import type {
  ComponentHealth,
  HealthComponentName,
  PublicHealthStatus,
  SystemHealth,
} from "@shared/protocol/admin";
import type { AppDeps } from "../deps";
import { json } from "../http/json";
import { clientIp, networkKey } from "../http/requestInfo";
import { lobbyStub } from "../lobby/lobbyStub";
import { MemoryRateLimiter } from "../support/rateLimit";
import { CLEANUP_JOB } from "./cleanup";

const KV_PROBE_KEY = "health:probe";
const healthLimiter = new MemoryRateLimiter(
  LIMITS.healthChecksPerNetwork.count,
  LIMITS.healthChecksPerNetwork.windowMs,
);

interface LobbyStatus {
  online: number;
  maintenance: boolean;
}

async function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("health check timed out"));
    }, LIMITS.healthCheckTimeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function timed<T>(
  name: HealthComponentName,
  check: () => Promise<T>,
): Promise<{ component: ComponentHealth; value: T | null }> {
  const started = performance.now();
  try {
    const value = await withTimeout(check());
    return { component: { name, ok: true, ms: Math.round(performance.now() - started) }, value };
  } catch {
    return {
      component: { name, ok: false, ms: Math.round(performance.now() - started) },
      value: null,
    };
  }
}

export interface HealthReport {
  components: ComponentHealth[];
  lobby: LobbyStatus | null;
}

export async function checkComponents(env: Env): Promise<HealthReport> {
  const [database, banStore, lobby] = await Promise.all([
    timed("database", () => env.DB.prepare("SELECT 1 AS ok").first()),
    timed("banStore", () => env.BANS.get(KV_PROBE_KEY)),
    timed("lobby", () => lobbyStub(env).healthStatus()),
  ]);
  const site: ComponentHealth = { name: "site", ok: true, ms: 0 };
  return {
    components: [site, database.component, banStore.component, lobby.component],
    lobby: lobby.value,
  };
}

function publicStatus(report: HealthReport): PublicHealthStatus {
  if (report.components.some((component) => !component.ok)) return "down";
  return report.lobby?.maintenance ? "maintenance" : "ok";
}

async function alertIfCleanupStale(deps: AppDeps): Promise<boolean> {
  try {
    const stale = await deps.jobs.isStale(CLEANUP_JOB, deps.now());
    if (stale) {
      await deps.alerts.notify(
        "cleanup_stale",
        "Swoony: no daily clean-up for over 26 hours",
        "The daily clean-up job has not finished successfully for over 26 hours. Old records may " +
          "not be deleted on time. Open System health on the admin page and contact the developer.",
      );
    }
    return stale;
  } catch {
    console.error("cleanup_stale_check_failed");
    return false;
  }
}

export async function publicHealth(request: Request, env: Env, deps: AppDeps): Promise<Response> {
  if (!healthLimiter.hit(networkKey(clientIp(request)), deps.now())) {
    return json({ error: "rate_limited" }, 429);
  }
  const report = await checkComponents(env);
  const status = publicStatus(report);
  if (status !== "down") await withTimeout(alertIfCleanupStale(deps)).catch(() => false);
  return json({ status }, status === "down" ? 503 : 200);
}

export async function systemHealth(env: Env, deps: AppDeps): Promise<SystemHealth> {
  const report = await checkComponents(env);
  const [cleanupStale, lastRuns] = await Promise.all([
    deps.jobs.isStale(CLEANUP_JOB, deps.now()).catch(() => false),
    deps.jobs.recent(CLEANUP_JOB).catch(() => []),
  ]);
  return {
    components: report.components,
    online: report.lobby?.online ?? null,
    maintenance: report.lobby?.maintenance ?? false,
    cleanupStale,
    lastRuns,
  };
}
