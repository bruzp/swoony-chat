CREATE TABLE admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  case_ref TEXT,
  target_kind TEXT,
  target_hash TEXT,
  result TEXT NOT NULL,
  result_count INTEGER,
  export_sha256 TEXT,
  admin_network_hash TEXT,
  admin_country TEXT,
  prev_hash TEXT NOT NULL UNIQUE
);
CREATE INDEX admin_audit_at ON admin_audit (at);
