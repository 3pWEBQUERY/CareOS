// Geräte und Hilfsmittel der Einrichtung mit Prüfungen (Server und Oberfläche). Fristen legt die Einrichtung bzw. der
// Hersteller fest.

export const DEVICE_CHECK_RESULTS = { ok: "In Ordnung", defect: "Mängel" } as const;
export type DeviceCheckResult = keyof typeof DEVICE_CHECK_RESULTS;

export type DeviceCheck = {
  id: string;
  checkedOn: string;
  result: DeviceCheckResult;
  findings: string;
  performedBy: string;
  nextDueOn: string | null;
  recordedBy: string | null;
};

export type Device = {
  id: string;
  name: string;
  category: string;
  inventoryNumber: string;
  manufacturer: string;
  location: string;
  intervalMonths: number | null;
  nextDueOn: string | null;
  // Fällig: nächste Prüfung heute oder früher.
  due: boolean;
  notes: string;
  retired: { at: string; reason: string } | null;
  lastCheck: DeviceCheck | null;
  checks: DeviceCheck[];
};

export type DeviceOverview = { canWrite: boolean; today: string; devices: Device[]; categories: string[] };
