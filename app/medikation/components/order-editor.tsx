"use client";

import { useState } from "react";
import { X } from "@phosphor-icons/react";
import { CareDatePicker, CareOptionSelect, CareSelect } from "@/app/components/care-form-controls";
import { WEEKDAYS, type MedOrder, type OrderInput } from "@/lib/medication-shared";
import { EditorDialog, requestJson, todayInZurich } from "@/app/components/workspace-ui";

// Auswahl innerhalb der Grenzen, die der Server annimmt (1–24 Gaben, 0,5–72 Stunden); die Werte legt die Verordnung fest.
const MAX_DOSES = Array.from({ length: 24 }, (_, index) => index + 1);
const INTERVALS = [...Array.from({ length: 24 }, (_, index) => (index + 1) / 2), 14, 16, 18, 20, 24, 36, 48, 72];
const hours = (value: number) =>
  `${value.toLocaleString("de-CH", { maximumFractionDigits: 1 })} ${value === 1 ? "Stunde" : "Stunden"}`;

const ROUTES = [
  "oral",
  "sublingual",
  "subkutan",
  "intramuskulär",
  "transdermal",
  "inhalativ",
  "rektal",
  "lokal",
  "Augentropfen",
  "Ohrentropfen",
  "nasal",
];
const FORMS = [
  "Tablette",
  "Filmtablette",
  "Kapsel",
  "Tropfen",
  "Sirup",
  "Brausetablette",
  "Pflaster",
  "Injektion",
  "Pen",
  "Spray",
  "Salbe",
  "Zäpfchen",
  "Beutel",
];
const TIMES = Array.from(
  { length: 48 },
  (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`,
);

function draftFromOrder(order: MedOrder | null, isPrn: boolean): OrderInput {
  if (!order)
    return {
      name: "",
      strength: "",
      form: "Tablette",
      route: "oral",
      amount: "",
      stockQuantity: 1,
      times: isPrn ? [] : ["08:00"],
      weekdays: [],
      isPrn,
      // Grenzen und Kontrollzeitpunkt stammen aus der ärztlichen Verordnung: keine Vorgabewerte.
      maxDosesPer24h: null,
      minIntervalHours: null,
      effectCheckMinutes: null,
      prnInstructions: "",
      indication: "",
      prescribedBy: "",
      startOn: todayInZurich(),
      endOn: null,
    };
  return {
    name: order.name,
    strength: order.strength,
    form: order.form,
    route: order.route || "oral",
    amount: order.amount,
    stockQuantity: order.stockQuantity,
    times: order.times,
    weekdays: order.weekdays,
    isPrn: order.isPrn,
    maxDosesPer24h: order.maxDosesPer24h,
    minIntervalHours: order.minIntervalHours,
    effectCheckMinutes: order.effectCheckMinutes,
    prnInstructions: order.prnInstructions,
    indication: order.indication,
    prescribedBy: order.prescribedBy,
    startOn: order.startOn ?? todayInZurich(),
    endOn: order.endOn,
  };
}

export default function OrderEditor({
  residentId,
  residentName,
  order,
  isPrn,
  onClose,
  onSaved,
  onChangeStatus,
}: {
  residentId: string;
  residentName: string;
  order: MedOrder | null;
  isPrn: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
  onChangeStatus?: (status: "active" | "paused" | "stopped") => void;
}) {
  const [draft, setDraft] = useState<OrderInput>(() => draftFromOrder(order, isPrn));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const update = <K extends keyof OrderInput>(key: K, value: OrderInput[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const legacyPrn = Boolean(order?.isPrn && (!order.maxDosesPer24h || !order.minIntervalHours));

  async function save() {
    setSaving(true);
    setError("");
    try {
      if (order) await requestJson(`/api/medication/orders/${order.id}`, { method: "PATCH", body: draft });
      else await requestJson("/api/medication/orders", { method: "POST", body: { ...draft, residentId } });
      onSaved(order ? `${draft.name}: Verordnung aktualisiert` : `${draft.name}: Verordnung erfasst`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Verordnung konnte nicht gespeichert werden.");
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="med-order"
      eyebrow={`Medikamente · ${residentName}`}
      title={order ? "Verordnung bearbeiten" : isPrn ? "Reserve verordnen" : "Verordnung erfassen"}
      description={
        isPrn
          ? "Bedarfsmedikation nur mit ärztlicher Verordnung. Maximaldosis und Mindestabstand werden bei jeder Gabe geprüft."
          : "Die Einnahmezeiten erscheinen automatisch in der Medikamentenrunde."
      }
      onClose={onClose}
      onSubmit={save}
      saving={saving}
      error={error}
      submitLabel={order ? "Änderungen speichern" : "Verordnung speichern"}
      extraActions={
        order &&
        onChangeStatus && (
          <>
            <button className="appointment-delete-button" type="button" onClick={() => onChangeStatus("stopped")}>
              Absetzen
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => onChangeStatus(order.status === "paused" ? "active" : "paused")}
            >
              {order.status === "paused" ? "Fortsetzen" : "Pausieren"}
            </button>
          </>
        )
      }
    >
      {legacyPrn && (
        <p className="form-note area-editor-wide" role="note">
          Dieser Reserve fehlen strukturierte Grenzwerte. Bitte Maximaldosis und Mindestabstand ergänzen, damit Gaben
          dokumentiert werden können.
        </p>
      )}
      <label>
        <span>Präparat</span>
        <input
          required
          maxLength={220}
          value={draft.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="z. B. Metoprolol"
        />
      </label>
      <label>
        <span>Stärke</span>
        <input
          maxLength={80}
          value={draft.strength}
          onChange={(e) => update("strength", e.target.value)}
          placeholder="z. B. 50 mg"
        />
      </label>
      <label>
        <span>Darreichungsform</span>
        <CareSelect
          label="Darreichungsform"
          value={draft.form || "Bitte wählen"}
          options={FORMS}
          onChange={(v) => update("form", v)}
        />
      </label>
      <label>
        <span>Applikationsweg</span>
        <CareSelect label="Applikationsweg" value={draft.route} options={ROUTES} onChange={(v) => update("route", v)} />
      </label>
      <label>
        <span>{isPrn ? "Einzeldosis" : "Dosis je Gabe"}</span>
        <input
          required
          maxLength={120}
          value={draft.amount}
          onChange={(e) => {
            // Keep the stock quantity in step with a leading number in the dose, e.g. "2 Tabletten".
            const leading = /^\s*(\d+(?:[.,]\d+)?)\s/.exec(e.target.value);
            setDraft((current) => ({
              ...current,
              amount: e.target.value,
              stockQuantity: leading ? Number(leading[1].replace(",", ".")) : current.stockQuantity,
            }));
          }}
          placeholder="z. B. 1 Tablette"
        />
      </label>
      <label>
        <span>Bestandsabbuchung je Gabe</span>
        <input
          type="number"
          min={0}
          max={100}
          step={0.5}
          value={draft.stockQuantity ?? ""}
          onChange={(e) => update("stockQuantity", e.target.value ? Number(e.target.value) : null)}
          placeholder="leer = keine Abbuchung"
        />
      </label>
      <label>
        <span>Indikation</span>
        <input
          required={isPrn}
          maxLength={240}
          value={draft.indication}
          onChange={(e) => update("indication", e.target.value)}
          placeholder={isPrn ? "z. B. Schmerzen ab NRS 3" : "z. B. Arterielle Hypertonie"}
        />
      </label>
      {isPrn ? (
        <>
          <label>
            <span>Max. Gaben pro 24 h</span>
            <CareOptionSelect
              label="Max. Gaben pro 24 h"
              value={draft.maxDosesPer24h ? String(draft.maxDosesPer24h) : ""}
              placeholder="Bitte wählen"
              onChange={(value) => update("maxDosesPer24h", value ? Number(value) : null)}
              options={[
                // Ein früher erfasster Wert ausserhalb der Liste bleibt wählbar.
                ...(draft.maxDosesPer24h && !MAX_DOSES.includes(draft.maxDosesPer24h)
                  ? [{ value: String(draft.maxDosesPer24h), label: `${draft.maxDosesPer24h} Gaben` }]
                  : []),
                ...MAX_DOSES.map((count) => ({
                  value: String(count),
                  label: `${count} ${count === 1 ? "Gabe" : "Gaben"}`,
                })),
              ]}
            />
          </label>
          <label>
            <span>Mindestabstand (Stunden)</span>
            <CareOptionSelect
              label="Mindestabstand (Stunden)"
              value={draft.minIntervalHours ? String(draft.minIntervalHours) : ""}
              placeholder="Bitte wählen"
              onChange={(value) => update("minIntervalHours", value ? Number(value) : null)}
              options={[
                ...(draft.minIntervalHours && !INTERVALS.includes(draft.minIntervalHours)
                  ? [{ value: String(draft.minIntervalHours), label: hours(draft.minIntervalHours) }]
                  : []),
                ...INTERVALS.map((value) => ({ value: String(value), label: hours(value) })),
              ]}
            />
          </label>
          <label>
            <span>Wirkungskontrolle nach (Minuten)</span>
            <input
              type="number"
              min={5}
              max={1440}
              step={5}
              value={draft.effectCheckMinutes ?? ""}
              onChange={(e) => update("effectCheckMinutes", e.target.value ? Number(e.target.value) : null)}
              placeholder="gemäss Verordnung"
            />
          </label>
          <label className="area-editor-wide">
            <span>Hinweise zur Anwendung</span>
            <textarea
              rows={2}
              maxLength={2000}
              value={draft.prnInstructions}
              onChange={(e) => update("prnInstructions", e.target.value)}
              placeholder="z. B. Bei fehlender Wirkung nach 1 h Arzt informieren."
            />
          </label>
        </>
      ) : (
        <>
          <div className="area-editor-wide form-field">
            <span>Einnahmezeiten</span>
            <div className="chip-row">
              {draft.times.map((time) => (
                <span className="chip" key={time}>
                  {time}
                  <button
                    type="button"
                    aria-label={`${time} entfernen`}
                    onClick={() =>
                      update(
                        "times",
                        draft.times.filter((t) => t !== time),
                      )
                    }
                  >
                    <X />
                  </button>
                </span>
              ))}
              <div className="chip-add">
                <CareSelect
                  label="Einnahmezeit hinzufügen"
                  value="+ Zeit hinzufügen"
                  options={TIMES.filter((t) => !draft.times.includes(t))}
                  onChange={(v) => update("times", [...draft.times, v].sort())}
                />
              </div>
            </div>
          </div>
          <div className="area-editor-wide form-field">
            <span>Wochentage</span>
            <div className="chip-row" role="group" aria-label="Wochentage">
              {WEEKDAYS.map((day, index) => {
                const value = index + 1;
                const active = draft.weekdays.includes(value);
                return (
                  <button
                    type="button"
                    key={day}
                    className={`day-toggle ${active ? "active" : ""}`}
                    aria-pressed={active}
                    onClick={() =>
                      update(
                        "weekdays",
                        active ? draft.weekdays.filter((d) => d !== value) : [...draft.weekdays, value].sort(),
                      )
                    }
                  >
                    {day}
                  </button>
                );
              })}
              <small>{draft.weekdays.length ? "nur an den gewählten Tagen" : "täglich"}</small>
            </div>
          </div>
        </>
      )}
      <label>
        <span>Verordnet von</span>
        <input
          required
          maxLength={160}
          value={draft.prescribedBy}
          onChange={(e) => update("prescribedBy", e.target.value)}
          placeholder="z. B. Dr. Martin Weber"
        />
      </label>
      <label>
        <span>Gültig ab</span>
        <CareDatePicker label="Gültig ab" value={draft.startOn} onChange={(v) => update("startOn", v)} />
      </label>
      <div className="form-field">
        <span>Befristung</span>
        <label className="form-checkbox">
          <input
            type="checkbox"
            checked={draft.endOn !== null}
            onChange={(e) => update("endOn", e.target.checked ? draft.startOn : null)}
          />
          befristet
        </label>
      </div>
      {draft.endOn !== null && (
        <label>
          <span>Gültig bis</span>
          <CareDatePicker label="Gültig bis" value={draft.endOn} onChange={(v) => update("endOn", v)} />
        </label>
      )}
    </EditorDialog>
  );
}
