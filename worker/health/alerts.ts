import { LIMITS } from "@shared/config";

export type AlertProblem = "cleanup_failed" | "cleanup_stale" | "archive_stuck";

export interface AlertSender {
  send(subject: string, text: string): Promise<void>;
}

export class EmailAlertSender implements AlertSender {
  constructor(
    private readonly binding: SendEmail,
    private readonly from: string,
    private readonly to: string,
  ) {
    if (!from || !to) throw new Error("Alert email needs a from and a to address");
  }

  async send(subject: string, text: string): Promise<void> {
    await this.binding.send({ from: this.from, to: this.to, subject, text });
  }
}

const CLAIM_SQL = `INSERT INTO alert_log (problem, sent_at) VALUES (?1, ?2)
  ON CONFLICT (problem) DO UPDATE SET sent_at = excluded.sent_at
  WHERE alert_log.sent_at <= ?2 - ?3`;

export class Alerts {
  constructor(
    private readonly db: D1Database,
    private readonly sender: AlertSender | null,
    private readonly now: () => number,
  ) {}

  async notify(problem: AlertProblem, subject: string, text: string): Promise<boolean> {
    if (!this.sender) {
      console.warn("alert_not_configured", { problem });
      return false;
    }
    const claim = await this.db
      .prepare(CLAIM_SQL)
      .bind(problem, this.now(), LIMITS.alertRepeatMs)
      .run();
    if (claim.meta.changes === 0) return false;
    try {
      await this.sender.send(subject, text);
      return true;
    } catch {
      console.error("alert_send_failed", { problem });
      await this.db.prepare("DELETE FROM alert_log WHERE problem = ?").bind(problem).run();
      return false;
    }
  }
}
