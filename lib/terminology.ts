// Bezeichnung der betreuten Personen je Einrichtung (Bewohner / Patient / Klient). Die Wortformen sind
// ausdrücklich angegeben, weil „Bewohner“ in Einzahl und Mehrzahl gleich lautet, „Patient/Patienten“ nicht.

export type Terms = {
  label: string;
  // Einzahl Nominativ („der Patient“), Akkusativ/Dativ („den Patienten“) und Genitiv („des Bewohners“).
  one: string;
  oneOblique: string;
  oneGenitive: string;
  // Einzahl weiblich („die Patientin“).
  oneFemale: string;
  // Mehrzahl („die Patienten“) und Mehrzahl Dativ („mit den Bewohnern“).
  many: string;
  manyDative: string;
  // Wortanfang in Zusammensetzungen („Patientenakte“).
  prefix: string;
};

export const TERMINOLOGIES = {
  resident: {
    label: "Bewohner",
    one: "Bewohner",
    oneOblique: "Bewohner",
    oneGenitive: "Bewohners",
    oneFemale: "Bewohnerin",
    many: "Bewohner",
    manyDative: "Bewohnern",
    prefix: "Bewohner",
  },
  patient: {
    label: "Patient",
    one: "Patient",
    oneOblique: "Patienten",
    oneGenitive: "Patienten",
    oneFemale: "Patientin",
    many: "Patienten",
    manyDative: "Patienten",
    prefix: "Patienten",
  },
  client: {
    label: "Klient",
    one: "Klient",
    oneOblique: "Klienten",
    oneGenitive: "Klienten",
    oneFemale: "Klientin",
    many: "Klienten",
    manyDative: "Klienten",
    prefix: "Klienten",
  },
} as const satisfies Record<string, Terms>;

export type TerminologyKey = keyof typeof TERMINOLOGIES;
export const DEFAULT_TERMINOLOGY: TerminologyKey = "resident";

export const resolveTerminology = (value: unknown): TerminologyKey =>
  typeof value === "string" && value in TERMINOLOGIES ? (value as TerminologyKey) : DEFAULT_TERMINOLOGY;

export const termsFor = (value: unknown): Terms => TERMINOLOGIES[resolveTerminology(value)];

// „1 Bewohner“, „3 Patienten“.
export const countOf = (count: number, terms: Terms) => `${count} ${count === 1 ? terms.one : terms.many}`;

// Beschriftungen der Navigation, die die Bezeichnung enthalten (die Beschriftung bleibt intern der Schlüssel).
export function navigationLabel(label: string, terms: Terms) {
  if (terms === TERMINOLOGIES.resident) return label;
  switch (label) {
    case "Bewohner":
      return terms.many;
    case "Bewohner & Pflege":
      return `${terms.many} & Pflege`;
    case "Kennzahlen Bewohner":
      return `Kennzahlen ${terms.many}`;
    case "Bewohnerakte":
      return `${terms.prefix}akte`;
    case "Bewohnergelder":
      return `${terms.prefix}gelder`;
    default:
      return label;
  }
}
