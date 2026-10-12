-- Learning: course details, sessions, progress, certificates and verification of mandatory evidence.

ALTER TABLE carecore_trainings ADD COLUMN IF NOT EXISTS category VARCHAR(60) NOT NULL DEFAULT 'Pflege';
ALTER TABLE carecore_trainings ADD COLUMN IF NOT EXISTS format VARCHAR(16) NOT NULL DEFAULT 'presence'
  CHECK (format IN ('elearning', 'presence', 'external'));
ALTER TABLE carecore_trainings ADD COLUMN IF NOT EXISTS duration_minutes SMALLINT CHECK (duration_minutes BETWEEN 5 AND 2400);
ALTER TABLE carecore_trainings ADD COLUMN IF NOT EXISTS required_roles JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE carecore_trainings ADD COLUMN IF NOT EXISTS link_url TEXT;
ALTER TABLE carecore_trainings ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS carecore_training_sessions (
  id UUID PRIMARY KEY,
  training_id UUID NOT NULL REFERENCES carecore_trainings(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  location VARCHAR(180),
  capacity SMALLINT CHECK (capacity BETWEEN 1 AND 500),
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS carecore_training_sessions_training_idx ON carecore_training_sessions (training_id, starts_at);

ALTER TABLE carecore_cloud_files ADD COLUMN IF NOT EXISTS purpose VARCHAR(24) NOT NULL DEFAULT 'cloud'
  CHECK (purpose IN ('cloud', 'certificate', 'document'));

ALTER TABLE carecore_training_enrollments ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES carecore_training_sessions(id) ON DELETE SET NULL;
ALTER TABLE carecore_training_enrollments ADD COLUMN IF NOT EXISTS progress SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100);
ALTER TABLE carecore_training_enrollments ADD COLUMN IF NOT EXISTS certificate_file_id UUID REFERENCES carecore_cloud_files(id) ON DELETE SET NULL;
ALTER TABLE carecore_training_enrollments ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL;
ALTER TABLE carecore_training_enrollments ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE carecore_training_enrollments ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE carecore_training_enrollments ADD COLUMN IF NOT EXISTS assigned_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL;
ALTER TABLE carecore_training_enrollments ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ;
