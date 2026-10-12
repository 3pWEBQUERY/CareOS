"use client";

import { useTerms } from "@/app/components/care-context";
import { useState } from "react";
import { CareSelect } from "@/app/components/care-form-controls";
import { ModuleIcon } from "@/app/components/module-icon";
import {
  EmptyState,
  LoadError,
  PageHeading,
  SummaryTiles,
  formatDateTime,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import { initials } from "@/lib/medication-shared";
import { ENTRY_TYPES, materialLabel, sizeLabel, type WoundEntry } from "@/lib/wounds-shared";
import { WoundTimeline } from "./wound-timeline";
import { nextCareLabel } from "./overview-utils";
import { EntryDialog, type WoundsPayload } from "./wound-dialogs";
import { useNow } from "@/app/components/use-now";
import { ResuscitationBadge } from "@/app/components/resuscitation-badge";

type FeedEntry = WoundEntry & {
  residentId: string;
  residentName: string;
  woundTitle: string;
  bodyLocation: string;
  woundType: string | null;
  category: string | null;
};
const RANGES = [7, 30, 90];

export default function DocumentationView({ showToast }: { showToast: ShowToast }) {
  const now = useNow();
  const t = useTerms();
  const [days, setDays] = useState(30);
  const [type, setType] = useState<string>("Alle");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [entryFor, setEntryFor] = useState<string | null>(null);
  const feed = useApiData<{ entries: FeedEntry[]; canWrite: boolean }>(`/api/wounds/entries?days=${days}`);
  const wounds = useApiData<WoundsPayload>("/api/wounds");
  const entries = feed.data?.entries ?? [];
  const needle = query.trim().toLocaleLowerCase("de-CH");
  const filtered = entries.filter(
    (e) =>
      (type === "Alle" || e.entryType === type) &&
      `${e.residentName} ${e.woundTitle} ${e.bodyLocation} ${e.author ?? ""}`
        .toLocaleLowerCase("de-CH")
        .includes(needle),
  );
  const selected = entries.find((e) => e.id === selectedId) ?? filtered[0] ?? null;
  const selectedWound = wounds.data?.wounds.find((w) => w.id === selected?.woundId) ?? null;
  const history = useApiData<{ entries: WoundEntry[] }>(selected ? `/api/wounds/${selected.woundId}/entries` : null);
  const woundForEntry = wounds.data?.wounds.find((w) => w.id === entryFor) ?? null;
  const weekAgo = new Date(now - 7 * 86_400_000).toISOString();

  return (
    <>
      <PageHeading
        eyebrow="Wunden"
        title="Wunddokumentation"
        description="Alle Befunde und Versorgungen chronologisch – nachvollziehbar mit Zeitpunkt und dokumentierender Person."
      />
      <SummaryTiles
        label="Dokumentationsstatus"
        tiles={[
          { icon: "note", value: entries.filter((e) => e.observedAt > weekAgo).length, caption: "Einträge in 7 Tagen" },
          {
            icon: "wounds",
            value: new Set(entries.map((e) => e.woundId)).size,
            caption: `dokumentierte Wunden (${days} T)`,
          },
          {
            icon: "alert",
            value: entries.filter((e) => e.infectionSigns).length,
            caption: "mit Infektionszeichen",
            tone: "critical",
          },
          {
            icon: "calendar",
            value: (wounds.data?.wounds ?? []).filter((w) => w.overdue).length,
            caption: "Versorgungen überfällig",
            tone: "attention",
          },
        ]}
      />
      {feed.error && <LoadError message={feed.error} onRetry={feed.reload} />}
      <div className={`wound-doc-layout ${selected ? "" : "single"}`}>
        <section className="card wound-doc-directory" aria-labelledby="wound-doc-list-title">
          <div className="wound-doc-toolbar">
            <div>
              <h2 className="card-title" id="wound-doc-list-title">
                Einträge
              </h2>
              <p className="card-subtitle">
                {filtered.length} von {entries.length} Einträgen der letzten {days} Tage
              </p>
            </div>
            <label className="resident-search">
              <ModuleIcon name="search" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`${t.one}, Wunde oder Person`}
                aria-label="Wunddokumentation durchsuchen"
              />
            </label>
            <CareSelect
              label="Art des Eintrags"
              value={type === "Alle" ? "Alle Einträge" : type}
              options={["Alle Einträge", ...ENTRY_TYPES]}
              onChange={(value) => setType(value === "Alle Einträge" ? "Alle" : value)}
            />
            <div className="wound-status-filter" aria-label="Zeitraum">
              {RANGES.map((d) => (
                <button
                  className={days === d ? "active" : ""}
                  type="button"
                  key={d}
                  aria-pressed={days === d}
                  onClick={() => setDays(d)}
                >
                  {d} Tage
                </button>
              ))}
            </div>
          </div>
          <div className="wound-doc-table-head" aria-hidden="true">
            <span>{t.one} &amp; Wunde</span>
            <span>Eintrag</span>
            <span>Zeitpunkt</span>
            <span>Befund</span>
            <span />
          </div>
          <div className="wound-doc-list">
            {filtered.map((entry) => (
              <button
                className={`wound-doc-row ${selected?.id === entry.id ? "selected" : ""}`}
                type="button"
                key={entry.id}
                onClick={() => setSelectedId(entry.id)}
              >
                <span className={`resident-avatar ${entry.infectionSigns ? "critical" : ""}`}>
                  {initials(entry.residentName)}
                </span>
                <span className="wound-doc-resident">
                  <strong>
                    {entry.residentName} <ResuscitationBadge residentId={entry.residentId} />
                  </strong>
                  <small>{entry.bodyLocation}</small>
                  <span>
                    {entry.woundType ?? "Wunde"}
                    {entry.category ? ` ${entry.category}` : ""}
                  </span>
                </span>
                <span className="wound-doc-kind">
                  <strong>{entry.entryType}</strong>
                  <small>{entry.author ?? "unbekannt"}</small>
                </span>
                <span className="wound-doc-date">
                  <strong>{formatDateTime(entry.observedAt)}</strong>
                  <small>{sizeLabel(entry)}</small>
                </span>
                <span className={`status-badge ${entry.infectionSigns ? "critical" : "info"}`}>
                  {entry.infectionSigns ? "Infektionszeichen" : (entry.tissue ?? "Dokumentiert")}
                </span>
                <ModuleIcon name="chevron" className="chevron" />
              </button>
            ))}
            {!feed.loading && !filtered.length && (
              <EmptyState icon="note" title="Keine Einträge gefunden" text="Zeitraum, Art oder Suchbegriff anpassen." />
            )}
            {feed.loading && !feed.data && <p className="list-hint">Dokumentation wird geladen …</p>}
          </div>
        </section>

        {selected && (
          <aside className="wound-doc-sidebar">
            <section className="card wound-doc-detail" aria-live="polite">
              <div className="card-header">
                <div>
                  <p className="eyebrow">Ausgewählter Eintrag</p>
                  <h2 className="card-title">{selected.residentName}</h2>
                  <p className="card-subtitle">{selected.woundTitle}</p>
                </div>
                <span className={`status-badge ${selected.infectionSigns ? "critical" : "info"}`}>
                  {selected.entryType}
                </span>
              </div>
              <div className="wound-doc-detail-body">
                <span className={`wound-focus-icon ${selected.infectionSigns ? "critical" : "stable"}`}>
                  <ModuleIcon name="wounds" />
                </span>
                <h3>{sizeLabel(selected)}</h3>
                <p>
                  {formatDateTime(selected.observedAt)} · {selected.author ?? "unbekannt"}
                </p>
                <dl>
                  {[
                    ["Wundgrund", selected.tissue],
                    ["Exsudat", selected.exudate],
                    ["Wundrand", selected.woundEdge],
                    ["Wundumgebung", selected.surroundingSkin],
                    ["Schmerz", selected.painScore === null ? null : `NRS ${selected.painScore}`],
                    ["Geruch", selected.odor ? "auffällig" : null],
                    ["Infektionszeichen", selected.infectionSigns ? "vorhanden" : null],
                  ]
                    .filter(([, value]) => value)
                    .map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                </dl>
                {selected.treatment && (
                  <section>
                    <span>Versorgung</span>
                    <p>{selected.treatment}</p>
                  </section>
                )}
                {selected.materials.length > 0 && (
                  <section>
                    <span>Material</span>
                    <p>{selected.materials.map(materialLabel).join(", ")}</p>
                  </section>
                )}
                {selected.note && (
                  <section>
                    <span>Bemerkung</span>
                    <p>{selected.note}</p>
                  </section>
                )}
                {feed.data?.canWrite && selectedWound && selectedWound.status !== "closed" && (
                  <div className="wound-focus-actions">
                    <button className="primary-button" type="button" onClick={() => setEntryFor(selectedWound.id)}>
                      Verlauf ergänzen
                    </button>
                  </div>
                )}
                {selectedWound && <p className="wound-doc-next">{nextCareLabel(selectedWound)}</p>}
              </div>
            </section>
            <section className="card wound-doc-tasks">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Gesamter Wundverlauf</h2>
                  <p className="card-subtitle">{selected.woundTitle}</p>
                </div>
              </div>
              <WoundTimeline entries={history.data?.entries ?? []} loading={history.loading && !history.data} />
            </section>
          </aside>
        )}
      </div>
      {woundForEntry && (
        <EntryDialog
          wound={woundForEntry}
          onClose={() => setEntryFor(null)}
          onSaved={(message) => {
            setEntryFor(null);
            showToast(message);
            feed.reload();
            wounds.reload();
            history.reload();
          }}
        />
      )}
    </>
  );
}
