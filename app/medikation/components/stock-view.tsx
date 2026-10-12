"use client";

import { useTerms } from "@/app/components/care-context";
import { useState } from "react";
import { ModuleIcon } from "@/app/components/module-icon";
import { movementLabels, type StockItem, type StockMovement } from "@/lib/medication-shared";
import {
  EmptyState,
  LoadError,
  PageHeading,
  SummaryTiles,
  formatDate,
  formatDateTime,
  formatNumber,
  todayInZurich,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import { CorrectionDialog, ReceiptDialog } from "./stock-dialogs";

type StockPayload = {
  items: StockItem[];
  movements: StockMovement[];
  careUnits: Array<{ id: string; name: string }>;
  residents: Array<{ id: string; name: string }>;
  canManage: boolean;
};
const FILTERS = ["Alle", "Unter Mindestbestand", "Verfall in 90 Tagen", "Ausreichend"] as const;

const isLow = (item: StockItem) => item.minimum !== null && item.quantity < item.minimum;
function daysUntil(date: string | null) {
  if (!date) return null;
  return Math.round((Date.parse(`${date}T12:00:00`) - Date.parse(`${todayInZurich()}T12:00:00`)) / 86_400_000);
}

export function MovementJournal({
  movements,
  title = "Bestandsjournal",
}: {
  movements: StockMovement[];
  title?: string;
}) {
  return (
    <section className="card med-reserve-log">
      <div className="card-header">
        <div>
          <p className="eyebrow">Nachvollziehbarkeit</p>
          <h2 className="card-title">{title}</h2>
          <p className="card-subtitle">Eingänge, Gaben und Korrekturen mit Person und Zeitpunkt.</p>
        </div>
      </div>
      <div>
        {movements.map((entry) => (
          <p key={entry.id}>
            <ModuleIcon name={entry.delta > 0 ? "plus" : "check"} />
            <span>
              {formatDateTime(entry.createdAt)} · {entry.residentName ? `${entry.residentName} · ` : ""}
              {entry.medication} {entry.delta > 0 ? "+" : "−"}
              {formatNumber(Math.abs(entry.delta))} · {movementLabels[entry.reason]}
              {entry.note ? ` („${entry.note}“)` : ""} · {entry.userName ?? "unbekannt"}
            </span>
          </p>
        ))}
        {!movements.length && <p className="list-hint">Noch keine Buchungen.</p>}
      </div>
    </section>
  );
}

export default function StockView({ showToast }: { showToast: ShowToast }) {
  const t = useTerms();
  const { data, error, loading, reload } = useApiData<StockPayload>("/api/medication/stock");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Alle");
  const [dialog, setDialog] = useState<{ kind: "receipt" } | { kind: "correction"; item: StockItem } | null>(null);
  const items = data?.items ?? [];
  const needle = query.trim().toLocaleLowerCase("de-CH");
  const expiringSoon = (item: StockItem) => {
    const days = daysUntil(item.expiresOn);
    return days !== null && days <= 90;
  };
  const filtered = items.filter(
    (item) =>
      (filter === "Alle" ||
        (filter === "Unter Mindestbestand" && isLow(item)) ||
        (filter === "Verfall in 90 Tagen" && expiringSoon(item)) ||
        (filter === "Ausreichend" && !isLow(item) && !expiringSoon(item))) &&
      `${item.name} ${item.strength} ${item.owner} ${item.location} ${item.batch}`
        .toLocaleLowerCase("de-CH")
        .includes(needle),
  );
  const done = (message: string) => {
    setDialog(null);
    showToast(message);
    reload();
  };

  return (
    <>
      <PageHeading
        eyebrow="Medikamente"
        title="Medikamentenbestände"
        description="Bestände, Mindestmengen und Verfalldaten zentral überwachen."
        action={data?.canManage ? { label: "Wareneingang", onClick: () => setDialog({ kind: "receipt" }) } : undefined}
      />
      <SummaryTiles
        label="Bestandsübersicht"
        tiles={[
          { icon: "med", value: items.length, caption: "Bestandspositionen" },
          { icon: "alert", value: items.filter(isLow).length, caption: "unter Mindestbestand", tone: "attention" },
          { icon: "calendar", value: items.filter(expiringSoon).length, caption: "Verfall in 90 Tagen", tone: "info" },
          {
            icon: "residents",
            value: items.filter((i) => i.ownerKind === "resident").length,
            caption: "bewohnereigene Bestände",
          },
        ]}
      />
      {error && <LoadError message={error} onRetry={reload} />}
      <section className="card med-stock-card">
        <div className="med-stock-toolbar">
          <div>
            <h2 className="card-title">Lagerbestand</h2>
            <p className="card-subtitle">Stationsbestände und bewohnereigene Reserven</p>
          </div>
          <label className="resident-search">
            <ModuleIcon name="search" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Präparat, Lagerort, Charge"
              aria-label="Bestände durchsuchen"
            />
          </label>
          <div className="care-record-filters">
            {FILTERS.map((item) => (
              <button
                className={filter === item ? "active" : ""}
                type="button"
                key={item}
                aria-pressed={filter === item}
                onClick={() => setFilter(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="med-stock-head">
          <span>Präparat</span>
          <span>Bestand gehört zu</span>
          <span>Menge</span>
          <span>Verfall</span>
          <span>Aktion</span>
        </div>
        <div className="med-stock-list">
          {filtered.map((item) => {
            const low = isLow(item);
            const days = daysUntil(item.expiresOn);
            const fill = item.minimum ? Math.min((item.quantity / (item.minimum * 2)) * 100, 100) : 100;
            return (
              <article key={item.id}>
                <span className="med-pill-icon">
                  <ModuleIcon name="med" />
                </span>
                <span>
                  <strong>
                    {`${item.name} ${item.strength}`.trim()}
                    {item.controlled && (
                      <em className="btm-badge" title="Betäubungsmittel – Buchungen mit Zweitunterschrift">
                        BtM
                      </em>
                    )}
                  </strong>
                  <small>{[item.form, item.batch && `Charge ${item.batch}`].filter(Boolean).join(" · ") || "–"}</small>
                </span>
                <span>
                  <strong>{item.owner}</strong>
                  <small>
                    {item.location ||
                      (item.ownerKind === "resident" ? `${t.prefix}eigener Bestand` : "Kein Lagerort erfasst")}
                  </small>
                </span>
                <span className={`med-stock-level ${low ? "low" : ""}`}>
                  <strong>
                    {formatNumber(item.quantity)} {item.unit}
                  </strong>
                  <span>
                    <i style={{ width: `${fill}%` }} />
                  </span>
                  <small>
                    {item.minimum !== null
                      ? `Mindestbestand ${formatNumber(item.minimum)} ${item.unit}`
                      : "Kein Mindestbestand"}
                  </small>
                </span>
                <span>
                  <strong>{formatDate(item.expiresOn)}</strong>
                  <small className={days !== null && days <= 90 ? "attention-text" : ""}>
                    {days === null
                      ? "nicht erfasst"
                      : days < 0
                        ? "abgelaufen"
                        : days <= 90
                          ? `in ${days} Tagen`
                          : "im Zeitraum"}
                  </small>
                </span>
                {data?.canManage ? (
                  <button type="button" onClick={() => setDialog({ kind: "correction", item })}>
                    {low ? "Prüfen" : "Bearbeiten"}
                  </button>
                ) : (
                  <span />
                )}
              </article>
            );
          })}
          {!loading && !filtered.length && (
            <EmptyState
              icon="search"
              title={items.length ? "Keine Bestände gefunden" : "Noch keine Bestände erfasst"}
              text={items.length ? "Suche oder Filter anpassen." : "Über „Wareneingang“ den ersten Bestand anlegen."}
            />
          )}
          {loading && !data && <p className="list-hint">Bestände werden geladen …</p>}
        </div>
      </section>
      <MovementJournal movements={data?.movements ?? []} />
      {dialog?.kind === "receipt" && data && (
        <ReceiptDialog
          items={items}
          careUnits={data.careUnits}
          residents={data.residents}
          controlledNames={[
            ...new Set(items.filter((item) => item.controlled).map((item) => item.name.toLocaleLowerCase("de-CH"))),
          ]}
          onClose={() => setDialog(null)}
          onSaved={done}
        />
      )}
      {dialog?.kind === "correction" && (
        <CorrectionDialog item={dialog.item} onClose={() => setDialog(null)} onSaved={done} />
      )}
    </>
  );
}
