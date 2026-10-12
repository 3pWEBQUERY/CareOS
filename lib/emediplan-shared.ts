// eMediplan (Schweiz, CHMED16A): eingelesener Medikationsplan als Entwurf. Jede Zeile übernimmt eine Fachperson
// einzeln als Verordnung; CareOS prüft und ändert nichts selbst.

export const EMEDIPLAN_SLOTS = ["morning", "noon", "evening", "night"] as const;
export type EmediplanSlot = (typeof EMEDIPLAN_SLOTS)[number];
export const EMEDIPLAN_SLOT_LABELS: Record<EmediplanSlot, string> = {
  morning: "Morgen",
  noon: "Mittag",
  evening: "Abend",
  night: "Nacht",
};

// Art der Kennung laut CHMED16A (IdType).
export const EMEDIPLAN_ID_TYPES: Record<number, string> = {
  1: "Freitext",
  2: "GTIN",
  3: "Pharmacode",
  4: "Produktnummer",
};

export type EmediplanLine = {
  index: number;
  idType: number;
  // Kennung wie im Plan (bei Freitext die Bezeichnung).
  id: string;
  // Bezeichnung nur bei Freitext; GTIN und Pharmacode löst CareOS ohne Arzneimitteldatenbank nicht auf.
  freeText: string | null;
  unit: string;
  route: string;
  reason: string;
  instructions: string;
  prescribedBy: string;
  selfMedication: boolean;
  // Erste Dosierung des Plans; weitere Zeilen der Dosierung erscheinen als Hinweis.
  from: string | null;
  to: string | null;
  reserve: boolean;
  // Dosis je Tageszeit (Morgen, Mittag, Abend, Nacht); null = keine einfache Dosierung angegeben.
  doses: Record<EmediplanSlot, number> | null;
  // Täglich zu festen Uhrzeiten (CHMED23A „Times“): Uhrzeit HH:MM und Dosis; ersetzt die Tageszeiten.
  timedDoses: Array<{ time: string; dose: number }> | null;
  // Komplexes Schema (Einnahmezeiten mit Abständen) oder mehrere Dosierungen: von Hand erfassen.
  complex: boolean;
  // Präparat aus dem eigenen Stamm, dem diese GTIN bzw. dieser Pharmacode schon zugeordnet ist.
  match: { id: string; name: string; strength: string; form: string } | null;
};

export type EmediplanDraft = {
  version: string;
  issuedAt: string | null;
  author: string;
  remark: string;
  patient: { firstName: string; lastName: string; birthDate: string | null };
  // Abweichung zur gewählten Person (Name oder Geburtsdatum); die Fachperson entscheidet.
  patientMismatch: string[];
  lines: EmediplanLine[];
};

// Verordnungen einer Zeile: je verschiedene Dosis eine Verordnung mit ihren Tageszeiten (CareOS führt pro Verordnung
// eine Dosis). Beispiel: 1 morgens und 0.5 abends ergibt zwei Verordnungen.
export function dosesBySlot(lineDoses: Record<EmediplanSlot, number>) {
  const groups = new Map<number, EmediplanSlot[]>();
  for (const slot of EMEDIPLAN_SLOTS) {
    const dose = lineDoses[slot];
    if (dose > 0) groups.set(dose, [...(groups.get(dose) ?? []), slot]);
  }
  return [...groups].map(([dose, slots]) => ({ dose, slots }));
}
