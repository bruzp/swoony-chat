CREATE INDEX chat_log_chat ON chat_log (chat_id, ended_at);
CREATE INDEX connection_log_hold ON connection_log (hold_until) WHERE hold_until IS NOT NULL;
CREATE INDEX chat_log_hold ON chat_log (hold_until) WHERE hold_until IS NOT NULL;
CREATE INDEX content_log_hold ON content_log (hold_until) WHERE hold_until IS NOT NULL;
