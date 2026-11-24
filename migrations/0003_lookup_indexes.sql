ALTER TABLE connection_log ADD COLUMN nickname_hash TEXT;
CREATE INDEX connection_log_nickname ON connection_log (nickname_hash, joined_at);
CREATE INDEX chat_log_user_a ON chat_log (user_a, started_at);
CREATE INDEX chat_log_user_b ON chat_log (user_b, started_at);
