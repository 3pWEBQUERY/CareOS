// Diagnosen je Person (Server und Oberfläche): wie von Ärztin/Arzt gestellt, mit Quelle. CareOS stellt keine
// Diagnosen und prüft den freiwilligen ICD-10-Code nur auf seine Form.

export const DIAGNOSIS_KINDS = { main: "Hauptdiagnose", secondary: "Nebendiagnose" } as const;
export type DiagnosisKind = keyof typeof DIAGNOSIS_KINDS;
export const DIAGNOSIS_STATUSES = { current: "Aktuell", resolved: "Abgeschlossen" } as const;
export type DiagnosisStatus = keyof typeof DIAGNOSIS_STATUSES;

// Form eines ICD-10-Codes (WHO bzw. ICD-10-GM): Buchstabe, zwei Ziffern, optional Punkt mit Unterteilung und
// Zusatzkennzeichen (z. B. „F03“, „I63.5“, „G30.1+“, „F02.0*“, „Z74.1!“).
export const ICD_CODE = /^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?[+*!†#]?$/;

export type Diagnosis = {
  id: string;
  label: string;
  icdCode: string;
  kind: DiagnosisKind;
  sinceOn: string | null;
  source: string;
  status: DiagnosisStatus;
  resolvedOn: string | null;
  note: string;
  updatedAt: string;
  updatedBy: string | null;
};

export type DiagnosisList = { residentId: string; canWrite: boolean; diagnoses: Diagnosis[] };

// Kurzform für Listen und Druck: „Demenz bei Alzheimer-Krankheit (G30.1+, F00.1*)“.
export const diagnosisText = (diagnosis: Pick<Diagnosis, "label" | "icdCode">) =>
  diagnosis.icdCode ? `${diagnosis.label} (${diagnosis.icdCode})` : diagnosis.label;
