"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "@phosphor-icons/react";
import { CareOptionSelect } from "@/app/components/care-form-controls";
import { areaName, parseArea, type Area } from "@/lib/office/formula";
import {
  PIVOT_FUNCTIONS,
  nameProblem,
  type ChartType,
  type PivotFunction,
  type PrintSetup,
  type RuleOp,
  type RuleStyle,
  type SheetChart,
  type SheetName,
  type SheetPivot,
  type SheetRule,
} from "@/lib/office/model";
import {
  BAR_PRESETS,
  CHART_COLORS,
  CHART_LABELS,
  RULE_LABELS,
  RULE_NEEDS,
  RULE_PRESETS,
  SCALE_PRESETS,
  type ChartData,
  type FindOptions,
} from "@/lib/office/sheet-features";

// Bausteine der Tabelle neben dem Raster: Diagramm, Dialoge (bedingte Formatierung, Auswahlliste, Diagramm),
// Suchen und Ersetzen sowie das Filter-Menü im Spaltenkopf.

const MENU_Z = 1360;
const normalizeRange = (text: string) => {
  const area = parseArea(text.trim().toUpperCase().replace(/\$/g, ""));
  return area ? areaName(area) : null;
};

// ---------- Diagramm ----------

const nice = (value: number) => {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const fraction = value / power;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
};
const short = (value: number) =>
  Math.abs(value) >= 1_000_000
    ? `${Number((value / 1_000_000).toPrecision(3))} Mio.`
    : new Intl.NumberFormat("de-CH", { maximumFractionDigits: 2 }).format(value).replace(/['’]/g, "’");
const clipLabel = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function ChartSvg({
  data,
  type,
  title,
  width,
  height,
  xTitle = "",
  yTitle = "",
  labels = false,
}: {
  data: ChartData;
  type: ChartType;
  title: string;
  width: number;
  height: number;
  xTitle?: string;
  yTitle?: string;
  labels?: boolean;
}) {
  // Achsentitel: bei Balken liegt die Kategorienachse links, die Werteachse unten.
  const horizontalTitle = type === "pie" ? "" : type === "bar" ? yTitle : xTitle;
  const verticalTitle = type === "pie" ? "" : type === "bar" ? xTitle : yTitle;
  const top = title ? 34 : 12;
  const legendItems = type === "pie" ? data.categories : data.series.map((item) => item.name);
  const legend = legendItems.length > 1 || type === "pie" ? 26 : 0;
  const empty = !data.series.length || !data.categories.length;
  const body = (() => {
    if (empty)
      return (
        <text x={width / 2} y={height / 2} textAnchor="middle" className="sheet-chart-empty">
          Keine Zahlen im Bereich
        </text>
      );
    if (type === "pie") {
      const values = data.series[0].values.map((value) => Math.max(0, value));
      const total = values.reduce((a, b) => a + b, 0);
      const radius = Math.max(10, Math.min(width - 24, height - top - legend - 12) / 2);
      const cx = width / 2;
      const cy = top + (height - top - legend) / 2;
      if (!total) return <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#cbd5e1" strokeDasharray="4 4" />;
      let angle = -Math.PI / 2;
      return values.map((value, index) => {
        const sweep = (value / total) * Math.PI * 2;
        const start = angle;
        angle += sweep;
        const color = CHART_COLORS[index % CHART_COLORS.length];
        if (value === total) return <circle key={index} cx={cx} cy={cy} r={radius} fill={color} />;
        const x1 = cx + radius * Math.cos(start);
        const y1 = cy + radius * Math.sin(start);
        const x2 = cx + radius * Math.cos(angle);
        const y2 = cy + radius * Math.sin(angle);
        const middle = start + sweep / 2;
        return (
          <g key={index}>
            <path
              d={`M${cx},${cy} L${x1},${y1} A${radius},${radius} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2},${y2} Z`}
              fill={color}
              stroke="white"
              strokeWidth={1.5}
            >
              <title>{`${data.categories[index]}: ${short(value)}`}</title>
            </path>
            {sweep > 0.35 && (
              <text
                x={cx + radius * 0.62 * Math.cos(middle)}
                y={cy + radius * 0.62 * Math.sin(middle) + 4}
                textAnchor="middle"
                className="sheet-chart-slice"
              >
                {labels ? short(value) : `${Math.round((value / total) * 100)}%`}
              </text>
            )}
          </g>
        );
      });
    }
    const all = data.series.flatMap((item) => item.values);
    let max = Math.max(0, ...all);
    let min = Math.min(0, ...all);
    if (max === min) max = min + 1;
    const step = nice((max - min) / 5);
    max = Math.ceil(max / step) * step;
    min = Math.floor(min / step) * step;
    const ticks: number[] = [];
    for (let value = min; value <= max + step / 2; value += step) ticks.push(Number(value.toPrecision(12)));
    const horizontal = type === "bar";
    const labelWidth = horizontal
      ? Math.min(110, 8 + 6.5 * Math.max(...data.categories.map((item) => clipLabel(item, 16).length)))
      : Math.min(70, 10 + 6.5 * Math.max(...ticks.map((tick) => short(tick).length)));
    const left = labelWidth + 6 + (verticalTitle ? 18 : 0);
    const right = width - 14;
    const bottom = height - legend - (horizontal ? 22 : 24) - (horizontalTitle ? 18 : 0);
    const plotW = Math.max(10, right - left);
    const plotH = Math.max(10, bottom - top);
    const scale = (value: number) => (value - min) / (max - min);
    const count = data.categories.length;
    const band = (horizontal ? plotH : plotW) / count;
    const grid = ticks.map((tick) => {
      const at = horizontal ? left + scale(tick) * plotW : bottom - scale(tick) * plotH;
      return (
        <g key={`t${tick}`}>
          {horizontal ? (
            <line x1={at} x2={at} y1={top} y2={bottom} className="sheet-chart-grid" />
          ) : (
            <line x1={left} x2={right} y1={at} y2={at} className="sheet-chart-grid" />
          )}
          <text
            x={horizontal ? at : left - 6}
            y={horizontal ? bottom + 15 : at + 4}
            textAnchor={horizontal ? "middle" : "end"}
            className="sheet-chart-axis"
          >
            {short(tick)}
          </text>
        </g>
      );
    });
    const labelEvery = Math.max(1, Math.ceil(count / Math.max(1, Math.floor((horizontal ? plotH : plotW) / 46))));
    const categoryLabels = data.categories.map((category, index) =>
      index % labelEvery ? null : (
        <text
          key={`c${index}`}
          x={horizontal ? left - 6 : left + band * (index + 0.5)}
          y={horizontal ? top + band * (index + 0.5) + 4 : bottom + 16}
          textAnchor={horizontal ? "end" : "middle"}
          className="sheet-chart-axis"
        >
          {clipLabel(category, horizontal ? 16 : Math.max(4, Math.floor((band * labelEvery) / 7)))}
        </text>
      ),
    );
    const zero = scale(0);
    let marks: ReactNode;
    if (type === "line") {
      marks = data.series.map((item, s) => {
        const color = CHART_COLORS[s % CHART_COLORS.length];
        const points = item.values.map((value, index) => [left + band * (index + 0.5), bottom - scale(value) * plotH]);
        return (
          <g key={`s${s}`}>
            <polyline
              points={points.map((point) => point.join(",")).join(" ")}
              fill="none"
              stroke={color}
              strokeWidth={2.5}
            />
            {points.map(([x, y], index) => (
              <circle key={index} cx={x} cy={y} r={3.5} fill={color}>
                <title>{`${item.name} – ${data.categories[index]}: ${short(item.values[index])}`}</title>
              </circle>
            ))}
            {labels &&
              points.map(([x, y], index) => (
                <text key={`l${index}`} x={x} y={y - 8} textAnchor="middle" className="sheet-chart-label">
                  {short(item.values[index])}
                </text>
              ))}
          </g>
        );
      });
    } else {
      const groups = data.series.length;
      const inner = band * 0.72;
      const size = inner / groups;
      marks = data.series.map((item, s) =>
        item.values.map((value, index) => {
          const color = CHART_COLORS[s % CHART_COLORS.length];
          const offset = band * index + (band - inner) / 2 + size * s;
          const a = scale(Math.min(0, value));
          const b = scale(Math.max(0, value));
          const box = horizontal
            ? {
                x: left + a * plotW,
                y: top + offset,
                width: Math.max(0, (b - a) * plotW),
                height: Math.max(1, size - 2),
              }
            : {
                x: left + offset,
                y: bottom - b * plotH,
                width: Math.max(1, size - 2),
                height: Math.max(0, (b - a) * plotH),
              };
          return (
            <g key={`${s}-${index}`}>
              <rect {...box} fill={color} rx={1.5}>
                <title>{`${item.name} – ${data.categories[index]}: ${short(value)}`}</title>
              </rect>
              {labels && (
                <text
                  x={horizontal ? (value < 0 ? box.x - 4 : box.x + box.width + 4) : box.x + box.width / 2}
                  y={horizontal ? box.y + box.height / 2 + 4 : value < 0 ? box.y + box.height + 12 : box.y - 4}
                  textAnchor={horizontal ? (value < 0 ? "end" : "start") : "middle"}
                  className="sheet-chart-label"
                >
                  {short(value)}
                </text>
              )}
            </g>
          );
        }),
      );
    }
    return (
      <>
        {grid}
        {marks}
        {horizontal ? (
          <line x1={left + zero * plotW} x2={left + zero * plotW} y1={top} y2={bottom} className="sheet-chart-zero" />
        ) : (
          <line
            x1={left}
            x2={right}
            y1={bottom - zero * plotH}
            y2={bottom - zero * plotH}
            className="sheet-chart-zero"
          />
        )}
        {categoryLabels}
        {verticalTitle && (
          <text
            x={14}
            y={(top + bottom) / 2}
            textAnchor="middle"
            transform={`rotate(-90 14 ${(top + bottom) / 2})`}
            className="sheet-chart-axis-title"
          >
            {clipLabel(verticalTitle, Math.floor((bottom - top) / 7))}
          </text>
        )}
        {horizontalTitle && (
          <text x={(left + right) / 2} y={height - legend - 6} textAnchor="middle" className="sheet-chart-axis-title">
            {clipLabel(horizontalTitle, Math.floor((right - left) / 7))}
          </text>
        )}
      </>
    );
  })();
  // Legende: so viele Einträge, wie in die Breite passen.
  const legendWidth = Math.max(60, Math.min(160, (width - 24) / Math.max(1, legendItems.length)));
  const shown = legendItems.slice(0, Math.max(1, Math.floor((width - 24) / legendWidth)));
  return (
    <svg
      className="sheet-chart-svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={title || "Diagramm"}
    >
      <rect width={width} height={height} fill="white" />
      {title && (
        <text x={width / 2} y={22} textAnchor="middle" className="sheet-chart-title">
          {clipLabel(title, Math.floor(width / 8))}
        </text>
      )}
      {body}
      {legend > 0 && !empty && (
        <g transform={`translate(${(width - shown.length * legendWidth) / 2}, ${height - 16})`}>
          {shown.map((item, index) => (
            <g key={index} transform={`translate(${index * legendWidth}, 0)`}>
              <rect width={10} height={10} y={-9} rx={2} fill={CHART_COLORS[index % CHART_COLORS.length]} />
              <text x={14} y={0} className="sheet-chart-legend">
                {clipLabel(item, Math.floor((legendWidth - 18) / 6.5))}
              </text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

// ---------- Dialog ----------

export function SheetDialog({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("input, button:not(.sheet-dialog-close)")?.focus();
    return () => previous?.focus?.({ preventScroll: true });
  }, []);
  return createPortal(
    <div
      className="sheet-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className={`sheet-dialog ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape" && !document.querySelector(".area-select-menu-portal")) onClose();
        }}
      >
        <header>
          <h2>{title}</h2>
          <button
            type="button"
            className="sheet-dialog-close"
            aria-label="Schliessen"
            data-tip="Schliessen"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="sheet-dialog-body">{children}</div>
        <footer>{footer}</footer>
      </div>
    </div>,
    document.body,
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="sheet-dialog-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

// ---------- Bedingte Formatierung ----------

// Vorschau einer Farbskala (Verlauf) oder eines Datenbalkens.
function RuleSample({ op, colors }: { op: RuleOp; colors: string[] }) {
  const style =
    op === "scale"
      ? { background: `linear-gradient(to right, ${colors.join(", ")})` }
      : {
          backgroundImage: `linear-gradient(to right, ${colors[0]} 0, ${colors[0]}99 70%, transparent 70%)`,
          backgroundSize: "100% 70%",
          backgroundPosition: "left center",
          backgroundRepeat: "no-repeat",
        };
  return <span className="sheet-rule-sample graded" style={style} aria-hidden="true" />;
}

export function RulesDialog({
  rules,
  selection,
  onSave,
  onClose,
}: {
  rules: SheetRule[];
  selection: Area;
  onSave: (rules: SheetRule[]) => void;
  onClose: () => void;
}) {
  const [list, setList] = useState(rules);
  const [range, setRange] = useState(areaName(selection));
  const [op, setOp] = useState<RuleOp>("gt");
  const [value, setValue] = useState("");
  const [value2, setValue2] = useState("");
  const [preset, setPreset] = useState(RULE_PRESETS[0].id);
  const [scalePreset, setScalePreset] = useState(SCALE_PRESETS[0].id);
  const [barPreset, setBarPreset] = useState(BAR_PRESETS[0].id);
  const [problem, setProblem] = useState("");
  const needs = RULE_NEEDS[op];
  const graded = op === "scale" || op === "bar";
  function add() {
    const normalized = normalizeRange(range);
    if (!normalized) return setProblem("Bitte einen gültigen Bereich angeben, z. B. B2:B20.");
    if (needs >= 1 && !value.trim()) return setProblem("Bitte einen Vergleichswert angeben.");
    if (needs === 2 && !value2.trim()) return setProblem("Bitte beide Werte angeben.");
    const style: RuleStyle = graded ? {} : RULE_PRESETS.find((item) => item.id === preset)!.style;
    const colors =
      op === "scale"
        ? SCALE_PRESETS.find((item) => item.id === scalePreset)!.colors
        : op === "bar"
          ? BAR_PRESETS.find((item) => item.id === barPreset)!.colors
          : undefined;
    setList([
      ...list,
      {
        id: `${Date.now().toString(36)}${list.length}`,
        range: normalized,
        op,
        value: needs ? value.trim() : "",
        value2: needs === 2 ? value2.trim() : "",
        style,
        ...(colors ? { colors } : {}),
      },
    ]);
    setValue("");
    setValue2("");
    setProblem("");
  }
  const describe = (rule: SheetRule) =>
    `${RULE_LABELS[rule.op]}${RULE_NEEDS[rule.op] === 2 ? ` ${rule.value} und ${rule.value2}` : RULE_NEEDS[rule.op] ? ` ${rule.value}` : ""}`;
  return (
    <SheetDialog
      title="Bedingte Formatierung"
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              onSave(list);
              onClose();
            }}
          >
            Übernehmen
          </button>
        </>
      }
    >
      <p className="sheet-dialog-text">
        Zellen werden hervorgehoben, wenn ihr Wert die Regel erfüllt; die erste zutreffende Hervorhebung gilt. Farbskala
        und Datenbalken zeigen Zahlen im Vergleich zu den anderen Zahlen im Bereich.
      </p>
      <div className="sheet-dialog-grid">
        <Field label="Bereich">
          <input value={range} onChange={(event) => setRange(event.target.value)} spellCheck={false} />
        </Field>
        <Field label="Regel">
          <CareOptionSelect
            label="Regel"
            value={op}
            menuZIndex={MENU_Z}
            options={(Object.keys(RULE_LABELS) as RuleOp[]).map((item) => ({ value: item, label: RULE_LABELS[item] }))}
            onChange={(next) => setOp(next as RuleOp)}
          />
        </Field>
        {needs >= 1 && (
          <Field label={needs === 2 ? "Von" : op === "contains" ? "Text" : "Wert"}>
            <input value={value} onChange={(event) => setValue(event.target.value)} />
          </Field>
        )}
        {needs === 2 && (
          <Field label="Bis">
            <input value={value2} onChange={(event) => setValue2(event.target.value)} />
          </Field>
        )}
      </div>
      {graded && (
        <div className="sheet-dialog-presets" role="radiogroup" aria-label="Farben">
          {(op === "scale" ? SCALE_PRESETS : BAR_PRESETS).map((item) => {
            const active = (op === "scale" ? scalePreset : barPreset) === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={active}
                className={active ? "active" : ""}
                onClick={() => (op === "scale" ? setScalePreset(item.id) : setBarPreset(item.id))}
              >
                <RuleSample op={op} colors={item.colors} />
                {item.label}
              </button>
            );
          })}
        </div>
      )}
      <div className="sheet-dialog-presets" role="radiogroup" aria-label="Formatierung" hidden={graded}>
        {RULE_PRESETS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={preset === item.id}
            className={preset === item.id ? "active" : ""}
            onClick={() => setPreset(item.id)}
          >
            <span
              className="sheet-rule-sample"
              style={{ background: item.style.fill, color: item.style.color, fontWeight: item.style.b ? 700 : 500 }}
            >
              123
            </span>
            {item.label}
          </button>
        ))}
      </div>
      {problem && (
        <p className="office-inline-error" role="alert">
          {problem}
        </p>
      )}
      <button type="button" className="sheet-dialog-add" onClick={add}>
        Regel hinzufügen
      </button>
      <ul className="sheet-dialog-list" aria-label="Regeln">
        {list.length === 0 && <li className="empty">Noch keine Regeln auf diesem Blatt.</li>}
        {list.map((rule, index) => (
          <li key={rule.id}>
            {rule.op === "scale" || rule.op === "bar" ? (
              <RuleSample op={rule.op} colors={rule.colors ?? []} />
            ) : (
              <span
                className="sheet-rule-sample"
                style={{ background: rule.style.fill, color: rule.style.color, fontWeight: rule.style.b ? 700 : 500 }}
              >
                123
              </span>
            )}
            <span className="grow">
              <strong>{rule.range}</strong> · {describe(rule)}
            </span>
            <button
              type="button"
              aria-label="Nach oben"
              data-tip="Höhere Priorität"
              disabled={index === 0}
              onClick={() => {
                const next = [...list];
                [next[index - 1], next[index]] = [next[index], next[index - 1]];
                setList(next);
              }}
            >
              ↑
            </button>
            <button
              type="button"
              className="danger"
              aria-label={`Regel ${rule.range} entfernen`}
              data-tip="Regel entfernen"
              onClick={() => setList(list.filter((item) => item.id !== rule.id))}
            >
              <X aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </SheetDialog>
  );
}

// ---------- Datenüberprüfung (Auswahlliste) ----------

export function ValidationDialog({
  selection,
  current,
  onSave,
  onRemove,
  onClose,
}: {
  selection: Area;
  current: { range: string; values: string[] } | null;
  onSave: (range: string, values: string[]) => void;
  onRemove: (range: string) => void;
  onClose: () => void;
}) {
  const [range, setRange] = useState(current?.range ?? areaName(selection));
  const [text, setText] = useState(current?.values.join("\n") ?? "");
  const [problem, setProblem] = useState("");
  return (
    <SheetDialog
      title="Auswahlliste"
      onClose={onClose}
      footer={
        <>
          {current && (
            <button
              type="button"
              className="danger"
              onClick={() => {
                onRemove(current.range);
                onClose();
              }}
            >
              Auswahlliste entfernen
            </button>
          )}
          <button type="button" onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              const normalized = normalizeRange(range);
              const values = [
                ...new Set(
                  text
                    .split("\n")
                    .map((item) => item.trim())
                    .filter(Boolean),
                ),
              ];
              if (!normalized) return setProblem("Bitte einen gültigen Bereich angeben, z. B. C2:C50.");
              if (!values.length) return setProblem("Bitte mindestens einen Wert eintragen.");
              onSave(normalized, values.slice(0, 200));
              onClose();
            }}
          >
            Übernehmen
          </button>
        </>
      }
    >
      <p className="sheet-dialog-text">
        In diesen Zellen erscheint ein Auswahlpfeil. Andere Eingaben werden abgelehnt.
      </p>
      <Field label="Bereich">
        <input value={range} onChange={(event) => setRange(event.target.value)} spellCheck={false} />
      </Field>
      <Field label="Erlaubte Werte" hint="Ein Wert pro Zeile">
        <textarea rows={7} value={text} onChange={(event) => setText(event.target.value)} />
      </Field>
      {problem && (
        <p className="office-inline-error" role="alert">
          {problem}
        </p>
      )}
    </SheetDialog>
  );
}

// ---------- Diagramm einfügen / bearbeiten ----------

export type ChartValues = Pick<SheetChart, "type" | "range" | "title" | "xTitle" | "yTitle" | "labels">;

export function ChartDialog({
  chart,
  selection,
  onSave,
  onClose,
}: {
  chart: SheetChart | null;
  selection: Area;
  onSave: (values: ChartValues) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState<ChartType>(chart?.type ?? "column");
  const [range, setRange] = useState(chart?.range ?? areaName(selection));
  const [title, setTitle] = useState(chart?.title ?? "");
  const [xTitle, setXTitle] = useState(chart?.xTitle ?? "");
  const [yTitle, setYTitle] = useState(chart?.yTitle ?? "");
  const [labels, setLabels] = useState(chart?.labels ?? false);
  const [problem, setProblem] = useState("");
  return (
    <SheetDialog
      title={chart ? "Diagramm bearbeiten" : "Diagramm einfügen"}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              const normalized = normalizeRange(range);
              if (!normalized) return setProblem("Bitte einen gültigen Datenbereich angeben, z. B. A1:C10.");
              onSave({
                type,
                range: normalized,
                title: title.trim().slice(0, 200),
                xTitle: type === "pie" ? undefined : xTitle.trim().slice(0, 200) || undefined,
                yTitle: type === "pie" ? undefined : yTitle.trim().slice(0, 200) || undefined,
                labels: labels || undefined,
              });
              onClose();
            }}
          >
            {chart ? "Übernehmen" : "Einfügen"}
          </button>
        </>
      }
    >
      <div className="sheet-dialog-presets four" role="radiogroup" aria-label="Diagrammtyp">
        {(Object.keys(CHART_LABELS) as ChartType[]).map((item) => (
          <button
            key={item}
            type="button"
            role="radio"
            aria-checked={type === item}
            className={type === item ? "active" : ""}
            onClick={() => setType(item)}
          >
            {item === type && <Check aria-hidden="true" />}
            {CHART_LABELS[item]}
          </button>
        ))}
      </div>
      <Field label="Datenbereich" hint="Erste Zeile: Namen der Reihen, erste Spalte: Beschriftungen">
        <input value={range} onChange={(event) => setRange(event.target.value)} spellCheck={false} />
      </Field>
      <Field label="Titel">
        <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} />
      </Field>
      {type !== "pie" && (
        <div className="sheet-dialog-grid">
          <Field
            label={type === "bar" ? "Titel der senkrechten Achse (Beschriftungen)" : "Titel der waagrechten Achse"}
          >
            <input value={xTitle} onChange={(event) => setXTitle(event.target.value)} maxLength={200} />
          </Field>
          <Field label={type === "bar" ? "Titel der waagrechten Achse (Werte)" : "Titel der senkrechten Achse"}>
            <input value={yTitle} onChange={(event) => setYTitle(event.target.value)} maxLength={200} />
          </Field>
        </div>
      )}
      <button
        type="button"
        className={`office-toggle ${labels ? "active" : ""}`}
        aria-pressed={labels}
        onClick={() => setLabels((value) => !value)}
      >
        Werte an den Datenpunkten anzeigen
      </button>
      {problem && (
        <p className="office-inline-error" role="alert">
          {problem}
        </p>
      )}
    </SheetDialog>
  );
}

// ---------- Benannte Bereiche ----------

export function NamesDialog({
  names,
  sheets,
  sheet,
  selection,
  onSave,
  onClose,
}: {
  names: SheetName[];
  sheets: string[];
  sheet: string;
  selection: Area;
  onSave: (names: SheetName[]) => void;
  onClose: () => void;
}) {
  const [list, setList] = useState(names);
  const [name, setName] = useState("");
  const [target, setTarget] = useState(sheet);
  const [range, setRange] = useState(areaName(selection));
  const [problem, setProblem] = useState("");
  function add() {
    const trimmed = name.trim();
    const issue = nameProblem(trimmed);
    if (issue) return setProblem(issue);
    if (list.some((entry) => entry.name.toUpperCase() === trimmed.toUpperCase()))
      return setProblem("Diesen Namen gibt es schon.");
    const normalized = normalizeRange(range);
    if (!normalized) return setProblem("Bitte einen gültigen Bereich angeben, z. B. B2:B20.");
    setList([...list, { name: trimmed, sheet: target, range: normalized }]);
    setName("");
    setProblem("");
  }
  return (
    <SheetDialog
      title="Namen verwalten"
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              onSave(list);
              onClose();
            }}
          >
            Übernehmen
          </button>
        </>
      }
    >
      <p className="sheet-dialog-text">
        Ein Name steht für einen Bereich und kann in Formeln statt des Bezugs stehen, z. B. =SUMME(Plätze).
      </p>
      <div className="sheet-dialog-grid">
        <Field label="Name">
          <input
            value={name}
            maxLength={100}
            placeholder="z. B. Plätze"
            spellCheck={false}
            onChange={(event) => {
              setName(event.target.value);
              setProblem("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
          />
        </Field>
        <Field label="Blatt">
          <CareOptionSelect
            label="Blatt"
            value={target}
            menuZIndex={MENU_Z}
            options={sheets.map((item) => ({ value: item, label: item }))}
            onChange={(next) => setTarget(next)}
          />
        </Field>
        <Field label="Bereich">
          <input value={range} onChange={(event) => setRange(event.target.value)} spellCheck={false} />
        </Field>
      </div>
      {problem && (
        <p className="office-inline-error" role="alert">
          {problem}
        </p>
      )}
      <button type="button" className="sheet-dialog-add" onClick={add}>
        Name hinzufügen
      </button>
      <ul className="sheet-dialog-list" aria-label="Namen">
        {list.length === 0 && <li className="empty">Noch keine Namen in dieser Arbeitsmappe.</li>}
        {list.map((entry) => (
          <li key={entry.name}>
            <span className="grow">
              <strong>{entry.name}</strong> · {entry.sheet}!{entry.range}
            </span>
            <button
              type="button"
              className="danger"
              aria-label={`Name ${entry.name} entfernen`}
              data-tip="Name entfernen"
              onClick={() => setList(list.filter((item) => item.name !== entry.name))}
            >
              <X aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </SheetDialog>
  );
}

// ---------- Seite einrichten (Druckbereich, Kopf- und Fusszeile) ----------

export function PageDialog({
  print,
  selection,
  onSave,
  onClose,
}: {
  print: PrintSetup;
  selection: Area;
  onSave: (print: PrintSetup) => void;
  onClose: () => void;
}) {
  const [orientation, setOrientation] = useState(print.orientation);
  const [fit, setFit] = useState(print.fit);
  const [gridlines, setGridlines] = useState(print.gridlines);
  const [area, setArea] = useState(print.area ?? "");
  const [header, setHeader] = useState(print.header ?? "");
  const [footer, setFooter] = useState(print.footer ?? "");
  const [pageNumbers, setPageNumbers] = useState(print.pageNumbers ?? false);
  const [problem, setProblem] = useState("");
  const toggle = (active: boolean, label: string, onClick: () => void) => (
    <button type="button" className={`office-toggle ${active ? "active" : ""}`} aria-pressed={active} onClick={onClick}>
      {label}
    </button>
  );
  return (
    <SheetDialog
      title="Seite einrichten"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              const normalized = area.trim() ? normalizeRange(area) : "";
              if (normalized === null) return setProblem("Bitte einen gültigen Druckbereich angeben, z. B. A1:F40.");
              onSave({
                orientation,
                fit,
                gridlines,
                ...(normalized ? { area: normalized } : {}),
                ...(header.trim() ? { header: header.trim() } : {}),
                ...(footer.trim() ? { footer: footer.trim() } : {}),
                ...(pageNumbers ? { pageNumbers: true } : {}),
              });
              onClose();
            }}
          >
            Übernehmen
          </button>
        </>
      }
    >
      <div className="sheet-dialog-presets" role="radiogroup" aria-label="Ausrichtung">
        {(["portrait", "landscape"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={orientation === value}
            className={orientation === value ? "active" : ""}
            onClick={() => setOrientation(value)}
          >
            {orientation === value && <Check aria-hidden="true" />}
            {value === "portrait" ? "Hochformat" : "Querformat"}
          </button>
        ))}
      </div>
      <Field label="Druckbereich" hint="Leer lassen, um das ganze Blatt zu drucken">
        <span className="sheet-dialog-inline">
          <input
            value={area}
            placeholder="z. B. A1:F40"
            spellCheck={false}
            onChange={(event) => {
              setArea(event.target.value);
              setProblem("");
            }}
          />
          <button type="button" onClick={() => setArea(areaName(selection))}>
            Auswahl übernehmen
          </button>
        </span>
      </Field>
      <Field label="Kopfzeile" hint="Steht oben auf jeder Seite">
        <input value={header} maxLength={200} onChange={(event) => setHeader(event.target.value)} />
      </Field>
      <Field label="Fusszeile" hint="Steht unten auf jeder Seite">
        <input value={footer} maxLength={200} onChange={(event) => setFooter(event.target.value)} />
      </Field>
      <div className="sheet-dialog-toggles">
        {toggle(pageNumbers, "Seitenzahlen in der Fusszeile („Seite 1 von 3“)", () => setPageNumbers(!pageNumbers))}
        {toggle(fit, "Auf Seitenbreite anpassen", () => setFit(!fit))}
        {toggle(gridlines, "Gitternetz drucken", () => setGridlines(!gridlines))}
      </div>
      {problem && (
        <p className="office-inline-error" role="alert">
          {problem}
        </p>
      )}
    </SheetDialog>
  );
}

// ---------- Suchen und Ersetzen ----------

export function FindBar({
  replace,
  count,
  current,
  onSearch,
  onNext,
  onReplace,
  onReplaceAll,
  onClose,
  onToggleReplace,
}: {
  replace: boolean;
  count: number;
  current: number;
  onSearch: (query: string, options: FindOptions) => void;
  onNext: (direction: 1 | -1) => void;
  onReplace: (replacement: string) => void;
  onReplaceAll: (replacement: string) => void;
  onClose: () => void;
  onToggleReplace: () => void;
}) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [options, setOptions] = useState<FindOptions>({ matchCase: false, wholeCell: false });
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  // Nur bei geänderter Suche neu suchen (die Funktion selbst wechselt bei jedem Zeichnen).
  const search = useRef(onSearch);
  useEffect(() => {
    search.current = onSearch;
  });
  useEffect(() => {
    search.current(query, options);
  }, [query, options]);
  const toggle = (key: keyof FindOptions, label: string) => (
    <button
      type="button"
      role="checkbox"
      aria-checked={options[key]}
      className={`sheet-find-option ${options[key] ? "active" : ""}`}
      onClick={() => setOptions({ ...options, [key]: !options[key] })}
    >
      <span className="sheet-check" aria-hidden="true">
        {options[key] && <Check weight="bold" />}
      </span>
      {label}
    </button>
  );
  return (
    <div
      className="sheet-find"
      role="search"
      aria-label="Suchen und Ersetzen"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <input
        ref={input}
        aria-label="Suchen nach"
        placeholder="Suchen nach"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onNext(event.shiftKey ? -1 : 1);
          }
        }}
      />
      <span className="sheet-find-count" aria-live="polite">
        {query ? (count ? `${current + 1} von ${count}` : "Keine Treffer") : ""}
      </span>
      <button
        type="button"
        disabled={!count}
        onClick={() => onNext(-1)}
        data-tip="Vorheriger Treffer"
        aria-label="Vorheriger Treffer"
      >
        ↑
      </button>
      <button
        type="button"
        disabled={!count}
        onClick={() => onNext(1)}
        data-tip="Nächster Treffer"
        aria-label="Nächster Treffer"
      >
        ↓
      </button>
      {replace && (
        <>
          <input
            aria-label="Ersetzen durch"
            placeholder="Ersetzen durch"
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
          />
          <button type="button" disabled={!count} onClick={() => onReplace(replacement)}>
            Ersetzen
          </button>
          <button type="button" disabled={!count} onClick={() => onReplaceAll(replacement)}>
            Alle ersetzen
          </button>
        </>
      )}
      {toggle("matchCase", "Gross/klein beachten")}
      {toggle("wholeCell", "Ganze Zelle")}
      <button type="button" className="sheet-find-mode" onClick={onToggleReplace}>
        {replace ? "Nur suchen" : "Ersetzen …"}
      </button>
      <button
        type="button"
        className="sheet-find-close"
        aria-label="Suchen schliessen"
        data-tip="Schliessen"
        onClick={onClose}
      >
        <X aria-hidden="true" />
      </button>
    </div>
  );
}

// ---------- Filter im Spaltenkopf ----------

export function FilterMenu({
  anchor,
  values,
  hidden,
  onSort,
  onApply,
  onClose,
}: {
  anchor: { x: number; y: number };
  values: string[];
  hidden: string[];
  onSort: (direction: 1 | -1) => void;
  onApply: (hidden: string[]) => void;
  onClose: () => void;
}) {
  const [excluded, setExcluded] = useState(() => new Set(hidden));
  const [search, setSearch] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const shown = useMemo(
    () =>
      values.filter((value) =>
        (value || "(Leer)").toLocaleLowerCase("de-CH").includes(search.toLocaleLowerCase("de-CH")),
      ),
    [values, search],
  );
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const allChecked = shown.every((value) => !excluded.has(value));
  const check = (checked: boolean, label: string, onToggle: () => void, key: string) => (
    <button
      key={key}
      type="button"
      role="checkbox"
      aria-checked={checked}
      className="sheet-filter-value"
      onClick={onToggle}
    >
      <span className="sheet-check" aria-hidden="true">
        {checked && <Check weight="bold" />}
      </span>
      <span>{label}</span>
    </button>
  );
  return createPortal(
    <div
      ref={panel}
      className="sheet-filter-menu"
      role="dialog"
      aria-label="Filter"
      style={{ top: Math.min(anchor.y, window.innerHeight - 440), left: Math.min(anchor.x, window.innerWidth - 270) }}
    >
      <div className="office-menu">
        <button type="button" onClick={() => onSort(1)}>
          <span>Aufsteigend sortieren (A–Z)</span>
        </button>
        <button type="button" onClick={() => onSort(-1)}>
          <span>Absteigend sortieren (Z–A)</span>
        </button>
        <button type="button" disabled={!hidden.length} onClick={() => onApply([])}>
          <span>Filter dieser Spalte löschen</span>
        </button>
      </div>
      <span className="office-menu-separator" />
      <input
        className="sheet-filter-search"
        aria-label="Werte durchsuchen"
        placeholder="Suchen"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="sheet-filter-values">
        {check(
          allChecked,
          "(Alle auswählen)",
          () => {
            const next = new Set(excluded);
            for (const value of shown) {
              if (allChecked) next.add(value);
              else next.delete(value);
            }
            setExcluded(next);
          },
          "__all",
        )}
        {shown.map((value) =>
          check(
            !excluded.has(value),
            value || "(Leer)",
            () => {
              const next = new Set(excluded);
              if (next.has(value)) next.delete(value);
              else next.add(value);
              setExcluded(next);
            },
            `v${value}`,
          ),
        )}
      </div>
      <div className="sheet-filter-actions">
        <button type="button" onClick={onClose}>
          Abbrechen
        </button>
        <button
          type="button"
          className="primary"
          disabled={values.length > 0 && values.every((value) => excluded.has(value))}
          onClick={() => onApply([...excluded].filter((value) => values.includes(value)))}
        >
          OK
        </button>
      </div>
    </div>,
    document.body,
  );
}

// ---------- Pivot-Tabelle ----------

export type PivotValues = SheetPivot;

export function PivotDialog({
  sheets,
  initial,
  editing,
  fieldsFor,
  onSave,
  onClose,
}: {
  sheets: { id: string; name: string }[];
  initial: PivotValues;
  editing: boolean;
  // Überschriften des Bereichs (null: Bereich ungültig).
  fieldsFor: (source: string, range: string) => string[] | null;
  onSave: (pivot: PivotValues) => void;
  onClose: () => void;
}) {
  const [source, setSource] = useState(initial.source);
  const [range, setRange] = useState(initial.range);
  const [rows, setRows] = useState(String(initial.rows));
  const [cols, setCols] = useState(initial.cols === null ? "" : String(initial.cols));
  const [value, setValue] = useState(String(initial.value));
  const [fn, setFn] = useState<PivotFunction>(initial.fn);
  const [problem, setProblem] = useState("");
  const normalized = normalizeRange(range);
  const fields = normalized ? fieldsFor(source, normalized) : null;
  const options = (fields ?? []).map((name, index) => ({ value: String(index), label: name }));
  const save = () => {
    if (!normalized || !fields)
      return setProblem("Bitte einen gültigen Bereich mit Überschriften angeben, z. B. A1:D50.");
    const at = (text: string) => (text !== "" && Number(text) < fields.length ? Number(text) : null);
    const rowField = at(rows);
    const valueField = at(value);
    if (rowField === null || valueField === null) return setProblem("Bitte das Zeilenfeld und das Wertfeld wählen.");
    const colField = at(cols);
    if (colField !== null && colField === rowField)
      return setProblem("Zeilen und Spalten brauchen zwei verschiedene Felder.");
    onSave({ source, range: normalized, rows: rowField, cols: colField, value: valueField, fn });
    onClose();
  };
  return (
    <SheetDialog
      title={editing ? "Pivot-Tabelle bearbeiten" : "Pivot-Tabelle einfügen"}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="primary" onClick={save}>
            {editing ? "Übernehmen" : "Einfügen"}
          </button>
        </>
      }
    >
      <p className="sheet-dialog-text">
        Fasst einen Bereich mit Überschriften in der ersten Zeile zusammen. Die Pivot-Tabelle steht auf einem eigenen
        Blatt und wird über „Pivot-Tabelle aktualisieren“ auf den neuen Stand gebracht.
      </p>
      <div className="sheet-dialog-grid">
        <Field label="Blatt mit den Daten">
          <CareOptionSelect
            label="Blatt mit den Daten"
            value={source}
            menuZIndex={MENU_Z}
            options={sheets.map((item) => ({ value: item.id, label: item.name }))}
            onChange={setSource}
          />
        </Field>
        <Field label="Bereich">
          <input value={range} onChange={(event) => setRange(event.target.value)} spellCheck={false} />
        </Field>
      </div>
      <div className="sheet-dialog-grid">
        <Field label="Zeilen">
          <CareOptionSelect label="Zeilen" value={rows} menuZIndex={MENU_Z} options={options} onChange={setRows} />
        </Field>
        <Field label="Spalten (optional)">
          <CareOptionSelect
            label="Spalten (optional)"
            value={cols}
            menuZIndex={MENU_Z}
            options={[{ value: "", label: "Keine" }, ...options]}
            onChange={setCols}
          />
        </Field>
      </div>
      <div className="sheet-dialog-grid">
        <Field label="Werte">
          <CareOptionSelect label="Werte" value={value} menuZIndex={MENU_Z} options={options} onChange={setValue} />
        </Field>
        <Field label="Berechnung">
          <CareOptionSelect
            label="Berechnung"
            value={fn}
            menuZIndex={MENU_Z}
            options={(Object.keys(PIVOT_FUNCTIONS) as PivotFunction[]).map((key) => ({
              value: key,
              label: PIVOT_FUNCTIONS[key],
            }))}
            onChange={(next) => setFn(next as PivotFunction)}
          />
        </Field>
      </div>
      {problem && (
        <p className="office-inline-error" role="alert">
          {problem}
        </p>
      )}
    </SheetDialog>
  );
}
