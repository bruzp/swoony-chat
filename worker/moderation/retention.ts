import { LIMITS } from "@shared/config";

export async function purgeExpired(
  db: D1Database,
  now: number,
): Promise<{ reports: number; bans: number }> {
  const cutoff = now - LIMITS.moderationRetentionMs;
  const [reports, bans] = await db.batch([
    db.prepare("DELETE FROM reports WHERE created_at < ?").bind(cutoff),
    db
      .prepare("DELETE FROM bans WHERE device_expires_at < ?1 AND network_expires_at < ?1")
      .bind(cutoff),
  ]);
  return { reports: reports?.meta.changes ?? 0, bans: bans?.meta.changes ?? 0 };
}
