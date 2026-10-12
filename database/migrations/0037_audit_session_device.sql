-- Protokoll: aus welcher Sitzung und mit welchem Gerät (Browser-Kennung) eine Änderung kam.
-- Ohne Fremdschlüssel, damit der Eintrag nach dem Abmelden (Sitzung gelöscht) erhalten bleibt.
ALTER TABLE carecore_audit_log ADD COLUMN IF NOT EXISTS session_id UUID;
ALTER TABLE carecore_audit_log ADD COLUMN IF NOT EXISTS user_agent VARCHAR(300);
CREATE INDEX IF NOT EXISTS carecore_audit_log_session_idx ON carecore_audit_log (session_id) WHERE session_id IS NOT NULL;
