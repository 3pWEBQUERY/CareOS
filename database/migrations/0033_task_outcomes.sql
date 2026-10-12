-- Aufgaben: Ergebnis „teilweise erledigt“ und „nicht erledigt (übersprungen)“ mit Begründung sowie Eskalation an die Leitung.
-- Aktiv sind open, in_progress und escalated; abgeschlossen sind completed, partial, skipped und cancelled.
ALTER TABLE carecore_tasks DROP CONSTRAINT IF EXISTS carecore_tasks_status_check;
ALTER TABLE carecore_tasks ADD CONSTRAINT carecore_tasks_status_check
  CHECK (status IN ('open', 'in_progress', 'escalated', 'completed', 'partial', 'skipped', 'cancelled'));
ALTER TABLE carecore_tasks ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;
ALTER TABLE carecore_tasks ADD COLUMN IF NOT EXISTS escalated_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL;
ALTER TABLE carecore_tasks ADD COLUMN IF NOT EXISTS escalation_reason TEXT;
ALTER TABLE carecore_tasks DROP CONSTRAINT IF EXISTS carecore_tasks_outcome_note_check;
ALTER TABLE carecore_tasks ADD CONSTRAINT carecore_tasks_outcome_note_check
  CHECK (status NOT IN ('partial', 'skipped') OR completion_note IS NOT NULL);
ALTER TABLE carecore_tasks DROP CONSTRAINT IF EXISTS carecore_tasks_escalation_check;
ALTER TABLE carecore_tasks ADD CONSTRAINT carecore_tasks_escalation_check
  CHECK (status <> 'escalated' OR (escalated_at IS NOT NULL AND escalation_reason IS NOT NULL));
