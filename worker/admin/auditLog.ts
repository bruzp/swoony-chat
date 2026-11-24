import { LIMITS } from "@shared/config";
import type { AuditChainStatus, AuditRow } from "@shared/protocol/admin";
import { sha256Hex } from "../support/hash";

const GENESIS_HASH = "0".repeat(64);
const MAX_WRITE_ATTEMPTS = 8;
const MAX_VERIFIED_ROWS = 50_000;
const CHECKPOINT_ACTION = "checkpoint";
const SYSTEM_ACTOR = "system";

export interface AuditEntry {
  actor: string;
  action: string;
  caseRef: string | null;
  targetKind: string | null;
  targetHash: string | null;
  result: string;
  resultCount: number | null;
  exportSha256: string | null;
  adminNetworkHash: string | null;
  adminCountry: string | null;
}

interface AuditDbRow {
  id: number;
  at: number;
  actor: string;
  action: string;
  case_ref: string | null;
  target_kind: string | null;
  target_hash: string | null;
  result: string;
  result_count: number | null;
  export_sha256: string | null;
  admin_network_hash: string | null;
  admin_country: string | null;
  prev_hash: string;
}

const INSERT_SQL = `INSERT INTO admin_audit
  (at, actor, action, case_ref, target_kind, target_hash, result, result_count,
   export_sha256, admin_network_hash, admin_country, prev_hash)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function rowHash(row: AuditDbRow): Promise<string> {
  return sha256Hex(
    JSON.stringify([
      row.id,
      row.at,
      row.actor,
      row.action,
      row.case_ref,
      row.target_kind,
      row.target_hash,
      row.result,
      row.result_count,
      row.export_sha256,
      row.admin_network_hash,
      row.admin_country,
      row.prev_hash,
    ]),
  );
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

function toAuditRow(row: AuditDbRow): AuditRow {
  return {
    id: row.id,
    at: row.at,
    actor: row.actor,
    action: row.action,
    caseRef: row.case_ref,
    targetKind: row.target_kind,
    targetHash: row.target_hash,
    result: row.result,
    resultCount: row.result_count,
    exportSha256: row.export_sha256,
    adminCountry: row.admin_country,
  };
}

export class AuditLog {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => number,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.append(entry, () => []);
  }

  async list(page: { before?: number; limit?: number }): Promise<AuditRow[]> {
    const limit = Math.min(page.limit ?? LIMITS.adminAuditPageSize, LIMITS.adminAuditPageSize);
    const { results } = await this.db
      .prepare("SELECT * FROM admin_audit WHERE id < ? ORDER BY id DESC LIMIT ?")
      .bind(page.before ?? Number.MAX_SAFE_INTEGER, limit)
      .all<AuditDbRow>();
    return results.map(toAuditRow);
  }

  async verify(maxRows = MAX_VERIFIED_ROWS): Promise<AuditChainStatus> {
    const { results } = await this.db
      .prepare("SELECT * FROM admin_audit ORDER BY id LIMIT ?")
      .bind(maxRows + 1)
      .all<AuditDbRow>();
    const complete = results.length <= maxRows;
    const rows = complete ? results : results.slice(0, maxRows);
    let expected = (await this.latestCheckpointAnchor()) ?? GENESIS_HASH;
    for (const row of rows) {
      if (row.prev_hash !== expected) {
        return { intact: false, checked: rows.length, brokenAt: row.id, complete };
      }
      expected = await rowHash(row);
    }
    return { intact: true, checked: rows.length, brokenAt: null, complete };
  }

  async purge(now: number, heldTargetHashes: ReadonlySet<string>): Promise<number> {
    const cutoff = now - LIMITS.adminAuditRetentionMs;
    const firstKept = await this.db
      .prepare(
        "SELECT MIN(id) AS id FROM admin_audit WHERE at >= ?1 OR target_hash IN (SELECT value FROM json_each(?2))",
      )
      .bind(cutoff, JSON.stringify([...heldTargetHashes]))
      .first<{ id: number | null }>();
    const lastPurged = await this.db
      .prepare("SELECT * FROM admin_audit WHERE id < ? ORDER BY id DESC LIMIT 1")
      .bind(firstKept?.id ?? Number.MAX_SAFE_INTEGER)
      .first<AuditDbRow>();
    if (!lastPurged) return 0;
    const checkpoint: AuditEntry = {
      actor: SYSTEM_ACTOR,
      action: CHECKPOINT_ACTION,
      caseRef: null,
      targetKind: "audit_row",
      targetHash: await rowHash(lastPurged),
      result: "ok",
      resultCount: null,
      exportSha256: null,
      adminNetworkHash: null,
      adminCountry: null,
    };
    const [, deleted] = await this.append(checkpoint, () => [
      this.db.prepare("DELETE FROM admin_audit WHERE id <= ?").bind(lastPurged.id),
    ]);
    return deleted?.meta.changes ?? 0;
  }

  private async latestCheckpointAnchor(): Promise<string | null> {
    const row = await this.db
      .prepare(
        "SELECT target_hash FROM admin_audit WHERE action = ? AND actor = ? ORDER BY id DESC LIMIT 1",
      )
      .bind(CHECKPOINT_ACTION, SYSTEM_ACTOR)
      .first<{ target_hash: string | null }>();
    return row?.target_hash ?? null;
  }

  private async append(
    entry: AuditEntry,
    alsoRun: () => D1PreparedStatement[],
  ): Promise<D1Result[]> {
    for (let attempt = 1; ; attempt++) {
      const last = await this.db
        .prepare("SELECT * FROM admin_audit ORDER BY id DESC LIMIT 1")
        .first<AuditDbRow>();
      const prevHash = last ? await rowHash(last) : GENESIS_HASH;
      const insert = this.db
        .prepare(INSERT_SQL)
        .bind(
          this.now(),
          entry.actor,
          entry.action,
          entry.caseRef,
          entry.targetKind,
          entry.targetHash,
          entry.result,
          entry.resultCount,
          entry.exportSha256,
          entry.adminNetworkHash,
          entry.adminCountry,
          prevHash,
        );
      try {
        return await this.db.batch([insert, ...alsoRun()]);
      } catch (error) {
        if (!isUniqueViolation(error) || attempt >= MAX_WRITE_ATTEMPTS) throw error;
      }
    }
  }
}
