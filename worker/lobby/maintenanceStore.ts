import type { MaintenanceState } from "@shared/protocol/admin";

const OFF: MaintenanceState = { on: false, message: "", startedAt: null, startedBy: null };

interface MaintenanceRow {
  on_flag: number;
  message: string;
  started_at: number | null;
  started_by: string | null;
  [key: string]: SqlStorageValue;
}

export class MaintenanceStore {
  constructor(private readonly sql: SqlStorage) {}

  ensureSchema(): void {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS maintenance (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      on_flag INTEGER NOT NULL,
      message TEXT NOT NULL,
      started_at INTEGER,
      started_by TEXT
    )`);
  }

  get(): MaintenanceState {
    const [row] = this.sql.exec<MaintenanceRow>("SELECT * FROM maintenance WHERE id = 1").toArray();
    if (!row) return OFF;
    return {
      on: row.on_flag === 1,
      message: row.message,
      startedAt: row.started_at,
      startedBy: row.started_by,
    };
  }

  isOn(): boolean {
    return this.get().on;
  }

  set(state: MaintenanceState): void {
    this.sql.exec(
      `INSERT INTO maintenance (id, on_flag, message, started_at, started_by) VALUES (1, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET on_flag = excluded.on_flag, message = excluded.message,
         started_at = excluded.started_at, started_by = excluded.started_by`,
      state.on ? 1 : 0,
      state.message,
      state.startedAt,
      state.startedBy,
    );
  }
}

export function maintenanceOff(): MaintenanceState {
  return OFF;
}
