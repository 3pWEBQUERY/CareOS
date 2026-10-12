// Impfungen (Server und Oberfläche): dokumentiert, was gegeben wurde. Keine Empfehlungen, keine Fristen.

export const VACCINATION_PLACES = { inhouse: "Im Haus", external: "Extern (z. B. Praxis, Spital)" } as const;
export type VaccinationPlace = keyof typeof VACCINATION_PLACES;

export type Vaccination = {
  id: string;
  givenOn: string;
  target: string;
  vaccine: string;
  lot: string;
  place: VaccinationPlace;
  givenBy: string;
  note: string;
  recordedBy: string | null;
};

export type VaccinationList = {
  residentId: string;
  canWrite: boolean;
  vaccinations: Vaccination[];
  // Bereits verwendete Bezeichnungen „Impfung gegen“ der Einrichtung, zur Auswahl.
  targets: string[];
};

export type VaccinationOverview = {
  target: string;
  since: string | null;
  targets: string[];
  units: Array<{
    id: string;
    name: string;
    residents: Array<{ id: string; name: string; room: string; lastGivenOn: string | null }>;
  }>;
};
