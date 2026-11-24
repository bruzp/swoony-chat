import type { ReportReason } from "@shared/config";

export interface UserReport {
  reportedDevice: string;
  reporterDevice: string;
  reporterNetwork: string;
  reason: ReportReason;
  createdAt: number;
}

const SYSTEM_KICK_REASON = "kick";

export class ReportStore {
  constructor(private readonly db: D1Database) {}

  async addUserReport(report: UserReport): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO reports (reported_device, reporter_device, reporter_network, source, reason, created_at)
         VALUES (?, ?, ?, 'user', ?, ?)`,
      )
      .bind(
        report.reportedDevice,
        report.reporterDevice,
        report.reporterNetwork,
        report.reason,
        report.createdAt,
      )
      .run();
  }

  async addSystemKick(reportedDevice: string, createdAt: number): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO reports (reported_device, source, reason, created_at) VALUES (?, 'system', ?, ?)",
      )
      .bind(reportedDevice, SYSTEM_KICK_REASON, createdAt)
      .run();
  }

  async independentReporters(reportedDevice: string, since: number): Promise<number> {
    return this.count(
      `SELECT MIN(COUNT(DISTINCT reporter_network), COUNT(DISTINCT reporter_device)) AS n
       FROM reports WHERE reported_device = ? AND source = 'user' AND created_at > ?`,
      reportedDevice,
      since,
    );
  }

  async systemKicks(reportedDevice: string, since: number): Promise<number> {
    return this.count(
      `SELECT COUNT(*) AS n FROM reports
       WHERE reported_device = ? AND source = 'system' AND created_at > ?`,
      reportedDevice,
      since,
    );
  }

  private async count(query: string, reportedDevice: string, since: number): Promise<number> {
    const row = await this.db.prepare(query).bind(reportedDevice, since).first<{ n: number }>();
    return row?.n ?? 0;
  }
}
