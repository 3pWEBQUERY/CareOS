-- Wünsche für die letzte Lebensphase (Ort, Begleitung, religiöse oder spirituelle Wünsche, Bestattung, wer informiert
-- werden soll) und die Checkliste nach einem Todesfall. Die Punkte der Checkliste legt die Einrichtung selbst fest
-- (carecore_organizations.settings.deathChecklist); beim Erfassen des Todesfalls werden sie für die Person übernommen.
CREATE TABLE IF NOT EXISTS carecore_end_of_life_wishes (
  resident_id UUID PRIMARY KEY REFERENCES carecore_residents(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  place TEXT NOT NULL DEFAULT '',
  companionship TEXT NOT NULL DEFAULT '',
  spiritual TEXT NOT NULL DEFAULT '',
  funeral TEXT NOT NULL DEFAULT '',
  notify TEXT NOT NULL DEFAULT '',
  other_wishes TEXT NOT NULL DEFAULT '',
  discussed_with VARCHAR(200) NOT NULL DEFAULT '',
  discussed_on DATE,
  updated_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS carecore_death_checklist_items (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES carecore_residents(id) ON DELETE CASCADE,
  position SMALLINT NOT NULL,
  label VARCHAR(200) NOT NULL CHECK (btrim(label) <> ''),
  done_at TIMESTAMPTZ,
  done_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  note VARCHAR(500) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (resident_id, position)
);
