-- Nutrition: richer plans (one active per resident, older ones kept as history),
-- a meal intake log and correctable fluid entries.

ALTER TABLE carecore_nutrition_plans ADD COLUMN IF NOT EXISTS meal_rhythm VARCHAR(80);
ALTER TABLE carecore_nutrition_plans ADD COLUMN IF NOT EXISTS assistance VARCHAR(120);
ALTER TABLE carecore_nutrition_plans ADD COLUMN IF NOT EXISTS preferences TEXT;
-- Upper limit, e.g. for heart failure; exceeding it is flagged as critical.
ALTER TABLE carecore_nutrition_plans ADD COLUMN IF NOT EXISTS fluid_limit_ml INTEGER CHECK (fluid_limit_ml IS NULL OR fluid_limit_ml > 0);

UPDATE carecore_nutrition_plans p SET active = FALSE
WHERE p.active AND EXISTS (
  SELECT 1 FROM carecore_nutrition_plans newer
  WHERE newer.active AND newer.resident_id = p.resident_id AND newer.created_at > p.created_at
);
CREATE UNIQUE INDEX IF NOT EXISTS carecore_nutrition_plans_active_idx ON carecore_nutrition_plans (resident_id) WHERE active;

ALTER TABLE carecore_fluid_entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE carecore_fluid_entries ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL;
ALTER TABLE carecore_fluid_entries ADD COLUMN IF NOT EXISTS delete_reason TEXT;

CREATE TABLE IF NOT EXISTS carecore_meal_entries (
  id UUID PRIMARY KEY,
  resident_id UUID NOT NULL REFERENCES carecore_residents(id) ON DELETE CASCADE,
  entered_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  eaten_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  meal VARCHAR(40) NOT NULL CHECK (meal IN ('Frühstück', 'Zwischenmahlzeit Vormittag', 'Mittagessen', 'Zwischenmahlzeit Nachmittag', 'Abendessen', 'Spätmahlzeit')),
  portion_percent SMALLINT NOT NULL CHECK (portion_percent IN (0, 25, 50, 75, 100)),
  note TEXT,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  delete_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS carecore_meal_entries_resident_time_idx ON carecore_meal_entries (resident_id, eaten_at DESC) WHERE deleted_at IS NULL;
