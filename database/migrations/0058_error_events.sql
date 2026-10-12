-- Serverfehler (HTTP 500) für die Überwachung: Zeitpunkt, Herkunft (Meldung der Schnittstelle) und eine kurze,
-- gekürzte Fehlerbeschreibung ohne Anfragedaten. Wird nach 30 Tagen gelöscht.
CREATE TABLE IF NOT EXISTS carecore_error_events (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source VARCHAR(200) NOT NULL,
  error_name VARCHAR(80) NOT NULL DEFAULT 'Error',
  detail VARCHAR(300) NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS carecore_error_events_time_idx ON carecore_error_events (occurred_at DESC);

-- Versendete Alarme (höchstens einer je Stunde).
CREATE TABLE IF NOT EXISTS carecore_error_alerts (
  id BIGSERIAL PRIMARY KEY,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error_count INTEGER NOT NULL
);
