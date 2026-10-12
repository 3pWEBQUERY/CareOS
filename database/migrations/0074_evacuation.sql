-- Evakuierungs- und Notfallliste: wie die Person im Brandfall bzw. bei einer Evakuation das Haus verlässt (wie
-- dokumentiert) und Hinweise für den Notfall (z. B. Sauerstoff, Hörgerät). Ohne Eintrag „nicht erfasst“.
ALTER TABLE carecore_residents
  ADD COLUMN IF NOT EXISTS evacuation_mobility VARCHAR(16)
    CHECK (evacuation_mobility IN ('independent', 'assisted', 'wheelchair', 'bedridden')),
  ADD COLUMN IF NOT EXISTS evacuation_note VARCHAR(300);
