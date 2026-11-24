import { LIMITS } from "@shared/config";
import type { ActiveBan } from "@shared/protocol/api";

const MIN_KV_TTL_SECONDS = 60;

const deviceKey = (deviceHash: string) => `ban:device:${deviceHash}`;
const networkKey = (networkHash: string) => `ban:net:${networkHash}`;

export class BanStore {
  constructor(
    private readonly kv: KVNamespace,
    private readonly db: D1Database,
    private readonly now: () => number,
  ) {}

  async getActiveBan(deviceHash: string | null, networkHash: string): Promise<ActiveBan | null> {
    const keys = [networkKey(networkHash)];
    if (deviceHash !== null) keys.push(deviceKey(deviceHash));
    const now = this.now();
    const ends = await Promise.all(keys.map((key) => this.kv.get<ActiveBan>(key, "json")));
    const latest = Math.max(
      ...ends.map((ban) => (ban && typeof ban.until === "number" ? ban.until : 0)),
    );
    return latest > now ? { until: latest } : null;
  }

  async issueBan(
    deviceHash: string,
    networkHash: string,
    startLevel = 0,
  ): Promise<{ deviceUntil: number; networkUntil: number }> {
    const now = this.now();
    const prior = await this.db
      .prepare("SELECT COUNT(*) AS n FROM bans WHERE device_hash = ? AND starts_at > ?")
      .bind(deviceHash, now - LIMITS.banHistoryWindowMs)
      .first<{ n: number }>();
    const ladder = LIMITS.deviceBanLadderMs;
    const level = Math.min(Math.max(prior?.n ?? 0, startLevel), ladder.length - 1);
    const deviceMs = ladder[level] ?? ladder[2];
    const deviceUntil = now + deviceMs;
    const networkUntil = now + LIMITS.networkBanMs;

    await this.db
      .prepare(
        `INSERT INTO bans (device_hash, network_hash, level, starts_at, device_expires_at, network_expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(deviceHash, networkHash, level, now, deviceUntil, networkUntil)
      .run();
    await Promise.all([
      this.putBan(deviceKey(deviceHash), deviceUntil, deviceMs),
      this.putBan(networkKey(networkHash), networkUntil, LIMITS.networkBanMs),
    ]);
    return { deviceUntil, networkUntil };
  }

  async lastBanAt(deviceHash: string): Promise<number | null> {
    const row = await this.db
      .prepare("SELECT MAX(starts_at) AS at FROM bans WHERE device_hash = ?")
      .bind(deviceHash)
      .first<{ at: number | null }>();
    return row?.at ?? null;
  }

  private async putBan(key: string, until: number, durationMs: number): Promise<void> {
    const existing = await this.kv.get<ActiveBan>(key, "json");
    if (existing && existing.until >= until) return;
    const ban: ActiveBan = { until };
    await this.kv.put(key, JSON.stringify(ban), {
      expirationTtl: Math.max(MIN_KV_TTL_SECONDS, Math.ceil(durationMs / 1000)),
    });
  }
}
