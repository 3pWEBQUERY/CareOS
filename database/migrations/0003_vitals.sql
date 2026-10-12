-- Vital sign thresholds: lower_bound/upper_bound are the target range (outside = attention),
-- critical_lower/critical_upper the alarm limits (outside = critical). The unused
-- warning_* columns from the baseline are renamed accordingly.

ALTER TABLE carecore_vital_thresholds RENAME COLUMN warning_lower TO critical_lower;
ALTER TABLE carecore_vital_thresholds RENAME COLUMN warning_upper TO critical_upper;
ALTER TABLE carecore_vital_thresholds ADD COLUMN IF NOT EXISTS reason TEXT;

-- Keep only the newest active threshold per scope before the unique indexes below are created.
UPDATE carecore_vital_thresholds t
SET active = FALSE
WHERE t.active AND t.resident_id IS NULL AND EXISTS (
  SELECT 1 FROM carecore_vital_thresholds newer
  WHERE newer.active AND newer.resident_id IS NULL AND newer.organization_id = t.organization_id
    AND newer.metric = t.metric AND newer.created_at > t.created_at
);

UPDATE carecore_vital_thresholds t
SET active = FALSE
WHERE t.active AND t.resident_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM carecore_vital_thresholds newer
  WHERE newer.active AND newer.resident_id = t.resident_id AND newer.metric = t.metric AND newer.created_at > t.created_at
);

-- At most one active threshold per organization/metric and per resident/metric; older ones stay as history.
CREATE UNIQUE INDEX IF NOT EXISTS carecore_vital_thresholds_org_active_idx
  ON carecore_vital_thresholds (organization_id, metric) WHERE active AND resident_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS carecore_vital_thresholds_resident_active_idx
  ON carecore_vital_thresholds (resident_id, metric) WHERE active AND resident_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS carecore_vitals_measured_at_idx ON carecore_vital_measurements (measured_at DESC);
