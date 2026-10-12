-- Allgemeine Drossel für schreibende API-Anfragen: Zähler je Schlüssel (Sitzung oder IP) und Minute.
CREATE TABLE IF NOT EXISTS carecore_rate_limits (
  key VARCHAR(80) NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX IF NOT EXISTS carecore_rate_limits_window_idx ON carecore_rate_limits (window_start);
