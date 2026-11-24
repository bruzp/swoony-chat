CREATE TABLE job_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  ok INTEGER NOT NULL DEFAULT 0,
  deleted_counts TEXT,
  error_code TEXT
);
CREATE INDEX job_runs_job_started ON job_runs (job, started_at);
CREATE TABLE alert_log (
  problem TEXT PRIMARY KEY,
  sent_at INTEGER NOT NULL
);
