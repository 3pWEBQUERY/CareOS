"use client";

import { useState } from "react";
import { useHeaderResident, useTerms, useWorkContext } from "@/app/components/care-context";
import HeaderResidentHint from "@/app/components/header-resident-hint";
import ModulePageShell from "@/app/components/module-page-shell";
import { sendOrQueue } from "@/app/components/offline-queue";
import {
  EditorDialog,
  EmptyState,
  LoadError,
  PageHeading,
  ReasonDialog,
  SummaryTiles,
  formatDate,
  formatDateTime,
  requestJson,
  timeInZurich,
  todayInZurich,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import { zurichTimeToIso } from "@/lib/resident-appointments";
import {
  BRISTOL_TYPES,
  ELIMINATION_AMOUNTS,
  ELIMINATION_KINDS,
  type EliminationAmount,
  type EliminationEntry,
  type EliminationKind,
  type EliminationView as View,
} from "@/lib/elimination-shared";

const KIND_KEYS = Object.keys(ELIMINATION_KINDS) as EliminationKind[];
const AMOUNT_KEYS = Object.keys(ELIMINATION_AMOUNTS) as EliminationAmount[];
const STOOL: EliminationKind[] = ["stool", "incontinence_stool"];
const RANGES = [
  [3, "3 Tage"],
  [7, "7 Tage"],
  [14, "14 Tage"],
] as const;

const timeOf = (iso: string) => timeInZurich(new Date(iso));
const dayOf = (iso: string) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(new Date(iso)).slice(0, 10);

function Choices<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<[T, string]>;
  value: T | null;
  onChange: (value: T | null) => void;
}) {
  return (
    <div className="repositioning-choices" role="group" aria-label={label}>
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          className={`day-toggle ${value === key ? "active" : ""}`}
          aria-pressed={value === key}
          onClick={() => onChange(value === key ? null : key)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function EntryDialog({
  residentId,
  residentName,
  onClose,
  onSaved,
}: {
  residentId: string;
  residentName: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [kind, setKind] = useState<EliminationKind | null>(null);
  const [bristol, setBristol] = useState<number | null>(null);
  const [volume, setVolume] = useState<EliminationAmount | null>(null);
  const [material, setMaterial] = useState("");
  const [time, setTime] = useState(timeInZurich);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const stool = kind !== null && STOOL.includes(kind);

  async function submit() {
    if (!kind) return setError("Bitte die Art wählen.");
    setSaving(true);
    setError("");
    try {
      const result = await sendOrQueue(
        "/api/elimination",
        {
          residentId,
          kind,
          bristol: stool ? bristol : null,
          volume: kind === "material" ? null : volume,
          material: kind === "material" || kind.startsWith("incontinence") ? material : "",
          note,
          occurredAt: zurichTimeToIso(todayInZurich(), time),
        },
        `${ELIMINATION_KINDS[kind]} · ${residentName}`,
        { field: "note", label: "Bemerkung" },
      );
      onSaved(
        `${residentName}: ${ELIMINATION_KINDS[kind]} erfasst${result.queued ? " (offline – wird gesendet, sobald die Verbindung zurück ist)" : ""}`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="elimination-entry"
      eyebrow={`${residentName} · ${formatDate(todayInZurich())}`}
      title="Ausscheidung erfassen"
      description="Beobachtung festhalten; die Stuhlform nach der Bristol-Stuhlformen-Skala."
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel="Speichern"
    >
      <fieldset className="area-editor-wide">
        <legend>Art</legend>
        <Choices
          label="Art"
          options={KIND_KEYS.map((key) => [key, ELIMINATION_KINDS[key]])}
          value={kind}
          onChange={setKind}
        />
      </fieldset>
      {stool && (
        <fieldset className="area-editor-wide">
          <legend>Stuhlform (optional)</legend>
          <Choices
            label="Stuhlform"
            options={Object.entries(BRISTOL_TYPES).map(([key, text]) => [Number(key), text])}
            value={bristol}
            onChange={setBristol}
          />
        </fieldset>
      )}
      {kind && kind !== "material" && (
        <fieldset className="area-editor-wide">
          <legend>Menge (optional)</legend>
          <Choices
            label="Menge"
            options={AMOUNT_KEYS.map((key) => [key, ELIMINATION_AMOUNTS[key]])}
            value={volume}
            onChange={setVolume}
          />
        </fieldset>
      )}
      {kind && (kind === "material" || kind.startsWith("incontinence")) && (
        <label className="area-editor-wide">
          <span>{kind === "material" ? "Material" : "Material (optional)"}</span>
          <input
            maxLength={200}
            required={kind === "material"}
            placeholder="z. B. Einlage, Pants, Unterlage"
            value={material}
            onChange={(event) => setMaterial(event.target.value)}
          />
        </label>
      )}
      <label>
        <span>Uhrzeit</span>
        <input type="time" required value={time} onChange={(event) => setTime(event.target.value)} />
      </label>
      <label className="area-editor-wide">
        <span>Bemerkung (optional)</span>
        <input maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
    </EditorDialog>
  );
}

function EntryItem({
  entry,
  onCancel,
}: {
  entry: EliminationEntry;
  onCancel: ((entry: EliminationEntry) => void) | null;
}) {
  const details = [
    entry.bristol ? BRISTOL_TYPES[entry.bristol] : null,
    entry.volume ? `Menge: ${ELIMINATION_AMOUNTS[entry.volume]}` : null,
    entry.material || null,
    entry.author,
  ].filter(Boolean);
  return (
    <li className={entry.cancelled ? "cancelled" : ""}>
      <time dateTime={entry.occurredAt}>{timeOf(entry.occurredAt)}</time>
      <div>
        <strong>{ELIMINATION_KINDS[entry.kind]}</strong>
        <small>{details.join(" · ")}</small>
        {entry.note && <p>{entry.note}</p>}
        {entry.cancelled && <p className="service-cancel-reason">Storniert: {entry.cancelled.reason}</p>}
      </div>
      {onCancel && !entry.cancelled && (
        <button className="secondary-button" type="button" onClick={() => onCancel(entry)}>
          Stornieren
        </button>
      )}
    </li>
  );
}

function EliminationContent({ showToast }: { showToast: ShowToast }) {
  const t = useTerms();
  const context = useWorkContext();
  const residents = context?.residents ?? [];
  const { resident, missing } = useHeaderResident(residents, !context);
  const [days, setDays] = useState<number>(3);
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<EliminationEntry | null>(null);
  const data = useApiData<View>(resident ? `/api/elimination?residentId=${resident.id}&days=${days}` : null);
  const view = data.data?.residentId === resident?.id ? data.data : null;
  const canWrite = view?.canWrite ?? false;
  const done = (message: string) => {
    setAdding(false);
    setCancelling(null);
    showToast(message);
    data.reload();
  };
  const active = view?.entries.filter((entry) => !entry.cancelled) ?? [];
  const overdue = view?.overdue ?? false;
  const dayList = [...new Set(view?.entries.map((entry) => dayOf(entry.occurredAt)) ?? [])];
  const sinceText =
    view?.daysSinceStool === null || view?.daysSinceStool === undefined
      ? "–"
      : view.daysSinceStool === 0
        ? "heute"
        : `vor ${view.daysSinceStool} ${view.daysSinceStool === 1 ? "Tag" : "Tagen"}`;

  return (
    <>
      <PageHeading
        eyebrow="Dokumentation"
        title="Ausscheidung & Kontinenz"
        description={`Stuhlgang, Wasserlassen, Inkontinenz und Materialwechsel je ${t.one}. Ein Hinweis in der Tagesliste erscheint nur mit der Tageszahl der Einrichtung.`}
        action={resident && canWrite ? { label: "Ausscheidung erfassen", onClick: () => setAdding(true) } : undefined}
      />
      {!resident ? (
        <HeaderResidentHint loading={!context} missing={missing} />
      ) : (
        <>
          <section className="service-toolbar">
            <div className="repositioning-range" role="group" aria-label="Zeitraum">
              {RANGES.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`day-toggle ${days === value ? "active" : ""}`}
                  aria-pressed={days === value}
                  onClick={() => setDays(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p>
              {resident.name} · {resident.room}
            </p>
          </section>
          <SummaryTiles
            label="Ausscheidung"
            tiles={[
              {
                icon: "calendar",
                value: view ? sinceText : "–",
                caption: "letzter Stuhlgang",
                tone: overdue ? "attention" : undefined,
              },
              {
                icon: "note",
                value: view ? active.filter((entry) => STOOL.includes(entry.kind)).length : "–",
                caption: "Stuhlgänge im Zeitraum",
              },
              {
                icon: "check",
                value: view ? active.filter((entry) => entry.kind.startsWith("incontinence")).length : "–",
                caption: "Inkontinenzereignisse im Zeitraum",
              },
            ]}
          />
          {data.error && <LoadError message={data.error} onRetry={data.reload} />}
          <section className="card service-records repositioning-entries" aria-label="Verlauf der Ausscheidung">
            <header>
              <h2 className="card-title">Verlauf</h2>
              <p className="card-subtitle">
                {view?.lastStoolAt
                  ? `Letzter Stuhlgang ${formatDateTime(view.lastStoolAt)}`
                  : "Noch kein Stuhlgang dokumentiert"}
                {view?.reminderDays ? ` · Hinweis ab ${view.reminderDays} Tagen` : ""}
              </p>
            </header>
            {view && !view.entries.length ? (
              <EmptyState icon="note" title="Keine Einträge" text="Im gewählten Zeitraum ist nichts erfasst." />
            ) : (
              dayList.map((day) => (
                <div key={day} className="repositioning-day">
                  <h3>{formatDate(day)}</h3>
                  <ul>
                    {view?.entries
                      .filter((entry) => dayOf(entry.occurredAt) === day)
                      .map((entry) => (
                        <EntryItem key={entry.id} entry={entry} onCancel={canWrite ? setCancelling : null} />
                      ))}
                  </ul>
                </div>
              ))
            )}
          </section>
        </>
      )}
      {adding && resident && (
        <EntryDialog
          residentId={resident.id}
          residentName={resident.name}
          onClose={() => setAdding(false)}
          onSaved={done}
        />
      )}
      {cancelling && (
        <ReasonDialog
          title="Eintrag stornieren"
          description={`„${ELIMINATION_KINDS[cancelling.kind]}“ um ${timeOf(cancelling.occurredAt)} bleibt sichtbar, zählt aber nicht mehr.`}
          label="Grund der Stornierung"
          placeholder="z. B. doppelt erfasst, falsche Person"
          submitLabel="Stornieren"
          danger
          onClose={() => setCancelling(null)}
          onConfirm={async (reason) => {
            await requestJson(`/api/elimination/${cancelling.id}/cancel`, { method: "POST", body: { reason } });
            done("Eintrag storniert");
          }}
        />
      )}
    </>
  );
}

// Dokumentation › Ausscheidung: Ausscheidung und Kontinenz der Person in der Kopfzeile.
export default function EliminationView() {
  return (
    <ModulePageShell
      activeModule="chart"
      activeChild="Ausscheidung"
      pageClass="documentation-page documentation-elimination"
    >
      {(showToast) => (
        <main className="workspace module-workspace documentation-workspace">
          <EliminationContent showToast={showToast} />
        </main>
      )}
    </ModulePageShell>
  );
}
