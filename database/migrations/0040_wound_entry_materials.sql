-- Wunden: verwendetes Verbandsmaterial je Versorgung aus dem Materialkatalog (Pflegebedarf).
-- Gespeichert als Momentaufnahme (Produkt, Bezeichnung, Einheit, Menge), damit spätere Änderungen am
-- Katalog die Dokumentation nicht verändern.

ALTER TABLE carecore_wound_entries ADD COLUMN IF NOT EXISTS materials JSONB NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(materials) = 'array');
