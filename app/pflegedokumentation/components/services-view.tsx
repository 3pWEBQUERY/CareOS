"use client";

import { useState } from "react";
import { useHeaderResident, useTerms, useWorkContext } from "@/app/components/care-context";
import { CareDatePicker, CareOptionSelect } from "@/app/components/care-form-controls";
import HeaderResidentHint from "@/app/components/header-resident-hint";
import ModulePageShell from "@/app/components/module-page-shell";
import {
  EditorDialog,
  EmptyState,
  LoadError,
  PageHeading,
  ReasonDialog,
  SummaryTiles,
  formatDate,
  requestJson,
  timeInZurich,
  todayInZurich,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import { zurichTimeToIso } from "@/lib/resident-appointments";
import {
  MAX_SERVICE_MINUTES,
  SERVICE_CATEGORIES,
  SERVICE_SOURCES,
  formatMinutes,
  type ServiceCatalogItem,
  type ServiceDay,
  type ServiceRecord,
  type ServiceSuggestion,
} from "@/lib/services-shared";

type Draft = {
  catalogId: string;
  title: string;
  category: string;
  minutes: string;
  time: string;
  note: string;
  source: "manual" | ServiceSuggestion["source"];
  sourceId: string | null;
};

const timeOf = (iso: string) => timeInZurich(new Date(iso));

function newDraft(suggestion: ServiceSuggestion | null, catalog: ServiceCatalogItem[]): Draft {
  const item = catalog.find((entry) => entry.id === suggestion?.catalogId);
  return {
    catalogId: item?.id ?? "",
    title: suggestion?.title ?? "",
    category: suggestion?.category ?? "Pflege",
    minutes: item?.defaultMinutes ? String(item.defaultMinutes) : "",
    time: suggestion?.performedAt ? timeOf(suggestion.performedAt) : timeInZurich(),
    note: "",
    source: suggestion?.source ?? "manual",
    sourceId: suggestion?.sourceId ?? null,
  };
}

function ServiceDialog({
  residentId,
  residentName,
  day,
  initial,
  catalog,
  onClose,
  onSaved,
}: {
  residentId: string;
  residentName: string;
  day: string;
  initial: Draft;
  catalog: ServiceCatalogItem[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  function pickCatalog(id: string) {
    const item = catalog.find((entry) => entry.id === id);
    setDraft((current) => ({
      ...current,
      catalogId: id,
      title: item?.name ?? current.title,
      category: item?.category ?? current.category,
      minutes: item?.defaultMinutes ? String(item.defaultMinutes) : current.minutes,
    }));
  }

  async function submit() {
    setSaving(true);
    setError("");
    try {
      await requestJson("/api/services", {
        method: "POST",
        body: {
          residentId,
          catalogId: draft.catalogId || null,
          title: draft.title,
          category: draft.category,
          minutes: Number(draft.minutes),
          performedAt: zurichTimeToIso(day, draft.time),
          note: draft.note,
          source: draft.source,
          sourceId: draft.sourceId,
        },
      });
      onSaved(`Leistung für ${residentName} erfasst`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="service-record"
      eyebrow={`${residentName} · ${formatDate(day)}`}
      title="Leistung erfassen"
      description={
        draft.source === "manual"
          ? "Erbrachte Leistung mit der aufgewendeten Zeit festhalten."
          : `${SERVICE_SOURCES[draft.source]}: Bezeichnung und Bereich sind vorbelegt, die Zeit trägst du ein.`
      }
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel="Leistung speichern"
    >
      {catalog.length > 0 && (
        <label className="area-editor-wide">
          <span>Aus dem Leistungskatalog</span>
          <CareOptionSelect
            label="Aus dem Leistungskatalog"
            value={draft.catalogId}
            onChange={pickCatalog}
            options={[
              { value: "", label: "Ohne Katalog (freie Bezeichnung)" },
              ...catalog.map((item) => ({
                value: item.id,
                label: [item.name, item.code].filter(Boolean).join(" · "),
              })),
            ]}
          />
        </label>
      )}
      <label className="area-editor-wide">
        <span>Leistung</span>
        <input required maxLength={160} value={draft.title} onChange={(event) => set("title", event.target.value)} />
      </label>
      <label>
        <span>Bereich</span>
        <CareOptionSelect
          label="Bereich"
          value={draft.category}
          onChange={(value) => set("category", value)}
          options={SERVICE_CATEGORIES.map((category) => ({ value: category, label: category }))}
        />
      </label>
      <label>
        <span>Zeit (Minuten)</span>
        <input
          required
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_SERVICE_MINUTES}
          step={1}
          value={draft.minutes}
          onChange={(event) => set("minutes", event.target.value)}
        />
      </label>
      <label>
        <span>Uhrzeit</span>
        <input type="time" required value={draft.time} onChange={(event) => set("time", event.target.value)} />
      </label>
      <label className="area-editor-wide">
        <span>Bemerkung (optional)</span>
        <input maxLength={2000} value={draft.note} onChange={(event) => set("note", event.target.value)} />
      </label>
    </EditorDialog>
  );
}

function RecordItem({
  record,
  onCancel,
}: {
  record: ServiceRecord;
  onCancel: ((record: ServiceRecord) => void) | null;
}) {
  return (
    <li className={record.cancelledAt ? "cancelled" : ""}>
      <div>
        <strong>{record.title}</strong>
        <small>
          {[
            timeOf(record.performedAt),
            record.category,
            record.code,
            record.performedBy,
            SERVICE_SOURCES[record.source],
          ]
            .filter(Boolean)
            .join(" · ")}
        </small>
        {record.note && <p>{record.note}</p>}
        {record.cancelledAt && <p className="service-cancel-reason">Storniert: {record.cancelReason}</p>}
      </div>
      <span className="service-minutes">{formatMinutes(record.minutes)}</span>
      {onCancel && !record.cancelledAt && (
        <button className="secondary-button" type="button" onClick={() => onCancel(record)}>
          Stornieren
        </button>
      )}
    </li>
  );
}

function ServicesContent({ showToast }: { showToast: ShowToast }) {
  const t = useTerms();
  const context = useWorkContext();
  const residents = context?.residents ?? [];
  const { resident, missing } = useHeaderResident(residents, !context);
  const [day, setDay] = useState(todayInZurich);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [cancelling, setCancelling] = useState<ServiceRecord | null>(null);
  const data = useApiData<ServiceDay>(
    resident ? `/api/services?residentId=${resident.id}&day=${encodeURIComponent(day)}` : null,
  );
  const current = data.data?.residentId === resident?.id ? data.data : null;
  const active = current?.records.filter((record) => !record.cancelledAt) ?? [];
  const total = active.reduce((sum, record) => sum + record.minutes, 0);
  const canWrite = current?.canWrite ?? false;
  const catalog = current?.catalog ?? [];
  const tasks = current?.suggestions.filter((item) => item.source === "task") ?? [];
  const interventions = current?.suggestions.filter((item) => item.source === "intervention") ?? [];

  const suggestionList = (title: string, items: ServiceSuggestion[], empty: string) => (
    <div className="service-suggestion-group">
      <h3>{title}</h3>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={`${item.source}-${item.sourceId}`}>
              <div>
                <strong>{item.title}</strong>
                <small>{[item.category, item.detail].filter(Boolean).join(" · ")}</small>
              </div>
              {canWrite && (
                <button className="secondary-button" type="button" onClick={() => setEditing(newDraft(item, catalog))}>
                  Übernehmen
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="service-empty">{empty}</p>
      )}
    </div>
  );

  return (
    <>
      <PageHeading
        eyebrow="Dokumentation"
        title="Leistungserfassung"
        description={`Erbrachte Pflegeleistungen mit der aufgewendeten Zeit je ${t.one} – vorbelegt aus erledigten Aufgaben und den Massnahmen der Pflegeplanung.`}
        action={
          resident && canWrite
            ? { label: "Leistung erfassen", onClick: () => setEditing(newDraft(null, catalog)) }
            : undefined
        }
      />
      {!resident ? (
        <HeaderResidentHint loading={!context} missing={missing} />
      ) : (
        <>
          <section className="service-toolbar">
            <div className="form-field">
              <span>Tag</span>
              <CareDatePicker label="Tag" value={day} onChange={setDay} />
            </div>
            <p>
              {resident.name} · {resident.room}
            </p>
          </section>
          <SummaryTiles
            label="Leistungen des Tages"
            tiles={[
              { icon: "check", value: current ? formatMinutes(total) : "–", caption: "erfasste Zeit" },
              { icon: "note", value: current ? active.length : "–", caption: "Leistungen" },
              {
                icon: "tasks",
                value: current ? tasks.length : "–",
                caption: "erledigte Aufgaben ohne Leistung",
                tone: tasks.length ? "attention" : undefined,
              },
            ]}
          />
          {data.error && <LoadError message={data.error} onRetry={data.reload} />}
          <div className="service-layout">
            <section className="card service-records" aria-label="Erfasste Leistungen">
              <header>
                <h2 className="card-title">Erfasste Leistungen</h2>
                <p className="card-subtitle">{formatDate(day)}</p>
              </header>
              {current && !current.records.length ? (
                <EmptyState
                  icon="note"
                  title="Noch keine Leistungen"
                  text="Leistungen direkt erfassen oder aus den Vorschlägen übernehmen."
                />
              ) : (
                <ul>
                  {current?.records.map((record) => (
                    <RecordItem key={record.id} record={record} onCancel={canWrite ? setCancelling : null} />
                  ))}
                </ul>
              )}
            </section>
            <section className="card service-suggestions" aria-label="Vorschläge">
              <header>
                <h2 className="card-title">Vorschläge</h2>
                <p className="card-subtitle">Übernehmen und die aufgewendete Zeit eintragen.</p>
              </header>
              {suggestionList("Erledigte Aufgaben", tasks, "Keine erledigte Aufgabe ohne Leistung an diesem Tag.")}
              {suggestionList("Massnahmen der Pflegeplanung", interventions, "Keine laufenden Massnahmen.")}
            </section>
          </div>
        </>
      )}
      {editing && resident && (
        <ServiceDialog
          residentId={resident.id}
          residentName={resident.name}
          day={day}
          initial={editing}
          catalog={catalog}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            showToast(message);
            data.reload();
          }}
        />
      )}
      {cancelling && (
        <ReasonDialog
          title="Leistung stornieren"
          description={`„${cancelling.title}“ (${formatMinutes(cancelling.minutes)}) bleibt sichtbar, zählt aber nicht mehr.`}
          label="Grund der Stornierung"
          placeholder="z. B. doppelt erfasst, falsche Person"
          submitLabel="Stornieren"
          danger
          onClose={() => setCancelling(null)}
          onConfirm={async (reason) => {
            await requestJson(`/api/services/${cancelling.id}/cancel`, { method: "POST", body: { reason } });
            setCancelling(null);
            showToast("Leistung storniert");
            data.reload();
          }}
        />
      )}
    </>
  );
}

// Dokumentation › Leistungen: erbrachte Leistungen der Person in der Kopfzeile für einen Tag.
export default function ServicesView() {
  return (
    <ModulePageShell
      activeModule="chart"
      activeChild="Leistungen"
      pageClass="documentation-page documentation-services"
    >
      {(showToast) => (
        <main className="workspace module-workspace documentation-workspace">
          <ServicesContent showToast={showToast} />
        </main>
      )}
    </ModulePageShell>
  );
}
