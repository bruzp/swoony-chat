CREATE TABLE content_log_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('report_snapshot','all_content','takedown_snapshot')),
  report_reason TEXT,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  hold_until INTEGER
);
INSERT INTO content_log_new (id, chat_id, kind, report_reason, payload, created_at, hold_until)
  SELECT id, chat_id, kind, report_reason, payload, created_at, hold_until FROM content_log;
DROP TABLE content_log;
ALTER TABLE content_log_new RENAME TO content_log;
CREATE INDEX content_log_created ON content_log (created_at);
CREATE INDEX content_log_chat ON content_log (chat_id);
