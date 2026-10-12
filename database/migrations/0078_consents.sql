-- Einwilligungen und Freigaben je Person (z. B. Fotos, Weitergabe von Daten, Portalzugang). Die Themen legt die
-- Einrichtung fest (carecore_organizations.settings.consentTopics). Jeder Entscheid bleibt erhalten; ein Widerruf wird
-- mit Datum vermerkt, der jüngste Entscheid je Thema gilt.
CREATE TABLE IF NOT EXISTS carecore_resident_consents (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES carecore_residents(id) ON DELETE CASCADE,
  topic VARCHAR(160) NOT NULL CHECK (btrim(topic) <> ''),
  decision VARCHAR(10) NOT NULL CHECK (decision IN ('granted', 'refused')),
  decided_by VARCHAR(200) NOT NULL CHECK (btrim(decided_by) <> ''),
  decided_on DATE NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_on DATE,
  revoked_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  revoke_note VARCHAR(500) NOT NULL DEFAULT '',
  CHECK (revoked_on IS NULL OR revoked_on >= decided_on)
);
CREATE INDEX IF NOT EXISTS carecore_resident_consents_resident_idx
  ON carecore_resident_consents (resident_id, lower(topic), decided_on DESC, created_at DESC);
