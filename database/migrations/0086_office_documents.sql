-- Dokumente, Tabellen und Präsentationen direkt in der Ablage bearbeiten: Zähler für jede Speicherung (auch das
-- automatische Speichern, das innerhalb weniger Minuten keine neue Version anlegt), damit gleichzeitige Änderungen
-- zweier Personen erkannt werden statt sich still zu überschreiben.
ALTER TABLE carecore_cloud_files ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0;
