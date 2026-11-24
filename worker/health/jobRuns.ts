import { LIMITS } from "@shared/config";
import type { JobRun } from "@shared/protocol/admin";

interface JobRunRow {
  id: number;
  job: string;
  started_at: number;
  finished_at: number | null;
  ok: number;
  deleted_counts: string | null;
  error_code: string | null;
}

function toJobRun(row: JobRunRow): JobRun {
  return {
    id: row.id,
    job: row.job,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    ok: row.ok === 1,
    deletedCounts: row.deleted_counts
      ? (JSON.parse(row.deleted_counts) as Record<string, number>)
      : null,
    errorCode: row.error_code,
  };
}

export class JobRunStore {
  constructor(private readonly db: D1Database) {}

  async start(job: string, at: number): Promise<number> {
    const row = await this.db
      .prepare("INSERT INTO job_runs (job, started_at) VALUES (?, ?) RETURNING id")
      .bind(job, at)
      .first<{ id: number }>();
    if (!row) throw new Error("job run was not recorded");
    return row.id;
  }

  async succeed(id: number, at: number, deleted: Record<string, number>): Promise<void> {
    await this.db
      .prepare("UPDATE job_runs SET finished_at = ?, ok = 1, deleted_counts = ? WHERE id = ?")
      .bind(at, JSON.stringify(deleted), id)
      .run();
  }

  async fail(id: number, at: number, errorCode: string): Promise<void> {
    await this.db
      .prepare("UPDATE job_runs SET finished_at = ?, ok = 0, error_code = ? WHERE id = ?")
      .bind(at, errorCode, id)
      .run();
  }

  async recent(job: string): Promise<JobRun[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM job_runs WHERE job = ? ORDER BY started_at DESC LIMIT ?")
      .bind(job, LIMITS.healthRunsShown)
      .all<JobRunRow>();
    return results.map(toJobRun);
  }

  async isStale(job: string, now: number): Promise<boolean> {
    const row = await this.db
      .prepare(
        "SELECT MIN(started_at) AS first_run, MAX(CASE WHEN ok = 1 THEN started_at END) AS last_ok FROM job_runs WHERE job = ?",
      )
      .bind(job)
      .first<{ first_run: number | null; last_ok: number | null }>();
    const since = row?.last_ok ?? row?.first_run ?? null;
    return since !== null && since < now - LIMITS.cleanupStaleMs;
  }

  async purgeOld(now: number): Promise<number> {
    const result = await this.db
      .prepare("DELETE FROM job_runs WHERE started_at < ?")
      .bind(now - LIMITS.jobRunRetentionMs)
      .run();
    return result.meta.changes;
  }
}
