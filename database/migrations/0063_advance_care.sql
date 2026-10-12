-- Vorsorge und Vertretung: Patientenverfügung und Vorsorgeauftrag bzw. -vollmacht in den Stammdaten (vorhanden ja /
-- nein, ohne Eintrag „nicht erfasst“), dazu die Rolle einer Kontaktperson als vertretungsberechtigte Person.
-- Grundlagen je Land (CH ZGB Art. 360 ff. und 370 ff., DE §§ 1820 ff. BGB, AT §§ 260 ff. ABGB) bestimmen nur die
-- Bezeichnungen; CareCore prüft keine Wirksamkeit.
ALTER TABLE carecore_residents
  ADD COLUMN IF NOT EXISTS advance_directive VARCHAR(10) CHECK (advance_directive IN ('yes', 'no')),
  ADD COLUMN IF NOT EXISTS advance_directive_on DATE,
  ADD COLUMN IF NOT EXISTS advance_directive_location VARCHAR(200),
  ADD COLUMN IF NOT EXISTS care_mandate VARCHAR(10) CHECK (care_mandate IN ('yes', 'no')),
  ADD COLUMN IF NOT EXISTS care_mandate_on DATE,
  ADD COLUMN IF NOT EXISTS care_mandate_effective_on DATE;

ALTER TABLE carecore_resident_contacts
  ADD COLUMN IF NOT EXISTS representative_role VARCHAR(20)
    CHECK (representative_role IN ('mandate', 'official', 'spouse', 'relative', 'other'));
