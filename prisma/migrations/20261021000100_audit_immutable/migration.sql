-- Audit-Protokoll unveränderbar (PRD §35): UPDATE, DELETE und TRUNCATE werden abgewiesen.
CREATE OR REPLACE FUNCTION careos_audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog ist unveränderbar (% nicht erlaubt)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION careos_audit_immutable();

CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION careos_audit_immutable();
