import { LIMITS } from "@shared/config";
import { SqlRateLimiter } from "../support/rateLimit";

export class StrikeTracker {
  constructor(private readonly limiter: SqlRateLimiter) {}

  strike(deviceHash: string, now: number): boolean {
    return !this.limiter.hit(deviceHash, now);
  }

  forgive(deviceHash: string): void {
    this.limiter.reset(deviceHash);
  }

  prune(now: number): void {
    this.limiter.prune(now);
  }
}

export function createStrikeTracker(sql: SqlStorage): StrikeTracker {
  const { count, windowMs } = LIMITS.strikesForKick;
  return new StrikeTracker(new SqlRateLimiter(sql, "strikes", count - 1, windowMs));
}

export class ContactRejectionCounter {
  private readonly limiter: SqlRateLimiter;

  constructor(sql: SqlStorage) {
    const { count, windowMs } = LIMITS.contactRejectionsForStrike;
    this.limiter = new SqlRateLimiter(sql, "contact_rejections", count - 1, windowMs);
  }

  reject(deviceHash: string, now: number): boolean {
    if (this.limiter.hit(deviceHash, now)) return false;
    this.limiter.reset(deviceHash);
    return true;
  }

  prune(now: number): void {
    this.limiter.prune(now);
  }
}

export class DuplicateTextDetector {
  private readonly sends = new Map<string, Map<string, Map<string, number>>>();
  private lastSweepAt = 0;

  constructor(
    private readonly users: number,
    private readonly windowMs: number,
  ) {}

  record(senderId: string, recipientId: string, textHash: string, now: number): boolean {
    this.sweepExpired(now);
    const byText = this.sends.get(senderId) ?? new Map<string, Map<string, number>>();
    const recipients = this.recent(byText.get(textHash), now);
    recipients.delete(recipientId);
    if (recipients.size + 1 >= this.users) {
      byText.set(textHash, recipients);
      this.sends.set(senderId, byText);
      return true;
    }
    recipients.set(recipientId, now);
    byText.set(textHash, recipients);
    this.sends.set(senderId, byText);
    return false;
  }

  private recent(recipients: Map<string, number> | undefined, now: number): Map<string, number> {
    const kept = new Map<string, number>();
    for (const [recipient, at] of recipients ?? []) {
      if (at > now - this.windowMs) kept.set(recipient, at);
    }
    return kept;
  }

  private sweepExpired(now: number): void {
    if (now - this.lastSweepAt < this.windowMs) return;
    this.lastSweepAt = now;
    for (const [senderId, byText] of this.sends) {
      for (const [textHash, recipients] of byText) {
        if (this.recent(recipients, now).size === 0) byText.delete(textHash);
      }
      if (byText.size === 0) this.sends.delete(senderId);
    }
  }
}
