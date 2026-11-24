import { Button } from "@/components/ui/button";
import { formatPht } from "@shared/legal/time";
import type { HealthComponentName, JobRun, SystemHealth } from "@shared/protocol/admin";
import { useCallback, useEffect, useState } from "react";
import { useAdmin, useAdminCall } from "../adminContext";
import { largeButton, Notice, Panel, TableBox, Td, Th } from "../ui";

const COMPONENT_LABELS: Record<HealthComponentName, string> = {
  site: "Site",
  database: "Database",
  banStore: "Ban store",
  lobby: "Lobby",
};

function deletedSummary(counts: Record<string, number> | null): string {
  if (!counts) return "";
  return Object.entries(counts)
    .map(([table, count]) => `${table} ${String(count)}`)
    .join(", ");
}

function runResult(run: JobRun): string {
  if (run.finishedAt === null) return "running or stopped";
  return run.ok ? "ok" : `failed (${run.errorCode ?? "unknown"})`;
}

export function HealthPage() {
  const { api } = useAdmin();
  const call = useAdminCall();
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const show = useCallback((result: Awaited<ReturnType<typeof call<SystemHealth>>>) => {
    setLoading(false);
    if (result.ok) {
      setHealth(result.value);
      setError(null);
    } else setError(result.error);
  }, []);

  useEffect(() => {
    void call(() => api.health()).then(show);
  }, [api, call, show]);

  function load() {
    setLoading(true);
    void call(() => api.health()).then(show);
  }

  const lastRun = health?.lastRuns[0];
  return (
    <Panel
      title="System health"
      headingLevel={1}
      description="Live checks of each part of Swoony and the daily clean-up job."
      actions={
        <Button variant="outline" className={largeButton} disabled={loading} onClick={load}>
          Check again
        </Button>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      {loading && !health && <Notice>Loading…</Notice>}
      {health?.maintenance && <Notice>Maintenance mode is on.</Notice>}
      {health?.cleanupStale && (
        <Notice tone="error">
          No successful clean-up in the last 26 hours. An alert email is sent at most every 6 hours.
        </Notice>
      )}
      {health && (
        <>
          <ul className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
            {health.components.map((component) => (
              <li key={component.name} className="flex flex-col gap-1 rounded-2xl border p-4">
                <span className="text-xs font-bold tracking-wider text-muted-foreground uppercase">
                  {COMPONENT_LABELS[component.name]}
                </span>
                <span className="text-lg font-bold">
                  {component.ok ? "✅ Working" : "❌ Failing"}
                </span>
                <span className="text-xs text-muted-foreground">{component.ms} ms</span>
              </li>
            ))}
            <li className="flex flex-col gap-1 rounded-2xl border p-4">
              <span className="text-xs font-bold tracking-wider text-muted-foreground uppercase">
                Online now
              </span>
              <span className="text-lg font-bold">{health.online ?? "unknown"}</span>
            </li>
          </ul>
          <p className="text-sm">
            Last clean-up:{" "}
            {lastRun
              ? `${formatPht(lastRun.startedAt)}, ${runResult(lastRun)}`
              : "none recorded yet"}
          </p>
          <TableBox>
            <thead>
              <tr>
                <Th>Started (PHT)</Th>
                <Th>Result</Th>
                <Th>Rows deleted</Th>
              </tr>
            </thead>
            <tbody>
              {health.lastRuns.map((run) => (
                <tr key={run.id}>
                  <Td>{formatPht(run.startedAt)}</Td>
                  <Td>{runResult(run)}</Td>
                  <Td>{deletedSummary(run.deletedCounts)}</Td>
                </tr>
              ))}
            </tbody>
          </TableBox>
        </>
      )}
    </Panel>
  );
}
