"use client";

import { formatDateTime } from "@/app/components/workspace-ui";
import { formatVital, statusLabels, type Threshold, type VitalMeasurement, formatDecimal } from "@/lib/vitals-shared";

const WIDTH = 600;
const HEIGHT = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 44 };

// Measurements over time with the target range as a band and alarm limits as dashed lines.
export default function TrendChart({
  measurements,
  threshold,
  unit,
  label,
}: {
  measurements: VitalMeasurement[];
  threshold: Threshold | null;
  unit: string;
  label: string;
}) {
  if (!measurements.length) return <p className="list-hint">Keine Messungen im gewählten Zeitraum.</p>;
  const times = measurements.map((m) => Date.parse(m.measuredAt));
  const values = measurements.flatMap((m) => (m.secondary !== null ? [m.value, m.secondary] : [m.value]));
  const limits = threshold
    ? [threshold.targetLower, threshold.targetUpper, threshold.criticalLower, threshold.criticalUpper].filter(
        (v): v is number => v !== null,
      )
    : [];
  let min = Math.min(...values, ...limits);
  let max = Math.max(...values, ...limits);
  const padding = (max - min || Math.abs(max) || 1) * 0.12;
  min -= padding;
  max += padding;
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const x = (t: number) => PAD.left + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * (WIDTH - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * (HEIGHT - PAD.top - PAD.bottom);
  const line = (pick: (m: VitalMeasurement) => number | null) =>
    measurements
      .map((m) => ({ t: Date.parse(m.measuredAt), v: pick(m) }))
      .filter((p): p is { t: number; v: number } => p.v !== null)
      .map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`)
      .join(" ");
  const band =
    threshold && (threshold.targetLower !== null || threshold.targetUpper !== null)
      ? { top: y(threshold.targetUpper ?? max), bottom: y(threshold.targetLower ?? min) }
      : null;
  const ticks = [min + padding, (min + max) / 2, max - padding];
  const fmt = (v: number) => formatDecimal(v);
  const hasSecondary = measurements.some((m) => m.secondary !== null);

  return (
    <figure className="vital-chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${label}-Verlauf, ${measurements.length} Messungen`}
      >
        {band && (
          <rect
            className="vital-chart-band"
            x={PAD.left}
            y={band.top}
            width={WIDTH - PAD.left - PAD.right}
            height={Math.max(band.bottom - band.top, 1)}
          />
        )}
        {[threshold?.criticalLower, threshold?.criticalUpper].map(
          (limit, index) =>
            limit !== null &&
            limit !== undefined && (
              <line
                key={index}
                className="vital-chart-alarm"
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y(limit)}
                y2={y(limit)}
              />
            ),
        )}
        {ticks.map((tick) => (
          <text key={tick} className="vital-chart-axis" x={PAD.left - 8} y={y(tick) + 4} textAnchor="end">
            {fmt(tick)}
          </text>
        ))}
        <text className="vital-chart-axis" x={PAD.left} y={HEIGHT - 8}>
          {formatDateTime(new Date(t0).toISOString())}
        </text>
        {t1 !== t0 && (
          <text className="vital-chart-axis" x={WIDTH - PAD.right} y={HEIGHT - 8} textAnchor="end">
            {formatDateTime(new Date(t1).toISOString())}
          </text>
        )}
        {hasSecondary && <polyline className="vital-chart-line secondary" points={line((m) => m.secondary)} />}
        <polyline className="vital-chart-line" points={line((m) => m.value)} />
        {measurements.map((m) => (
          <circle
            key={m.id}
            className={`vital-chart-point ${m.status}`}
            cx={x(Date.parse(m.measuredAt))}
            cy={y(m.value)}
            r={5}
          >
            <title>
              {`${formatDateTime(m.measuredAt)}: ${formatVital(m.metric, m.value, m.secondary)} ${unit} · ${statusLabels[m.status]}`}
            </title>
          </circle>
        ))}
      </svg>
      <figcaption>
        <span>
          <i className="band" /> Zielbereich
        </span>
        <span>
          <i className="alarm" /> Alarmgrenze
        </span>
        {hasSecondary && (
          <span>
            <i className="secondary" /> diastolisch
          </span>
        )}
      </figcaption>
    </figure>
  );
}
