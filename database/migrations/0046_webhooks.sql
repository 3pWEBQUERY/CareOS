-- Webhooks: angebundene Systeme erhalten eine signierte Meldung, wenn sich etwas ändert. Die Meldung enthält nur den
-- Verweis (z. B. Observation/<id>); die Daten liest das System über die FHIR-Schnittstelle mit seinem Schlüssel.
-- Das Geheimnis für die Signatur liegt verschlüsselt (AES-256-GCM, Schlüssel aus CARECORE_MFA_KEY) in der Datenbank.
CREATE TABLE IF NOT EXISTS carecore_webhooks (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL,
  url VARCHAR(500) NOT NULL,
  secret_encrypted TEXT NOT NULL,
  events TEXT[] NOT NULL,
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_delivery_at TIMESTAMPTZ,
  last_status INTEGER,
  last_error VARCHAR(300),
  CHECK (cardinality(events) > 0)
);

CREATE INDEX IF NOT EXISTS carecore_webhooks_org_idx ON carecore_webhooks (organization_id);

-- Ausstehende und erledigte Zustellungen (Warteschlange mit Wiederholungen).
CREATE TABLE IF NOT EXISTS carecore_webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES carecore_webhooks(id) ON DELETE CASCADE,
  event VARCHAR(40) NOT NULL,
  resource VARCHAR(80) NOT NULL,
  patient VARCHAR(80),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts SMALLINT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_status INTEGER,
  last_error VARCHAR(300),
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS carecore_webhook_deliveries_due_idx
  ON carecore_webhook_deliveries (next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS carecore_webhook_deliveries_hook_idx
  ON carecore_webhook_deliveries (webhook_id, created_at DESC);

-- Ereignisse direkt in der Datenbank vormerken, damit keine Schreibstelle sie vergisst.
CREATE OR REPLACE FUNCTION carecore_webhook_enqueue(org UUID, event_name TEXT, resource_ref TEXT, patient_ref TEXT)
RETURNS void AS $$
BEGIN
  INSERT INTO carecore_webhook_deliveries (webhook_id, event, resource, patient)
  SELECT w.id, event_name, resource_ref, patient_ref FROM carecore_webhooks w
  WHERE w.organization_id = org AND event_name = ANY (w.events);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION carecore_webhook_observation() RETURNS trigger AS $$
BEGIN
  PERFORM carecore_webhook_enqueue(
    (SELECT organization_id FROM carecore_residents WHERE id = NEW.resident_id),
    'Observation.created', 'Observation/' || NEW.id, 'Patient/' || NEW.resident_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS carecore_webhook_observation ON carecore_vital_measurements;
CREATE TRIGGER carecore_webhook_observation
AFTER INSERT ON carecore_vital_measurements
FOR EACH ROW EXECUTE FUNCTION carecore_webhook_observation();

-- Nur Änderungen an Feldern, die die FHIR-Ressource Patient ausgibt.
CREATE OR REPLACE FUNCTION carecore_webhook_patient() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM carecore_webhook_enqueue(NEW.organization_id, 'Patient.created', 'Patient/' || NEW.id, 'Patient/' || NEW.id);
  ELSIF (OLD.first_name, OLD.last_name, OLD.preferred_name, OLD.date_of_birth, OLD.gender, OLD.language, OLD.status,
         OLD.deceased_on, OLD.external_number)
    IS DISTINCT FROM (NEW.first_name, NEW.last_name, NEW.preferred_name, NEW.date_of_birth, NEW.gender, NEW.language,
         NEW.status, NEW.deceased_on, NEW.external_number) THEN
    PERFORM carecore_webhook_enqueue(NEW.organization_id, 'Patient.updated', 'Patient/' || NEW.id, 'Patient/' || NEW.id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS carecore_webhook_patient ON carecore_residents;
CREATE TRIGGER carecore_webhook_patient
AFTER INSERT OR UPDATE ON carecore_residents
FOR EACH ROW EXECUTE FUNCTION carecore_webhook_patient();
