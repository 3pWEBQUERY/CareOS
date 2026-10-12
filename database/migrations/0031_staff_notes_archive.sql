-- Persönliche Notizen (Startseite): Archiv statt nur Löschen.
ALTER TABLE carecore_staff_notes ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS carecore_staff_notes_owner_archive_idx
  ON carecore_staff_notes (user_id, (archived_at IS NOT NULL), pinned DESC, updated_at DESC);
