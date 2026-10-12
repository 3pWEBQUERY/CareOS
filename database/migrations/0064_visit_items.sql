-- Visite: Einträge „Für Visite“ (Pflegedokumentation, importance = 'visit') gelten als offen, bis die Rückmeldung der
-- Ärztin bzw. des Arztes erfasst ist. Die Rückmeldung ist ein eigener Dokumentationseintrag (Kategorie Arztvisite).
CREATE TABLE IF NOT EXISTS carecore_visit_resolutions (
  entry_id UUID PRIMARY KEY REFERENCES carecore_documentation_entries(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  response_entry_id UUID REFERENCES carecore_documentation_entries(id) ON DELETE SET NULL,
  physician VARCHAR(160) NOT NULL DEFAULT '',
  resolved_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS carecore_visit_resolutions_org_idx ON carecore_visit_resolutions (organization_id, resolved_at DESC);
CREATE INDEX IF NOT EXISTS carecore_documentation_visit_idx ON carecore_documentation_entries (resident_id, occurred_at DESC)
  WHERE importance = 'visit';
