-- Ablaufketten für Ereignisse (z. B. Sturz): Die Einrichtung legt je Ereignisart Folgeschritte fest (Titel, Fälligkeit
-- relativ zum Ereignis, Priorität, Dokumentationspflicht). Beim Melden entstehen daraus Aufgaben, verknüpft mit dem
-- Ereignis. Es gibt keine vorgegebenen Schritte.

CREATE TABLE IF NOT EXISTS carecore_event_workflow_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  position SMALLINT NOT NULL CHECK (position >= 0),
  title VARCHAR(240) NOT NULL CHECK (char_length(title) >= 3),
  description TEXT,
  category VARCHAR(40) NOT NULL,
  priority VARCHAR(24) NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  due_offset_minutes INTEGER NOT NULL CHECK (due_offset_minutes BETWEEN 0 AND 43200),
  document_on_completion BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, event_type, position)
);

ALTER TABLE carecore_tasks ADD COLUMN IF NOT EXISTS quality_event_id UUID
  REFERENCES carecore_quality_events(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS carecore_tasks_quality_event_idx ON carecore_tasks (quality_event_id)
  WHERE quality_event_id IS NOT NULL;
