-- Löschkonzept (PRD §36): Das Audit-Protokoll bleibt unveränderbar (PRD §35).
-- Einzige Ausnahme: der Aufbewahrungsjob darf Einträge löschen, die älter als 10 Jahre sind.
-- Er setzt dazu innerhalb seiner Transaktion `SET LOCAL careos.retention = 'on'`.
-- UPDATE und TRUNCATE werden immer abgewiesen, DELETE jüngerer Einträge ebenfalls.
CREATE OR REPLACE FUNCTION careos_audit_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('careos.retention', true) = 'on'
     AND OLD.at < now() - interval '10 years' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'AuditLog ist unveränderbar (% nicht erlaubt)', TG_OP;
END;
$$ LANGUAGE plpgsql;
