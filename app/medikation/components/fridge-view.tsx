"use client";

import { useState } from "react";
import {
  EditorDialog,
  EmptyState,
  LoadError,
  PageHeading,
  SummaryTiles,
  formatDateTime,
  requestJson,
  timeInZurich,
  todayInZurich,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import { formatCelsius, fridgeRange, type Fridge, type FridgeOverview } from "@/lib/fridges-shared";
import { CareDatePicker } from "@/app/components/care-form-controls";

type FridgeDraft = {
  id: string | null;
  name: string;
  location: string;
  minCelsius: string;
  maxCelsius: string;
  intervalHours: string;
  notes: string;
};
type ReadingDraft = { fridge: Fridge; day: string; time: string; celsius: string; note: string };

const EMPTY: FridgeDraft = {
  id: null,
  name: "",
  location: "",
  minCelsius: "",
  maxCelsius: "",
  intervalHours: "",
  notes: "",
};

const decimal = (value: number | null) => (value === null ? "" : String(value));
const parse = (value: string) => {
  const number = Number(value.trim().replace(",", "."));
  return value.trim() === "" || !Number.isFinite(number) ? null : number;
};

// Medikation › Kühlschrank: Temperaturprotokoll mit Grenzen und Messrhythmus der Einrichtung.
export default function FridgeView({ showToast }: { showToast: ShowToast }) {
  const { data, error, reload } = useApiData<FridgeOverview>("/api/fridges");
  const [draft, setDraft] = useState<FridgeDraft | null>(null);
  const [reading, setReading] = useState<ReadingDraft | null>(null);
  const [retiring, setRetiring] = useState<Fridge | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const active = (data?.fridges ?? []).filter((fridge) => !fridge.retired);

  async function run(action: () => Promise<unknown>, message: string) {
    setSaving(true);
    setFormError("");
    try {
      await action();
      reload();
      showToast(message);
      return true;
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  // Liegt der eingegebene Wert ausserhalb der Grenzen der Einrichtung?
  const readingOutside = (() => {
    if (!reading) return false;
    const value = parse(reading.celsius);
    if (value === null) return false;
    const { minCelsius, maxCelsius } = reading.fridge;
    return (minCelsius !== null && value < minCelsius) || (maxCelsius !== null && value > maxCelsius);
  })();

  return (
    <>
      <PageHeading
        eyebrow="Medikamente"
        title="Kühlschrank-Temperatur"
        description="Temperaturprotokoll der Medikamentenkühlschränke. Grenzen und Messrhythmus legt die Einrichtung je Kühlschrank fest; ohne Vorgabe erscheint kein Hinweis."
        action={
          data?.canManage
            ? {
                label: "Kühlschrank erfassen",
                onClick: () => {
                  setFormError("");
                  setDraft(EMPTY);
                },
              }
            : undefined
        }
      />
      {error && <LoadError message={error} onRetry={reload} />}
      {data && (
        <SummaryTiles
          label="Übersicht Kühlschränke"
          tiles={[
            { icon: "med", value: active.length, caption: "Kühlschränke in Betrieb" },
            {
              icon: "calendar",
              value: active.filter((fridge) => fridge.due).length,
              caption: "Messung fällig nach Messrhythmus",
              tone: active.some((fridge) => fridge.due) ? "attention" : undefined,
            },
            {
              icon: "alert",
              value: active.filter((fridge) => fridge.lastReading?.outside).length,
              caption: "letzte Messung ausserhalb der Grenzen",
              tone: active.some((fridge) => fridge.lastReading?.outside) ? "critical" : undefined,
            },
          ]}
        />
      )}
      {data && !data.fridges.length ? (
        <EmptyState
          title="Noch keine Kühlschränke erfasst"
          text={
            data.canManage
              ? "Kühlschrank mit Standort, Grenzen und Messrhythmus der Einrichtung erfassen."
              : "Die Leitung erfasst die Medikamentenkühlschränke mit Grenzen und Messrhythmus."
          }
        />
      ) : data ? (
        <section className="card device-list" aria-label="Kühlschränke">
          <ul>
            {data.fridges.map((fridge) => {
              const range = fridgeRange(fridge.minCelsius, fridge.maxCelsius);
              const last = fridge.lastReading;
              return (
                <li
                  key={fridge.id}
                  className={fridge.retired ? "retired" : fridge.due ? "due" : ""}
                  aria-label={fridge.name}
                >
                  <div>
                    <strong>
                      {fridge.name}
                      {last && (
                        <span className={`diagnosis-code ${last.outside ? "fridge-outside" : ""}`}>
                          {formatCelsius(last.celsius)}
                        </span>
                      )}
                    </strong>
                    <small>
                      {[
                        fridge.location,
                        range ? `Grenzen ${range}` : "Keine Grenzen festgelegt",
                        fridge.intervalHours ? `Messung alle ${fridge.intervalHours} Stunden` : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                    <small className="device-due">
                      {fridge.retired
                        ? `Ausser Betrieb: ${fridge.retired.reason}`
                        : last
                          ? `${fridge.due ? "Messung fällig · zuletzt" : "Zuletzt gemessen"} ${formatDateTime(last.measuredAt)}${last.recordedBy ? ` von ${last.recordedBy}` : ""}`
                          : fridge.intervalHours
                            ? "Messung fällig · noch keine Messung"
                            : "Noch keine Messung"}
                    </small>
                    {last?.outside && (
                      <small className="device-defect">Ausserhalb der Grenzen · Massnahme: {last.note}</small>
                    )}
                    {fridge.readings.length > 0 && (
                      <details className="diagnosis-resolved">
                        <summary>Messungen der letzten 31 Tage ({fridge.readings.length})</summary>
                        <ul className="device-checks">
                          {fridge.readings.map((item) => (
                            <li key={item.id} className={item.outside ? "device-defect" : undefined}>
                              {formatDateTime(item.measuredAt)} · {formatCelsius(item.celsius)}
                              {item.outside ? " · ausserhalb der Grenzen" : ""}
                              {item.recordedBy ? ` · ${item.recordedBy}` : ""}
                              {item.note ? ` · ${item.note}` : ""}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                  {!fridge.retired && (
                    <span className="device-actions">
                      {data.canRecord && (
                        <button
                          type="button"
                          className="death-checklist-action"
                          aria-label={`${fridge.name}: Messung erfassen`}
                          onClick={() => {
                            setFormError("");
                            setReading({ fridge, day: todayInZurich(), time: timeInZurich(), celsius: "", note: "" });
                          }}
                        >
                          Messung erfassen
                        </button>
                      )}
                      {data.canManage && (
                        <>
                          <button
                            type="button"
                            className="death-checklist-action"
                            aria-label={`${fridge.name} bearbeiten`}
                            onClick={() => {
                              setFormError("");
                              setDraft({
                                id: fridge.id,
                                name: fridge.name,
                                location: fridge.location,
                                minCelsius: decimal(fridge.minCelsius),
                                maxCelsius: decimal(fridge.maxCelsius),
                                intervalHours: fridge.intervalHours ? String(fridge.intervalHours) : "",
                                notes: fridge.notes,
                              });
                            }}
                          >
                            Bearbeiten
                          </button>
                          <button
                            type="button"
                            className="death-checklist-action"
                            aria-label={`${fridge.name} ausser Betrieb nehmen`}
                            onClick={() => {
                              setFormError("");
                              setReason("");
                              setRetiring(fridge);
                            }}
                          >
                            Ausser Betrieb
                          </button>
                        </>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        !error && <p className="record-export-note">Wird geladen …</p>
      )}

      {draft && (
        <EditorDialog
          id="fridge"
          eyebrow="Medikation · Kühlschrank-Temperatur"
          title={draft.id ? "Kühlschrank bearbeiten" : "Kühlschrank erfassen"}
          description="Grenzen und Messrhythmus legt die Einrichtung fest (z. B. nach Angaben der Hersteller der gelagerten Arzneimittel). Leer lassen, wenn keine gelten sollen."
          onClose={() => setDraft(null)}
          onSubmit={async () => {
            const saved = await run(
              () => requestJson("/api/fridges", { method: "POST", body: draft }),
              draft.id ? "Kühlschrank gespeichert" : "Kühlschrank erfasst",
            );
            if (saved) setDraft(null);
          }}
          saving={saving}
          error={formError}
          submitLabel="Kühlschrank speichern"
        >
          <label className="area-editor-wide">
            <span>Kühlschrank</span>
            <input
              required
              maxLength={160}
              placeholder="z. B. Medikamentenkühlschrank Stationszimmer"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label className="area-editor-wide">
            <span>Standort</span>
            <input
              maxLength={200}
              value={draft.location}
              onChange={(event) => setDraft({ ...draft, location: event.target.value })}
            />
          </label>
          <label>
            <span>Untere Grenze (°C)</span>
            <input
              inputMode="decimal"
              placeholder="laut Einrichtung"
              value={draft.minCelsius}
              onChange={(event) => setDraft({ ...draft, minCelsius: event.target.value.replace(/[^\d,.-]/g, "") })}
            />
          </label>
          <label>
            <span>Obere Grenze (°C)</span>
            <input
              inputMode="decimal"
              placeholder="laut Einrichtung"
              value={draft.maxCelsius}
              onChange={(event) => setDraft({ ...draft, maxCelsius: event.target.value.replace(/[^\d,.-]/g, "") })}
            />
          </label>
          <label>
            <span>Messrhythmus (Stunden)</span>
            <input
              inputMode="numeric"
              placeholder="laut Einrichtung"
              value={draft.intervalHours}
              onChange={(event) => setDraft({ ...draft, intervalHours: event.target.value.replace(/\D/g, "") })}
            />
          </label>
          <label className="area-editor-wide">
            <span>Bemerkung</span>
            <textarea
              rows={2}
              maxLength={2000}
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />
          </label>
        </EditorDialog>
      )}

      {reading && (
        <EditorDialog
          id="fridge-reading"
          eyebrow={reading.fridge.name}
          title="Messung erfassen"
          description={
            fridgeRange(reading.fridge.minCelsius, reading.fridge.maxCelsius)
              ? `Grenzen der Einrichtung: ${fridgeRange(reading.fridge.minCelsius, reading.fridge.maxCelsius)}.`
              : "Für diesen Kühlschrank sind keine Grenzen festgelegt."
          }
          onClose={() => setReading(null)}
          onSubmit={async () => {
            const saved = await run(
              () =>
                requestJson(`/api/fridges/${reading.fridge.id}/readings`, {
                  method: "POST",
                  body: { measuredAt: `${reading.day}T${reading.time}`, celsius: reading.celsius, note: reading.note },
                }),
              `${reading.fridge.name}: Messung erfasst`,
            );
            if (saved) setReading(null);
          }}
          saving={saving}
          error={formError}
          submitLabel="Messung speichern"
        >
          <label>
            <span>Datum</span>
            <CareDatePicker
              label="Datum"
              value={reading.day}
              max={todayInZurich()}
              onChange={(value) => setReading({ ...reading, day: value })}
            />
          </label>
          <label>
            <span>Uhrzeit</span>
            <input
              type="time"
              required
              value={reading.time}
              onChange={(event) => setReading({ ...reading, time: event.target.value })}
            />
          </label>
          <label>
            <span>Temperatur (°C)</span>
            <input
              required
              inputMode="decimal"
              value={reading.celsius}
              onChange={(event) => setReading({ ...reading, celsius: event.target.value.replace(/[^\d,.-]/g, "") })}
            />
          </label>
          {readingOutside && (
            <p className="area-editor-wide restraints-error" role="alert">
              Der Wert liegt ausserhalb der Grenzen der Einrichtung. Bitte die getroffene Massnahme angeben.
            </p>
          )}
          <label className="area-editor-wide">
            <span>{readingOutside ? "Massnahme" : "Bemerkung"}</span>
            <textarea
              rows={2}
              required={readingOutside}
              maxLength={2000}
              placeholder={
                readingOutside ? "z. B. Tür war offen, nach 30 Minuten erneut gemessen, Apotheke informiert" : ""
              }
              value={reading.note}
              onChange={(event) => setReading({ ...reading, note: event.target.value })}
            />
          </label>
        </EditorDialog>
      )}

      {retiring && (
        <EditorDialog
          id="fridge-retire"
          eyebrow={retiring.name}
          title="Ausser Betrieb nehmen"
          description="Der Kühlschrank bleibt mit seinen Messungen im Verzeichnis; es erscheinen keine Erinnerungen mehr."
          onClose={() => setRetiring(null)}
          onSubmit={async () => {
            if (!reason.trim()) return setFormError("Bitte den Grund angeben.");
            const done = await run(
              () => requestJson(`/api/fridges/${retiring.id}/retire`, { method: "POST", body: { reason } }),
              `${retiring.name}: ausser Betrieb`,
            );
            if (done) setRetiring(null);
          }}
          saving={saving}
          error={formError}
          submitLabel="Ausser Betrieb nehmen"
          danger
        >
          <label className="area-editor-wide">
            <span>Grund</span>
            <input
              required
              maxLength={500}
              placeholder="z. B. ersetzt durch neues Gerät"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        </EditorDialog>
      )}
    </>
  );
}
