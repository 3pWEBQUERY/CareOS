// Temperaturprotokoll Medikamentenkühlschrank (Server und Oberfläche). Grenzen und Messrhythmus legt die Einrichtung
// je Kühlschrank fest; ohne Vorgabe zeigt CareOS keinen Hinweis.

export type FridgeReading = {
  id: string;
  measuredAt: string;
  celsius: number;
  // Grenzen der Einrichtung zum Zeitpunkt der Messung.
  minCelsius: number | null;
  maxCelsius: number | null;
  outside: boolean;
  note: string;
  recordedBy: string | null;
};

export type Fridge = {
  id: string;
  name: string;
  location: string;
  minCelsius: number | null;
  maxCelsius: number | null;
  intervalHours: number | null;
  notes: string;
  retired: { at: string; reason: string } | null;
  lastReading: FridgeReading | null;
  // Messung fällig: Messrhythmus festgelegt und letzte Messung älter (oder noch keine).
  due: boolean;
  // Messungen der letzten 31 Tage, neueste zuerst.
  readings: FridgeReading[];
};

export type FridgeOverview = { canManage: boolean; canRecord: boolean; fridges: Fridge[] };

export const formatCelsius = (value: number) =>
  `${value.toLocaleString("de-CH", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`;

// Grenzen lesbar ("2.0 bis 8.0 °C", "ab 2.0 °C", "bis 8.0 °C"); null ohne Vorgabe.
export function fridgeRange(min: number | null, max: number | null) {
  if (min !== null && max !== null) return `${formatCelsius(min).replace(" °C", "")} bis ${formatCelsius(max)}`;
  if (min !== null) return `ab ${formatCelsius(min)}`;
  if (max !== null) return `bis ${formatCelsius(max)}`;
  return null;
}
