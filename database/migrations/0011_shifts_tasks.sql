-- Shifts: organization scope and personal check-in/check-out. Tasks: category, visibility, recurrence and completion.

ALTER TABLE carecore_shifts ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES carecore_organizations(id) ON DELETE CASCADE;

UPDATE carecore_shifts s SET organization_id = si.organization_id
FROM carecore_care_units cu JOIN carecore_sites si ON si.id = cu.site_id
WHERE s.organization_id IS NULL AND cu.id = s.care_unit_id;

UPDATE carecore_shifts s SET organization_id = p.organization_id
FROM carecore_shift_assignments a JOIN carecore_user_profiles p ON p.user_id = a.user_id
WHERE s.organization_id IS NULL AND a.shift_id = s.id AND p.organization_id IS NOT NULL;

DELETE FROM carecore_shifts WHERE organization_id IS NULL;
ALTER TABLE carecore_shifts ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS carecore_shifts_org_time_idx ON carecore_shifts (organization_id, starts_at);

ALTER TABLE carecore_shift_assignments ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;
ALTER TABLE carecore_shift_assignments ADD COLUMN IF NOT EXISTS checked_out_at TIMESTAMPTZ;
ALTER TABLE carecore_shift_assignments ADD COLUMN IF NOT EXISTS check_in_note TEXT;
ALTER TABLE carecore_shift_assignments ADD COLUMN IF NOT EXISTS check_out_note TEXT;
ALTER TABLE carecore_shift_assignments ADD COLUMN IF NOT EXISTS checklist JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE carecore_shift_assignments ADD COLUMN IF NOT EXISTS handover_status VARCHAR(24)
  CHECK (handover_status IN ('complete', 'partial', 'pending'));
CREATE INDEX IF NOT EXISTS carecore_shift_assignments_user_idx ON carecore_shift_assignments (user_id, shift_id);

ALTER TABLE carecore_tasks ADD COLUMN IF NOT EXISTS category VARCHAR(60) NOT NULL DEFAULT 'Pflege';
ALTER TABLE carecore_tasks ADD COLUMN IF NOT EXISTS team_visible BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE carecore_tasks ADD COLUMN IF NOT EXISTS remind BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE carecore_tasks ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ;
ALTER TABLE carecore_tasks ADD COLUMN IF NOT EXISTS document_on_completion BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE carecore_tasks ADD COLUMN IF NOT EXISTS recurrence VARCHAR(16) NOT NULL DEFAULT 'none'
  CHECK (recurrence IN ('none', 'daily', 'weekly'));
ALTER TABLE carecore_tasks ADD COLUMN IF NOT EXISTS follow_up_task_id UUID REFERENCES carecore_tasks(id) ON DELETE SET NULL;
ALTER TABLE carecore_tasks ADD COLUMN IF NOT EXISTS completed_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL;
ALTER TABLE carecore_tasks ADD COLUMN IF NOT EXISTS completion_note TEXT;
ALTER TABLE carecore_tasks ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
CREATE INDEX IF NOT EXISTS carecore_tasks_org_status_due_idx ON carecore_tasks (organization_id, status, due_at);
