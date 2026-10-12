-- Ausscheidungs- und Kontinenzprotokoll: Stuhlgang (Form nach der Bristol-Stuhlformen-Skala, wie veröffentlicht),
-- Wasserlassen, Inkontinenz und Materialwechsel. Einträge werden nicht gelöscht, sondern mit Grund storniert.
CREATE TABLE IF NOT EXISTS carecore_elimination_entries (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES carecore_residents(id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL,
  kind VARCHAR(24) NOT NULL CHECK (kind IN ('stool', 'urine', 'incontinence_urine', 'incontinence_stool', 'material')),
  bristol SMALLINT CHECK (bristol BETWEEN 1 AND 7),
  volume VARCHAR(12) CHECK (volume IN ('small', 'medium', 'large')),
  material VARCHAR(200) NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  author_user_id UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  cancel_reason TEXT NOT NULL DEFAULT '',
  CHECK (bristol IS NULL OR kind IN ('stool', 'incontinence_stool')),
  CHECK (kind <> 'material' OR btrim(material) <> ''),
  CHECK (cancelled_at IS NULL OR btrim(cancel_reason) <> '')
);
CREATE INDEX IF NOT EXISTS carecore_elimination_entries_resident_idx
  ON carecore_elimination_entries (resident_id, occurred_at DESC);
