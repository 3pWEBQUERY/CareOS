// Catalog of standardized assessment instruments. Scores are always computed from the
// answers with these definitions (on the server), never taken from the client.

export type InstrumentOption = { value: number; label: string };
export type InstrumentItem = { key: string; label: string; options: InstrumentOption[] };
export type RiskBand = {
  min: number;
  max: number;
  level: string;
  label: string;
  tone: "stable" | "attention" | "critical";
};

export type Instrument = {
  code: string;
  name: string;
  version: string;
  category: string;
  description: string;
  items: InstrumentItem[];
  bands: RiskBand[];
  // Default interval until the next reassessment.
  reassessDays: number;
  // Core instruments are expected for every resident (shown as missing otherwise).
  core: boolean;
  // Eigenes Instrument der Einrichtung: Inhalt, Bereiche und Intervall stammen von der Einrichtung.
  custom?: { source: string; version: string };
};

const scale = (labels: string[], start = 1): InstrumentOption[] =>
  labels.map((label, i) => ({ value: start + i, label }));

export const INSTRUMENTS: Instrument[] = [
  {
    code: "BRADEN",
    name: "Braden-Skala",
    version: "1.0",
    category: "Dekubitusrisiko",
    description: "Einschätzung des Dekubitusrisikos. Tiefe Werte bedeuten ein höheres Risiko (6–23 Punkte).",
    items: [
      {
        key: "sensory",
        label: "Sensorisches Empfindungsvermögen",
        options: scale(["vollständig ausgefallen", "stark eingeschränkt", "leicht eingeschränkt", "vorhanden"]),
      },
      {
        key: "moisture",
        label: "Feuchtigkeit",
        options: scale(["ständig feucht", "oft feucht", "manchmal feucht", "selten feucht"]),
      },
      {
        key: "activity",
        label: "Aktivität",
        options: scale(["bettlägerig", "sitzt auf", "geht wenig", "geht regelmässig"]),
      },
      {
        key: "mobility",
        label: "Mobilität",
        options: scale(["komplett immobil", "stark eingeschränkt", "leicht eingeschränkt", "mobil"]),
      },
      { key: "nutrition", label: "Ernährung", options: scale(["sehr schlecht", "mässig", "adäquat", "gut"]) },
      {
        key: "friction",
        label: "Reibung und Scherkräfte",
        options: scale(["Problem", "potenzielles Problem", "kein Problem feststellbar"]),
      },
    ],
    bands: [
      { min: 6, max: 9, level: "very_high", label: "Sehr hohes Risiko", tone: "critical" },
      { min: 10, max: 12, level: "high", label: "Hohes Risiko", tone: "critical" },
      { min: 13, max: 14, level: "medium", label: "Mittleres Risiko", tone: "attention" },
      { min: 15, max: 18, level: "low", label: "Geringes Risiko", tone: "attention" },
      { min: 19, max: 23, level: "none", label: "Kein erhöhtes Risiko", tone: "stable" },
    ],
    reassessDays: 30,
    core: true,
  },
  {
    code: "MORSE",
    name: "Morse-Sturzskala",
    version: "1.0",
    category: "Sturzrisiko",
    description: "Einschätzung des Sturzrisikos (0–125 Punkte). Ab 45 Punkten hohes Sturzrisiko.",
    items: [
      {
        key: "history",
        label: "Sturz in der Vorgeschichte (letzte 3 Monate)",
        options: [
          { value: 0, label: "Nein" },
          { value: 25, label: "Ja" },
        ],
      },
      {
        key: "diagnosis",
        label: "Mehr als eine medizinische Diagnose",
        options: [
          { value: 0, label: "Nein" },
          { value: 15, label: "Ja" },
        ],
      },
      {
        key: "aid",
        label: "Gehhilfe",
        options: [
          { value: 0, label: "Keine / Bettruhe / Begleitung durch Pflege" },
          { value: 15, label: "Gehstock, Krücken, Rollator" },
          { value: 30, label: "Hält sich an Möbeln fest" },
        ],
      },
      {
        key: "iv",
        label: "Infusion / venöser Zugang",
        options: [
          { value: 0, label: "Nein" },
          { value: 20, label: "Ja" },
        ],
      },
      {
        key: "gait",
        label: "Gang",
        options: [
          { value: 0, label: "Normal / Bettruhe / Rollstuhl" },
          { value: 10, label: "Schwach" },
          { value: 20, label: "Beeinträchtigt" },
        ],
      },
      {
        key: "mental",
        label: "Mentaler Status",
        options: [
          { value: 0, label: "Schätzt eigene Fähigkeiten realistisch ein" },
          { value: 15, label: "Überschätzt sich / vergisst Einschränkungen" },
        ],
      },
    ],
    bands: [
      { min: 0, max: 24, level: "none", label: "Geringes Sturzrisiko", tone: "stable" },
      { min: 25, max: 44, level: "medium", label: "Mittleres Sturzrisiko", tone: "attention" },
      { min: 45, max: 125, level: "high", label: "Hohes Sturzrisiko", tone: "critical" },
    ],
    reassessDays: 30,
    core: true,
  },
  {
    code: "BARTHEL",
    name: "Barthel-Index",
    version: "1.0",
    category: "Selbständigkeit",
    description: "Selbständigkeit bei Alltagsaktivitäten (0–100 Punkte). Höhere Werte bedeuten mehr Selbständigkeit.",
    items: [
      {
        key: "eating",
        label: "Essen",
        options: [
          { value: 0, label: "Nicht möglich" },
          { value: 5, label: "Mit Hilfe" },
          { value: 10, label: "Selbständig" },
        ],
      },
      {
        key: "transfer",
        label: "Aufsetzen und Umsetzen (Bett/Stuhl)",
        options: [
          { value: 0, label: "Nicht möglich" },
          { value: 5, label: "Erhebliche Hilfe" },
          { value: 10, label: "Geringe Hilfe / Aufsicht" },
          { value: 15, label: "Selbständig" },
        ],
      },
      {
        key: "grooming",
        label: "Sich waschen (Gesicht, Hände, Zähne, Rasur)",
        options: [
          { value: 0, label: "Mit Hilfe" },
          { value: 5, label: "Selbständig" },
        ],
      },
      {
        key: "toilet",
        label: "Toilettenbenutzung",
        options: [
          { value: 0, label: "Nicht möglich" },
          { value: 5, label: "Mit Hilfe" },
          { value: 10, label: "Selbständig" },
        ],
      },
      {
        key: "bathing",
        label: "Baden / Duschen",
        options: [
          { value: 0, label: "Mit Hilfe" },
          { value: 5, label: "Selbständig" },
        ],
      },
      {
        key: "walking",
        label: "Aufstehen und Gehen (50 m)",
        options: [
          { value: 0, label: "Nicht möglich" },
          { value: 5, label: "Rollstuhl selbständig" },
          { value: 10, label: "Mit Hilfe / Gehhilfe" },
          { value: 15, label: "Selbständig" },
        ],
      },
      {
        key: "stairs",
        label: "Treppensteigen",
        options: [
          { value: 0, label: "Nicht möglich" },
          { value: 5, label: "Mit Hilfe" },
          { value: 10, label: "Selbständig" },
        ],
      },
      {
        key: "dressing",
        label: "An- und Auskleiden",
        options: [
          { value: 0, label: "Nicht möglich" },
          { value: 5, label: "Mit Hilfe" },
          { value: 10, label: "Selbständig" },
        ],
      },
      {
        key: "bowel",
        label: "Stuhlkontinenz",
        options: [
          { value: 0, label: "Inkontinent" },
          { value: 5, label: "Gelegentlich inkontinent" },
          { value: 10, label: "Kontinent" },
        ],
      },
      {
        key: "bladder",
        label: "Harnkontinenz",
        options: [
          { value: 0, label: "Inkontinent" },
          { value: 5, label: "Gelegentlich inkontinent" },
          { value: 10, label: "Kontinent" },
        ],
      },
    ],
    bands: [
      { min: 0, max: 30, level: "high", label: "Weitgehend pflegeabhängig", tone: "critical" },
      { min: 35, max: 80, level: "medium", label: "Hilfsbedürftig", tone: "attention" },
      { min: 85, max: 100, level: "none", label: "Punktuell hilfsbedürftig / selbständig", tone: "stable" },
    ],
    reassessDays: 90,
    core: true,
  },
  {
    code: "NRS",
    name: "Numerische Rating-Skala (Schmerz)",
    version: "1.0",
    category: "Schmerz",
    description:
      "Selbsteinschätzung der Schmerzintensität von 0 (kein Schmerz) bis 10 (stärkster vorstellbarer Schmerz).",
    items: [
      {
        key: "pain",
        label: "Aktuelle Schmerzintensität",
        options: Array.from({ length: 11 }, (_, i) => ({ value: i, label: String(i) })),
      },
    ],
    bands: [
      { min: 0, max: 0, level: "none", label: "Kein Schmerz", tone: "stable" },
      { min: 1, max: 3, level: "low", label: "Leichter Schmerz", tone: "stable" },
      { min: 4, max: 6, level: "medium", label: "Mittlerer Schmerz", tone: "attention" },
      { min: 7, max: 10, level: "high", label: "Starker Schmerz", tone: "critical" },
    ],
    reassessDays: 7,
    core: false,
  },
];

export const instrumentByCode = (code: string) => INSTRUMENTS.find((instrument) => instrument.code === code);

// Sums the chosen option values; every item must be answered with one of its options.
export function scoreAnswers(instrument: Instrument, answers: Record<string, unknown>) {
  let score = 0;
  for (const item of instrument.items) {
    const value = answers[item.key];
    if (typeof value !== "number" || !item.options.some((option) => option.value === value)) return null;
    score += value;
  }
  return score;
}

export function bandFor(instrument: Instrument, score: number) {
  return instrument.bands.find((band) => score >= band.min && score <= band.max) ?? null;
}
