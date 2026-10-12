-- Duty schedule: planned staffing per shift, planning details, confirmations, reminders and absence requests.

ALTER TABLE carecore_shifts ADD COLUMN IF NOT EXISTS required_staff SMALLINT NOT NULL DEFAULT 1
  CHECK (required_staff BETWEEN 0 AND 20);
ALTER TABLE carecore_shifts ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE carecore_shifts ADD COLUMN IF NOT EXISTS highlight BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE carecore_shifts ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL;
ALTER TABLE carecore_shifts ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

ALTER TABLE carecore_shift_assignments ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE carecore_shift_assignments ADD COLUMN IF NOT EXISTS remind BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE carecore_shift_assignments ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS carecore_absences (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES carecore_users(id) ON DELETE CASCADE,
  kind VARCHAR(24) NOT NULL CHECK (kind IN ('vacation', 'sick', 'training', 'personal')),
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'rejected', 'withdrawn', 'revoked')),
  urgent BOOLEAN NOT NULL DEFAULT FALSE,
  substitute_user_id UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  note TEXT,
  decided_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS carecore_absences_org_range_idx ON carecore_absences (organization_id, starts_on, ends_on);
CREATE INDEX IF NOT EXISTS carecore_absences_user_idx ON carecore_absences (user_id, starts_on);

ALTER TABLE carecore_shift_assignments ADD COLUMN IF NOT EXISTS absence_id UUID REFERENCES carecore_absences(id) ON DELETE SET NULL;
