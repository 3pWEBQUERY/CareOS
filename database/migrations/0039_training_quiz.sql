-- Lernen: Quiz je Schulung mit einer von der Einrichtung festgelegten Bestehensgrenze (kein Vorgabewert).

ALTER TABLE carecore_trainings ADD COLUMN IF NOT EXISTS quiz_pass_percent SMALLINT
  CHECK (quiz_pass_percent BETWEEN 1 AND 100);

CREATE TABLE IF NOT EXISTS carecore_training_quiz_questions (
  id UUID PRIMARY KEY,
  training_id UUID NOT NULL REFERENCES carecore_trainings(id) ON DELETE CASCADE,
  position SMALLINT NOT NULL CHECK (position >= 0),
  question TEXT NOT NULL CHECK (char_length(question) BETWEEN 3 AND 1000),
  options JSONB NOT NULL CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) BETWEEN 2 AND 6),
  correct_option SMALLINT NOT NULL CHECK (correct_option >= 0 AND correct_option < jsonb_array_length(options)),
  UNIQUE (training_id, position)
);

CREATE TABLE IF NOT EXISTS carecore_training_quiz_attempts (
  id UUID PRIMARY KEY,
  enrollment_id UUID NOT NULL REFERENCES carecore_training_enrollments(id) ON DELETE CASCADE,
  training_id UUID NOT NULL REFERENCES carecore_trainings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES carecore_users(id) ON DELETE CASCADE,
  answers JSONB NOT NULL,
  correct SMALLINT NOT NULL CHECK (correct >= 0),
  total SMALLINT NOT NULL CHECK (total > 0 AND correct <= total),
  score_percent SMALLINT NOT NULL CHECK (score_percent BETWEEN 0 AND 100),
  pass_percent SMALLINT NOT NULL CHECK (pass_percent BETWEEN 1 AND 100),
  passed BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS carecore_training_quiz_attempts_enrollment_idx
  ON carecore_training_quiz_attempts (enrollment_id, created_at DESC);

ALTER TABLE carecore_training_enrollments ADD COLUMN IF NOT EXISTS quiz_score SMALLINT
  CHECK (quiz_score BETWEEN 0 AND 100);
ALTER TABLE carecore_training_enrollments ADD COLUMN IF NOT EXISTS quiz_passed_at TIMESTAMPTZ;
