CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reported_device TEXT NOT NULL,
  reporter_device TEXT,
  reporter_network TEXT,
  source TEXT NOT NULL CHECK (source IN ('user','system')),
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX reports_reported_created ON reports (reported_device, created_at);
CREATE TABLE bans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_hash TEXT NOT NULL,
  network_hash TEXT NOT NULL,
  level INTEGER NOT NULL,
  starts_at INTEGER NOT NULL,
  device_expires_at INTEGER NOT NULL,
  network_expires_at INTEGER NOT NULL
);
CREATE INDEX bans_device ON bans (device_hash, starts_at);
CREATE TABLE connection_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  device_hash TEXT NOT NULL,
  payload TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  left_at INTEGER,
  hold_until INTEGER
);
CREATE INDEX connection_log_joined ON connection_log (joined_at);
CREATE INDEX connection_log_user ON connection_log (user_id);
CREATE TABLE chat_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  user_a TEXT NOT NULL,
  user_b TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  hold_until INTEGER
);
CREATE INDEX chat_log_started ON chat_log (started_at);
CREATE TABLE content_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('report_snapshot','all_content')),
  report_reason TEXT,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  hold_until INTEGER
);
CREATE INDEX content_log_created ON content_log (created_at);
CREATE INDEX content_log_chat ON content_log (chat_id);
