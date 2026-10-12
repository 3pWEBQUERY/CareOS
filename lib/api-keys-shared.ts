// Berechtigungen eines Schnittstellen-Schlüssels (FHIR R4, nur lesend), benannt wie SMART-on-FHIR-Scopes.
export const API_SCOPES = {
  "system/Patient.read": "Personen (Name, Geburtsdatum, Geschlecht, Status)",
  "system/Observation.read": "Vitalwerte",
} as const;

export type ApiScope = keyof typeof API_SCOPES;
export const API_SCOPE_KEYS = Object.keys(API_SCOPES) as ApiScope[];
export const API_KEYS_MAX = 20;

export type ApiKeySummary = {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  createdAt: string;
  createdBy: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
};
