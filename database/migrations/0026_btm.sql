-- Betäubungsmittel (BtM): Kennzeichnung der Präparate, Zweitunterschrift und Bestandskontrollen.
-- Buchungen von BtM-Präparaten sind unveränderlich; Korrekturen erfolgen als neue Buchung.

ALTER TABLE carecore_medications ADD COLUMN IF NOT EXISTS is_controlled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE carecore_medication_stock_movements
  ADD COLUMN IF NOT EXISTS witness_user_id UUID REFERENCES carecore_users(id) ON DELETE SET NULL;

-- Bestandskontrolle: gezählter gegenüber erwartetem Bestand, mit Zeugin/Zeuge. Eine Differenz wird
-- zusätzlich als Korrekturbuchung (movement_id) im Journal geführt.
CREATE TABLE IF NOT EXISTS carecore_btm_counts (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  stock_id UUID REFERENCES carecore_medication_stock(id) ON DELETE SET NULL,
  medication_id UUID NOT NULL REFERENCES carecore_medications(id) ON DELETE CASCADE,
  expected_quantity NUMERIC(12,3) NOT NULL,
  counted_quantity NUMERIC(12,3) NOT NULL CHECK (counted_quantity >= 0),
  note TEXT,
  movement_id UUID REFERENCES carecore_medication_stock_movements(id) ON DELETE SET NULL,
  counted_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  witness_user_id UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (counted_quantity = expected_quantity OR note IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS carecore_btm_counts_stock_idx ON carecore_btm_counts (stock_id, created_at DESC);
CREATE INDEX IF NOT EXISTS carecore_medication_stock_movements_stock_idx
  ON carecore_medication_stock_movements (stock_id, created_at);

-- BtM-Buchungen dürfen weder gelöscht noch inhaltlich geändert werden. Erlaubt bleibt nur das Lösen von
-- Verweisen (z. B. wenn eine Bestandsposition entfernt wird).
CREATE OR REPLACE FUNCTION carecore_btm_movement_guard() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM carecore_medications WHERE id = OLD.medication_id AND is_controlled) THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'BtM-Buchungen können nicht gelöscht werden.' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.delta IS DISTINCT FROM OLD.delta OR NEW.reason IS DISTINCT FROM OLD.reason
      OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.witness_user_id IS DISTINCT FROM OLD.witness_user_id OR NEW.note IS DISTINCT FROM OLD.note
      OR NEW.medication_id IS DISTINCT FROM OLD.medication_id OR NEW.resident_id IS DISTINCT FROM OLD.resident_id THEN
      RAISE EXCEPTION 'BtM-Buchungen können nicht geändert werden.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS carecore_btm_movement_guard ON carecore_medication_stock_movements;
CREATE TRIGGER carecore_btm_movement_guard
BEFORE UPDATE OR DELETE ON carecore_medication_stock_movements
FOR EACH ROW EXECUTE FUNCTION carecore_btm_movement_guard();

CREATE OR REPLACE FUNCTION carecore_btm_count_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BtM-Bestandskontrollen können nicht gelöscht werden.' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.expected_quantity IS DISTINCT FROM OLD.expected_quantity OR NEW.counted_quantity IS DISTINCT FROM OLD.counted_quantity
    OR NEW.note IS DISTINCT FROM OLD.note OR NEW.counted_by IS DISTINCT FROM OLD.counted_by
    OR NEW.witness_user_id IS DISTINCT FROM OLD.witness_user_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'BtM-Bestandskontrollen können nicht geändert werden.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS carecore_btm_count_guard ON carecore_btm_counts;
CREATE TRIGGER carecore_btm_count_guard
BEFORE UPDATE OR DELETE ON carecore_btm_counts
FOR EACH ROW EXECUTE FUNCTION carecore_btm_count_guard();
