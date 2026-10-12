-- Änderungsprotokoll der Bewohnerakte: Einträge je Bewohner schnell finden. Einträge verweisen entweder
-- direkt auf die Akte (entity_id) oder tragen die Bewohner-ID in den Daten (residentId).
CREATE INDEX IF NOT EXISTS carecore_audit_entity_id_idx ON carecore_audit_log (entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS carecore_audit_resident_idx
  ON carecore_audit_log ((COALESCE(after_data ->> 'residentId', before_data ->> 'residentId')), created_at DESC);
