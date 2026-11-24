CREATE TABLE content_archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  message_count INTEGER NOT NULL,
  first_sent_at INTEGER NOT NULL,
  last_sent_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  hold_until INTEGER,
  stored INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX content_archive_chat ON content_archive (chat_id, first_sent_at);
CREATE INDEX content_archive_created ON content_archive (created_at);
CREATE INDEX content_archive_sent ON content_archive (first_sent_at, last_sent_at);
CREATE INDEX content_archive_hold ON content_archive (hold_until) WHERE hold_until IS NOT NULL;
