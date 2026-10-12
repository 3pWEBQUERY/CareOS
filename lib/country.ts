// Land der Einrichtung: bestimmt die gesetzliche Einstufung des Pflegebedarfs, die Sozialversicherungsnummer, die
// Bezeichnung der Versicherung, die Feiertage für den Dienstplan und die vorgeschlagenen Qualifikationen.
// Quellen sind die genannten Gesetze; CareOS stuft nicht selbst ein, die Einstufung erfasst die Einrichtung.

export const COUNTRY_CODES = ["CH", "DE", "AT"] as const;
export type CountryCode = (typeof COUNTRY_CODES)[number];
export const DEFAULT_COUNTRY: CountryCode = "CH";

export type CareLevelOption = { value: string; detail: string };
export type CountryQualification = { code: string; name: string; grantsMedication: boolean };

export type CountryProfile = {
  code: CountryCode;
  name: string;
  careLevels: {
    // Bezeichnung einer Stufe in Formularen („Pflegestufe“, „Pflegegrad“, „Pflegegeldstufe“).
    label: string;
    plural: string;
    system: string;
    basis: string;
    assessment: string;
    unit: string;
    levels: CareLevelOption[];
  };
  socialNumber: { label: string; placeholder: string; format: string };
  insurance: { insurerLabel: string; numberLabel: string; numberPlaceholder: string };
  // Kanton bzw. Bundesland: bestimmt die Feiertage, die der Dienstplan übernimmt.
  region: { label: string; options: Array<{ code: string; name: string }> };
  qualifications: CountryQualification[];
  // Beispiele für die Hinweise zum Medikationsrecht.
  medicationExamples: string;
};

const range = (count: number, detail: (index: number) => string, label: string) =>
  Array.from({ length: count }, (_, index) => ({ value: `${label} ${index + 1}`, detail: detail(index + 1) }));

export const COUNTRIES: Record<CountryCode, CountryProfile> = {
  CH: {
    code: "CH",
    name: "Schweiz",
    careLevels: {
      label: "Pflegestufe",
      plural: "Pflegestufen",
      system: "12 Pflegestufen nach Pflegebedarf in Minuten pro Tag",
      basis: "KVG Art. 25a, KLV Art. 7a Abs. 3",
      assessment:
        "Bedarfsabklärung durch das Pflegeheim mit einem vom Kanton anerkannten Instrument (z. B. BESA oder RAI-NH); " +
        "die Krankenversicherung zahlt den Beitrag je Stufe.",
      unit: "Minuten Pflege pro Tag",
      levels: range(
        12,
        (n) =>
          n === 1 ? "bis 20 Minuten" : n === 12 ? "mehr als 220 Minuten" : `${(n - 1) * 20 + 1} bis ${n * 20} Minuten`,
        "Pflegestufe",
      ),
    },
    socialNumber: { label: "AHV-Nummer", placeholder: "756.XXXX.XXXX.XX", format: "756.XXXX.XXXX.XX" },
    insurance: { insurerLabel: "Krankenversicherung", numberLabel: "Versichertennummer", numberPlaceholder: "" },
    region: {
      label: "Kanton",
      options: [
        { code: "AG", name: "Aargau" },
        { code: "AI", name: "Appenzell Innerrhoden" },
        { code: "AR", name: "Appenzell Ausserrhoden" },
        { code: "BE", name: "Bern" },
        { code: "BL", name: "Basel-Landschaft" },
        { code: "BS", name: "Basel-Stadt" },
        { code: "FR", name: "Freiburg" },
        { code: "GE", name: "Genf" },
        { code: "GL", name: "Glarus" },
        { code: "GR", name: "Graubünden" },
        { code: "JU", name: "Jura" },
        { code: "LU", name: "Luzern" },
        { code: "NE", name: "Neuenburg" },
        { code: "NW", name: "Nidwalden" },
        { code: "OW", name: "Obwalden" },
        { code: "SG", name: "St. Gallen" },
        { code: "SH", name: "Schaffhausen" },
        { code: "SO", name: "Solothurn" },
        { code: "SZ", name: "Schwyz" },
        { code: "TG", name: "Thurgau" },
        { code: "TI", name: "Tessin" },
        { code: "UR", name: "Uri" },
        { code: "VD", name: "Waadt" },
        { code: "VS", name: "Wallis" },
        { code: "ZG", name: "Zug" },
        { code: "ZH", name: "Zürich" },
      ],
    },
    qualifications: [
      { code: "HF", name: "Pflegefachperson HF", grantsMedication: true },
      { code: "FAGE", name: "Fachperson Gesundheit", grantsMedication: true },
      { code: "SRK", name: "Pflegehelfer:in SRK", grantsMedication: false },
    ],
    medicationExamples: "HF, FaGe",
  },
  DE: {
    code: "DE",
    name: "Deutschland",
    careLevels: {
      label: "Pflegegrad",
      plural: "Pflegegrade",
      system: "5 Pflegegrade nach Gesamtpunkten des Begutachtungsinstruments (0 bis 100 Punkte)",
      basis: "SGB XI §§ 14, 15",
      assessment:
        "Begutachtung durch den Medizinischen Dienst (bei Privatversicherten Medicproof); den Pflegegrad legt die " +
        "Pflegekasse mit Bescheid fest.",
      unit: "Gesamtpunkte",
      levels: [
        { value: "Pflegegrad 1", detail: "12,5 bis unter 27 Punkte – geringe Beeinträchtigung der Selbständigkeit" },
        { value: "Pflegegrad 2", detail: "27 bis unter 47,5 Punkte – erhebliche Beeinträchtigung der Selbständigkeit" },
        { value: "Pflegegrad 3", detail: "47,5 bis unter 70 Punkte – schwere Beeinträchtigung der Selbständigkeit" },
        { value: "Pflegegrad 4", detail: "70 bis unter 90 Punkte – schwerste Beeinträchtigung der Selbständigkeit" },
        {
          value: "Pflegegrad 5",
          detail:
            "90 bis 100 Punkte – schwerste Beeinträchtigung mit besonderen Anforderungen an die pflegerische Versorgung",
        },
      ],
    },
    socialNumber: { label: "Sozialversicherungsnummer", placeholder: "12 010150 M 123", format: "12 TTMMJJ B 123" },
    insurance: {
      insurerLabel: "Kranken- und Pflegekasse",
      numberLabel: "Krankenversichertennummer",
      numberPlaceholder: "A123456789",
    },
    region: {
      label: "Bundesland",
      options: [
        { code: "BW", name: "Baden-Württemberg" },
        { code: "BY", name: "Bayern" },
        { code: "BE", name: "Berlin" },
        { code: "BB", name: "Brandenburg" },
        { code: "HB", name: "Bremen" },
        { code: "HH", name: "Hamburg" },
        { code: "HE", name: "Hessen" },
        { code: "MV", name: "Mecklenburg-Vorpommern" },
        { code: "NI", name: "Niedersachsen" },
        { code: "NW", name: "Nordrhein-Westfalen" },
        { code: "RP", name: "Rheinland-Pfalz" },
        { code: "SL", name: "Saarland" },
        { code: "SN", name: "Sachsen" },
        { code: "ST", name: "Sachsen-Anhalt" },
        { code: "SH", name: "Schleswig-Holstein" },
        { code: "TH", name: "Thüringen" },
      ],
    },
    qualifications: [
      { code: "PFK", name: "Pflegefachfrau/Pflegefachmann", grantsMedication: true },
      { code: "AP", name: "Altenpfleger:in", grantsMedication: true },
      { code: "GKP", name: "Gesundheits- und Krankenpfleger:in", grantsMedication: true },
      { code: "PH", name: "Pflegehelfer:in / Altenpflegehelfer:in", grantsMedication: false },
      { code: "BK", name: "Zusätzliche Betreuungskraft", grantsMedication: false },
    ],
    medicationExamples: "Pflegefachfrau/-mann, Altenpfleger:in",
  },
  AT: {
    code: "AT",
    name: "Österreich",
    careLevels: {
      label: "Pflegegeldstufe",
      plural: "Pflegegeldstufen",
      system: "7 Pflegegeldstufen nach Pflegebedarf in Stunden pro Monat",
      basis: "Bundespflegegeldgesetz (BPGG) § 4",
      assessment:
        "Begutachtung durch ärztliche oder pflegerische Sachverständige im Auftrag des Entscheidungsträgers " +
        "(z. B. Pensionsversicherungsanstalt), der die Stufe mit Bescheid festlegt.",
      unit: "Stunden Pflegebedarf pro Monat",
      levels: [
        { value: "Pflegegeldstufe 1", detail: "mehr als 65 Stunden" },
        { value: "Pflegegeldstufe 2", detail: "mehr als 95 Stunden" },
        { value: "Pflegegeldstufe 3", detail: "mehr als 120 Stunden" },
        { value: "Pflegegeldstufe 4", detail: "mehr als 160 Stunden" },
        { value: "Pflegegeldstufe 5", detail: "mehr als 180 Stunden und außergewöhnlicher Pflegeaufwand" },
        {
          value: "Pflegegeldstufe 6",
          detail:
            "mehr als 180 Stunden und zeitlich unkoordinierbare Betreuungsmaßnahmen bei Tag und Nacht oder dauernde " +
            "Anwesenheit einer Pflegeperson wegen Eigen- oder Fremdgefährdung",
        },
        {
          value: "Pflegegeldstufe 7",
          detail:
            "mehr als 180 Stunden und keine zielgerichteten Bewegungen der vier Extremitäten mit funktioneller " +
            "Umsetzung möglich oder ein gleichzuachtender Zustand",
        },
      ],
    },
    socialNumber: { label: "Sozialversicherungsnummer", placeholder: "1234 010150", format: "XXXX TTMMJJ" },
    insurance: { insurerLabel: "Krankenversicherungsträger", numberLabel: "Versichertennummer", numberPlaceholder: "" },
    region: {
      label: "Bundesland",
      options: [
        { code: "1", name: "Burgenland" },
        { code: "2", name: "Kärnten" },
        { code: "3", name: "Niederösterreich" },
        { code: "4", name: "Oberösterreich" },
        { code: "5", name: "Salzburg" },
        { code: "6", name: "Steiermark" },
        { code: "7", name: "Tirol" },
        { code: "8", name: "Vorarlberg" },
        { code: "9", name: "Wien" },
      ],
    },
    qualifications: [
      { code: "DGKP", name: "Diplomierte Gesundheits- und Krankenpflegeperson", grantsMedication: true },
      { code: "PFA", name: "Pflegefachassistenz", grantsMedication: true },
      { code: "PA", name: "Pflegeassistenz", grantsMedication: false },
      { code: "FSBA", name: "Fach-Sozialbetreuer:in Altenarbeit", grantsMedication: false },
      { code: "HH", name: "Heimhilfe", grantsMedication: false },
    ],
    medicationExamples: "DGKP, PFA",
  },
};

// Name des Kantons bzw. Bundeslandes, null ohne (gültige) Auswahl.
export const regionName = (country: CountryCode, region: string | null | undefined) =>
  COUNTRIES[country].region.options.find((option) => option.code === region)?.name ?? null;

// Bezeichnung der Feiertage für Hinweise, z. B. „Kanton Zürich“, „Bayern“ oder „Österreich (landesweit)“.
export function holidaySource(country: CountryCode, region: string | null | undefined) {
  const name = regionName(country, region);
  if (!name) return `${COUNTRIES[country].name} (landesweit)`;
  return country === "CH" ? `Kanton ${name}` : name;
}

export const NOT_ASSESSED = "Noch nicht eingestuft";

export function countryCode(value: unknown): CountryCode {
  return COUNTRY_CODES.includes(value as CountryCode) ? (value as CountryCode) : DEFAULT_COUNTRY;
}

export const countryProfile = (value: unknown) => COUNTRIES[countryCode(value)];

// Auswahl für Formulare: die Stufen des Landes, dazu ein bereits gespeicherter Wert aus einem anderen System
// (z. B. nach einem Wechsel des Landes), damit er beim Bearbeiten nicht verloren geht.
export function careLevelOptions(country: CountryCode, current?: string | null) {
  const values = COUNTRIES[country].careLevels.levels.map((level) => level.value);
  return current && current !== NOT_ASSESSED && !values.includes(current) ? [current, ...values] : values;
}

// Gilt der Wert als Einstufung des Landes? (Leer bzw. „Noch nicht eingestuft“ gilt immer.)
export function isCareLevel(country: CountryCode, value: string | null | undefined) {
  return (
    !value || value === NOT_ASSESSED || COUNTRIES[country].careLevels.levels.some((level) => level.value === value)
  );
}

export const careLevelError = (country: CountryCode) =>
  country === "DE"
    ? "Bitte einen gültigen Pflegegrad wählen."
    : `Bitte eine gültige ${COUNTRIES[country].careLevels.label} wählen.`;

// Prüft die Sozialversicherungsnummer im Format des Landes; gibt eine Fehlermeldung oder null zurück.
export function socialNumberError(country: CountryCode, value: string): string | null {
  const compact = value.replace(/[\s.]/g, "").toUpperCase();
  if (country === "CH") return /^756\d{10}$/.test(compact) ? null : "Die AHV-Nummer hat das Format 756.XXXX.XXXX.XX.";
  if (country === "DE")
    return /^\d{8}[A-Z]\d{3}$/.test(compact)
      ? null
      : "Die Sozialversicherungsnummer hat das Format 12 TTMMJJ B 123 (12 Zeichen, ein Buchstabe).";
  // Österreich: 10 Ziffern, die vierte ist die Prüfziffer (gewichtete Summe der übrigen modulo 11).
  if (!/^\d{10}$/.test(compact)) return "Die Sozialversicherungsnummer hat 10 Ziffern (XXXX TTMMJJ).";
  const weights = [3, 7, 9, 0, 5, 8, 4, 2, 1, 6];
  const sum = weights.reduce((total, weight, index) => total + weight * Number(compact[index]), 0);
  return sum % 11 === Number(compact[3]) ? null : "Die Prüfziffer der Sozialversicherungsnummer stimmt nicht.";
}

export function insuranceNumberError(country: CountryCode, value: string): string | null {
  if (country !== "DE") return null;
  return /^[A-Z]\d{9}$/.test(value.replace(/\s/g, "").toUpperCase())
    ? null
    : "Die Krankenversichertennummer hat das Format A123456789 (ein Buchstabe, 9 Ziffern).";
}
