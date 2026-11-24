export interface RateLimiter {
  hit(key: string, now: number): boolean;
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private lastSweepAt = 0;

  constructor(
    private readonly count: number,
    private readonly windowMs: number,
  ) {}

  get size(): number {
    return this.hits.size;
  }

  hit(key: string, now: number): boolean {
    this.sweepExpired(now);
    const recent = (this.hits.get(key) ?? []).filter((at) => at > now - this.windowMs);
    const allowed = recent.length < this.count;
    if (allowed) recent.push(now);
    if (recent.length > 0) this.hits.set(key, recent);
    else this.hits.delete(key);
    return allowed;
  }

  private sweepExpired(now: number): void {
    if (now - this.lastSweepAt < this.windowMs) return;
    this.lastSweepAt = now;
    for (const [key, times] of this.hits) {
      if (times.every((at) => at <= now - this.windowMs)) this.hits.delete(key);
    }
  }
}

export class SqlRateLimiter implements RateLimiter {
  constructor(
    private readonly sql: SqlStorage,
    private readonly bucket: string,
    private readonly count: number,
    private readonly windowMs: number,
  ) {
    sql.exec(`CREATE TABLE IF NOT EXISTS rate_events (bucket TEXT NOT NULL, key TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS rate_events_by_key ON rate_events (bucket, key, at);
      CREATE INDEX IF NOT EXISTS rate_events_by_age ON rate_events (bucket, at);`);
  }

  hit(key: string, now: number): boolean {
    this.prune(now);
    const { n } = this.sql
      .exec<{ n: number }>(
        "SELECT COUNT(*) AS n FROM rate_events WHERE bucket = ? AND key = ?",
        this.bucket,
        key,
      )
      .one();
    if (n >= this.count) return false;
    this.sql.exec(
      "INSERT INTO rate_events (bucket, key, at) VALUES (?, ?, ?)",
      this.bucket,
      key,
      now,
    );
    return true;
  }

  reset(key: string): void {
    this.sql.exec("DELETE FROM rate_events WHERE bucket = ? AND key = ?", this.bucket, key);
  }

  prune(now: number): void {
    this.sql.exec(
      "DELETE FROM rate_events WHERE bucket = ? AND at <= ?",
      this.bucket,
      now - this.windowMs,
    );
  }
}
