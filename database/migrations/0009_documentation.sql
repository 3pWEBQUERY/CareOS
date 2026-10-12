-- Care documentation: entries are never edited; corrections are new entries that
-- reference the original via amended_from_id.

CREATE INDEX IF NOT EXISTS carecore_documentation_amended_idx ON carecore_documentation_entries (amended_from_id) WHERE amended_from_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS carecore_documentation_time_idx ON carecore_documentation_entries (occurred_at DESC);
