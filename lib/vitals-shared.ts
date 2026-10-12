// Vital sign definitions shared by the API and the client workspace.

export type VitalStatus = "normal" | "attention" | "critical";

export type Threshold = {
  targetLower: number | null;
  targetUpper: number | null;
  criticalLower: number | null;
  criticalUpper: number | null;
};

export type VitalMetric = {
  key: string;
  short: string;
  unit: string;
  step: number;
  // Values outside this range are rejected as implausible (typing errors).
  plausible: [number, number];
  secondary?: { label: string; plausible: [number, number] };
  // Starting point until the organization defines its own thresholds.
  defaults: Threshold | null;
};

export const VITAL_METRICS: VitalMetric[] = [
  {
    key: "Blutdruck",
    short: "BD",
    unit: "mmHg",
    step: 1,
    plausible: [50, 260],
    secondary: { label: "diastolisch", plausible: [30, 160] },
    defaults: { targetLower: 100, targetUpper: 140, criticalLower: 90, criticalUpper: 180 },
  },
  {
    key: "Puls",
    short: "Puls",
    unit: "/min",
    step: 1,
    plausible: [20, 250],
    defaults: { targetLower: 60, targetUpper: 100, criticalLower: 45, criticalUpper: 130 },
  },
  {
    key: "Temperatur",
    short: "Temp.",
    unit: "°C",
    step: 0.1,
    plausible: [30, 43],
    defaults: { targetLower: 36, targetUpper: 37.5, criticalLower: 35, criticalUpper: 38.5 },
  },
  {
    key: "Sauerstoffsättigung",
    short: "SpO₂",
    unit: "%",
    step: 1,
    plausible: [50, 100],
    defaults: { targetLower: 94, targetUpper: null, criticalLower: 90, criticalUpper: null },
  },
  {
    key: "Blutzucker",
    short: "BZ",
    unit: "mmol/l",
    step: 0.1,
    plausible: [1, 35],
    defaults: { targetLower: 4, targetUpper: 10, criticalLower: 3.5, criticalUpper: 20 },
  },
  { key: "Gewicht", short: "Gewicht", unit: "kg", step: 0.1, plausible: [20, 250], defaults: null },
];

export const metricByKey = (key: string) => VITAL_METRICS.find((metric) => metric.key === key);

// Blood pressure is judged by the systolic value.
export function evaluateVital(value: number, threshold: Threshold | null): VitalStatus {
  if (!threshold) return "normal";
  const below = (limit: number | null) => limit !== null && value < limit;
  const above = (limit: number | null) => limit !== null && value > limit;
  if (below(threshold.criticalLower) || above(threshold.criticalUpper)) return "critical";
  if (below(threshold.targetLower) || above(threshold.targetUpper)) return "attention";
  return "normal";
}

export const statusLabels: Record<VitalStatus, string> = {
  normal: "Im Zielbereich",
  attention: "Beobachten",
  critical: "Kritisch",
};

export const statusTone: Record<VitalStatus, "stable" | "attention" | "critical"> = {
  normal: "stable",
  attention: "attention",
  critical: "critical",
};

export type ThresholdSource = "resident" | "organization" | "default" | "none";

export type EffectiveThreshold = Threshold & { id: string | null; source: ThresholdSource; reason: string | null };

export type LatestVital = {
  value: number;
  secondary: number | null;
  status: VitalStatus;
  measuredAt: string;
};

export type VitalResident = {
  id: string;
  name: string;
  initials: string;
  room: string;
  careUnit: string;
  careUnitId: string | null;
  latest: Record<string, LatestVital>;
  status: VitalStatus | null;
  lastMeasuredAt: string | null;
};

export type VitalMeasurement = {
  id: string;
  metric: string;
  value: number;
  secondary: number | null;
  unit: string;
  status: VitalStatus;
  measuredAt: string;
  measuredBy: string | null;
  note: string | null;
};

export type ThresholdRow = EffectiveThreshold & {
  metric: string;
  residentId: string | null;
  residentName: string | null;
};

// Clinical values use a decimal comma like the rest of CareOS (de-CH would print "36.8").
export function formatDecimal(value: number, digits: { min?: number; max?: number } = {}) {
  return value.toLocaleString("de-DE", {
    minimumFractionDigits: digits.min ?? 0,
    maximumFractionDigits: digits.max ?? 1,
    useGrouping: false,
  });
}

export function formatVital(metric: string, value: number, secondary: number | null) {
  const definition = metricByKey(metric);
  const digits = definition && definition.step < 1 ? 1 : 0;
  const format = (n: number) => formatDecimal(n, { min: digits, max: digits });
  return secondary !== null ? `${format(value)}/${format(secondary)}` : format(value);
}

export function formatRange(threshold: Threshold | null, unit: string) {
  if (!threshold) return "Kein Grenzwert";
  const f = (n: number) => formatDecimal(n);
  const range = (lower: number | null, upper: number | null) =>
    lower !== null && upper !== null
      ? `${f(lower)}–${f(upper)}`
      : lower !== null
        ? `ab ${f(lower)}`
        : upper !== null
          ? `bis ${f(upper)}`
          : "–";
  return `${range(threshold.targetLower, threshold.targetUpper)} ${unit}`;
}
