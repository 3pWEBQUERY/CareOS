-- Gleichzeitiges Bearbeiten von Dokumenten, Tabellen und Präsentationen: wer die Datei gerade offen hat und wo
-- (Zelle, Folie, Absatz). Einträge ohne Lebenszeichen gelten nach kurzer Zeit als verlassen und werden entfernt.
CREATE TABLE IF NOT EXISTS carecore_office_presence (
  file_id UUID NOT NULL REFERENCES carecore_cloud_files(id) ON DELETE CASCADE,
  session_id VARCHAR(40) NOT NULL,
  user_id UUID NOT NULL REFERENCES carecore_users(id) ON DELETE CASCADE,
  display_name VARCHAR(120) NOT NULL,
  place JSONB,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (file_id, session_id)
);
CREATE INDEX IF NOT EXISTS carecore_office_presence_seen_idx ON carecore_office_presence (file_id, seen_at);
