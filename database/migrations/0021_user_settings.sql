-- Personal settings: password age and the device of each session ("Aktive Sitzungen").

ALTER TABLE carecore_users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
ALTER TABLE carecore_sessions ADD COLUMN IF NOT EXISTS user_agent VARCHAR(300);
CREATE INDEX IF NOT EXISTS carecore_sessions_user_idx ON carecore_sessions (user_id, created_at DESC);
