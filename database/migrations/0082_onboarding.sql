-- Einarbeitung neuer Mitarbeitender: Die Punkte je Rolle legt die Einrichtung fest (Einstellung onboardingChecklists);
-- beim Start werden sie für die Person übernommen und von der einarbeitenden Person bzw. der Leitung abgezeichnet.
CREATE TABLE IF NOT EXISTS carecore_onboardings (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES carecore_users(id) ON DELETE CASCADE,
  mentor_id UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  started_on DATE NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (mentor_id IS NULL OR mentor_id <> user_id)
);
-- Je Person höchstens eine laufende Einarbeitung.
CREATE UNIQUE INDEX IF NOT EXISTS carecore_onboardings_open_idx ON carecore_onboardings (user_id) WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS carecore_onboardings_org_idx ON carecore_onboardings (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS carecore_onboarding_steps (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  onboarding_id UUID NOT NULL REFERENCES carecore_onboardings(id) ON DELETE CASCADE,
  position SMALLINT NOT NULL,
  title VARCHAR(200) NOT NULL CHECK (btrim(title) <> ''),
  done_at TIMESTAMPTZ,
  done_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  note VARCHAR(500) NOT NULL DEFAULT '',
  UNIQUE (onboarding_id, position)
);
