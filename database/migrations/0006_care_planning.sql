-- Care planning: problem and resources per goal, an evaluation history for goals
-- and at most one open care plan per resident.

ALTER TABLE carecore_care_goals ADD COLUMN IF NOT EXISTS problem TEXT;
ALTER TABLE carecore_care_goals ADD COLUMN IF NOT EXISTS resources TEXT;

ALTER TABLE carecore_care_plans ADD COLUMN IF NOT EXISTS closed_reason TEXT;

CREATE TABLE IF NOT EXISTS carecore_care_goal_evaluations (
  id UUID PRIMARY KEY,
  care_goal_id UUID NOT NULL REFERENCES carecore_care_goals(id) ON DELETE CASCADE,
  evaluated_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  outcome VARCHAR(24) NOT NULL CHECK (outcome IN ('achieved', 'partially', 'not_achieved', 'ongoing')),
  note TEXT NOT NULL,
  next_review_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS carecore_care_goal_evaluations_goal_idx ON carecore_care_goal_evaluations (care_goal_id, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS carecore_care_goal_evaluations_time_idx ON carecore_care_goal_evaluations (evaluated_at DESC);
CREATE INDEX IF NOT EXISTS carecore_care_goals_plan_idx ON carecore_care_goals (care_plan_id, status);
CREATE INDEX IF NOT EXISTS carecore_interventions_goal_idx ON carecore_interventions (care_goal_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS carecore_care_plans_one_open_idx
  ON carecore_care_plans (resident_id) WHERE status IN ('draft', 'active', 'review');
