"use client";

import { useTerms } from "@/app/components/care-context";
import { useState } from "react";
import { CareDatePicker, CareSelect } from "@/app/components/care-form-controls";
import type { StockItem } from "@/lib/medication-shared";
import { EditorDialog, formatNumber, requestJson, todayInZurich } from "@/app/components/workspace-ui";
import { WitnessFields, emptyWitness } from "./btm-witness";

const UNITS = ["Tabletten", "Kapseln", "Stk.", "Amp.", "ml", "Beutel", "Pens", "Pflaster", "Hübe", "Zäpfchen"];

export type ReceiptPreset = {
  residentId?: string;
  residentName?: string;
  name?: string;
  strength?: string;
  form?: string;
  unit?: string;
};

// Goods receipt: into an existing stock row, or a new ward/resident stock row.
export function ReceiptDialog({
  items,
  careUnits,
  residents,
  preset,
  controlledNames = [],
  onClose,
  onSaved,
}: {
  items: StockItem[];
  careUnits: Array<{ id: string; name: string }>;
  residents: Array<{ id: string; name: string }>;
  preset?: ReceiptPreset;
  // Namen der Betäubungsmittel (klein geschrieben): ein neuer Bestand davon braucht die Zweitunterschrift.
  controlledNames?: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const t = useTerms();
  const [mode, setMode] = useState<"existing" | "new">(items.length && !preset ? "existing" : "new");
  const [stockId, setStockId] = useState(items[0]?.id ?? "");
  const [owner, setOwner] = useState<"unit" | "resident">(preset?.residentId ? "resident" : "unit");
  const [careUnitId, setCareUnitId] = useState(careUnits[0]?.id ?? "");
  const [residentId, setResidentId] = useState(preset?.residentId ?? residents[0]?.id ?? "");
  const [form, setForm] = useState({
    name: preset?.name ?? "",
    strength: preset?.strength ?? "",
    form: preset?.form ?? "",
    unit: preset?.unit ?? "Tabletten",
    quantity: "",
    minimum: "",
    expiresOn: "",
    batch: "",
    location: "",
    note: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const labelOf = (item: StockItem) =>
    `${item.name} ${item.strength} · ${item.owner}${item.batch ? ` · Charge ${item.batch}` : ""} (${formatNumber(item.quantity)} ${item.unit})`;
  const selected = items.find((item) => item.id === stockId);
  const [witness, setWitness] = useState(emptyWitness);
  // Meldet der Server ein Betäubungsmittel, erscheinen die Felder für die Zweitunterschrift.
  const [witnessRequested, setWitnessRequested] = useState(false);
  const needsWitness =
    witnessRequested ||
    (mode === "existing"
      ? Boolean(selected?.controlled)
      : controlledNames.includes(form.name.trim().toLocaleLowerCase("de-CH")));

  async function save() {
    const quantity = Number(form.quantity.replace(",", "."));
    setSaving(true);
    setError("");
    try {
      const body =
        mode === "existing"
          ? { stockId, quantity, note: form.note, ...(needsWitness ? { witness } : {}) }
          : {
              ...form,
              quantity,
              minimum: form.minimum ? Number(form.minimum.replace(",", ".")) : null,
              expiresOn: form.expiresOn || null,
              residentId: owner === "resident" ? residentId : null,
              careUnitId: owner === "unit" ? careUnitId : null,
              ...(needsWitness ? { witness } : {}),
            };
      await requestJson("/api/medication/stock", { method: "POST", body });
      onSaved(`Wareneingang gebucht: ${mode === "existing" ? selected?.name : form.name} +${formatNumber(quantity)}`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Wareneingang konnte nicht gebucht werden.";
      if (/Zweitunterschrift/.test(message)) setWitnessRequested(true);
      setError(message);
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="med-receipt"
      eyebrow="Medikamente · Bestand"
      title={preset?.residentName ? `Eingang für ${preset.residentName}` : "Wareneingang buchen"}
      description="Jeder Eingang wird mit Menge, Person und Zeitpunkt im Bestandsjournal protokolliert."
      onClose={onClose}
      onSubmit={save}
      saving={saving}
      error={error}
      submitLabel="Eingang buchen"
    >
      {items.length > 0 && !preset && (
        <div className="appointment-kind-switch area-editor-wide" role="group" aria-label="Art des Eingangs">
          <button
            type="button"
            className={mode === "existing" ? "active" : ""}
            aria-pressed={mode === "existing"}
            onClick={() => setMode("existing")}
          >
            Vorhandener Bestand
          </button>
          <button
            type="button"
            className={mode === "new" ? "active" : ""}
            aria-pressed={mode === "new"}
            onClick={() => setMode("new")}
          >
            Neuer Artikel / neue Charge
          </button>
        </div>
      )}
      {mode === "existing" ? (
        <label className="area-editor-wide">
          <span>Bestand</span>
          <CareSelect
            label="Bestand"
            value={selected ? labelOf(selected) : "Bestand wählen"}
            options={items.map(labelOf)}
            onChange={(value) => setStockId(items.find((item) => labelOf(item) === value)?.id ?? stockId)}
          />
        </label>
      ) : (
        <>
          {!preset?.residentId && (
            <div className="appointment-kind-switch area-editor-wide" role="group" aria-label="Bestandsart">
              <button
                type="button"
                className={owner === "unit" ? "active" : ""}
                aria-pressed={owner === "unit"}
                onClick={() => setOwner("unit")}
              >
                Stationsbestand
              </button>
              <button
                type="button"
                className={owner === "resident" ? "active" : ""}
                aria-pressed={owner === "resident"}
                onClick={() => setOwner("resident")}
              >
                {t.prefix}eigener Bestand
              </button>
            </div>
          )}
          {!preset?.residentId && (
            <label className="area-editor-wide">
              <span>{owner === "unit" ? "Wohnbereich" : t.one}</span>
              {owner === "unit" ? (
                <CareSelect
                  label="Wohnbereich"
                  value={careUnits.find((u) => u.id === careUnitId)?.name ?? "Wohnbereich wählen"}
                  options={careUnits.map((u) => u.name)}
                  onChange={(value) => setCareUnitId(careUnits.find((u) => u.name === value)?.id ?? careUnitId)}
                />
              ) : (
                <CareSelect
                  label={t.one}
                  value={residents.find((r) => r.id === residentId)?.name ?? `${t.oneOblique} wählen`}
                  options={residents.map((r) => r.name)}
                  onChange={(value) => setResidentId(residents.find((r) => r.name === value)?.id ?? residentId)}
                />
              )}
            </label>
          )}
          <label>
            <span>Präparat</span>
            <input
              required
              maxLength={220}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              readOnly={Boolean(preset?.name)}
            />
          </label>
          <label>
            <span>Stärke</span>
            <input
              maxLength={80}
              value={form.strength}
              onChange={(e) => set("strength", e.target.value)}
              readOnly={Boolean(preset?.name)}
            />
          </label>
          <label>
            <span>Einheit</span>
            <CareSelect label="Einheit" value={form.unit} options={UNITS} onChange={(v) => set("unit", v)} />
          </label>
          <label>
            <span>Mindestbestand</span>
            <input
              inputMode="decimal"
              value={form.minimum}
              onChange={(e) => set("minimum", e.target.value)}
              placeholder="optional"
            />
          </label>
          <label>
            <span>Verfalldatum</span>
            {form.expiresOn ? (
              <CareDatePicker label="Verfalldatum" value={form.expiresOn} onChange={(v) => set("expiresOn", v)} />
            ) : (
              <button className="secondary-button" type="button" onClick={() => set("expiresOn", todayInZurich())}>
                Datum wählen
              </button>
            )}
          </label>
          <label>
            <span>Charge</span>
            <input
              maxLength={100}
              value={form.batch}
              onChange={(e) => set("batch", e.target.value)}
              placeholder="optional"
            />
          </label>
          <label className="area-editor-wide">
            <span>Lagerort</span>
            <input
              maxLength={160}
              value={form.location}
              onChange={(e) => set("location", e.target.value)}
              placeholder="z. B. Medikamentenraum · Fach A2"
            />
          </label>
        </>
      )}
      <label>
        <span>Menge</span>
        <input
          required
          inputMode="decimal"
          value={form.quantity}
          onChange={(e) => set("quantity", e.target.value)}
          placeholder="z. B. 20"
        />
      </label>
      <label className={mode === "existing" ? "" : "area-editor-wide"}>
        <span>Bemerkung</span>
        <input
          maxLength={1000}
          value={form.note}
          onChange={(e) => set("note", e.target.value)}
          placeholder="z. B. Lieferung Apotheke"
        />
      </label>
      {needsWitness && <WitnessFields value={witness} onChange={setWitness} />}
    </EditorDialog>
  );
}

// Stocktaking correction or disposal: sets the counted quantity and journals the difference.
export function CorrectionDialog({
  item,
  onClose,
  onSaved,
}: {
  item: StockItem;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [reason, setReason] = useState<"correction" | "disposal">("correction");
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [minimum, setMinimum] = useState(item.minimum === null ? "" : String(item.minimum));
  const [expiresOn, setExpiresOn] = useState(item.expiresOn);
  const [location, setLocation] = useState(item.location);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [witness, setWitness] = useState(emptyWitness);
  const changesQuantity = Number(quantity.replace(",", ".")) !== item.quantity;

  async function save() {
    setSaving(true);
    setError("");
    try {
      await requestJson(`/api/medication/stock/${item.id}`, {
        method: "PATCH",
        body: {
          quantity: Number(quantity.replace(",", ".")),
          minimum: minimum ? Number(minimum.replace(",", ".")) : null,
          expiresOn,
          location,
          note,
          reason,
          ...(item.controlled && changesQuantity ? { witness } : {}),
        },
      });
      onSaved(`${item.name}: Bestand aktualisiert`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Bestand konnte nicht gespeichert werden.");
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="med-correction"
      eyebrow={`Medikamente · ${item.owner}`}
      title={`${item.name} ${item.strength}`.trim()}
      description={`Aktueller Bestand: ${formatNumber(item.quantity)} ${item.unit}. Abweichungen werden mit Grund im Journal protokolliert.`}
      onClose={onClose}
      onSubmit={save}
      saving={saving}
      error={error}
      submitLabel="Speichern"
    >
      <div className="appointment-kind-switch area-editor-wide" role="group" aria-label="Art der Änderung">
        <button
          type="button"
          className={reason === "correction" ? "active" : ""}
          aria-pressed={reason === "correction"}
          onClick={() => setReason("correction")}
        >
          Zählung / Korrektur
        </button>
        <button
          type="button"
          className={reason === "disposal" ? "active" : ""}
          aria-pressed={reason === "disposal"}
          onClick={() => setReason("disposal")}
        >
          Entsorgung
        </button>
      </div>
      <label>
        <span>
          {reason === "disposal" ? "Bestand nach Entsorgung" : "Gezählter Bestand"} ({item.unit})
        </span>
        <input required inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </label>
      <label>
        <span>Mindestbestand</span>
        <input
          inputMode="decimal"
          value={minimum}
          onChange={(e) => setMinimum(e.target.value)}
          placeholder="optional"
        />
      </label>
      <label>
        <span>Verfalldatum</span>
        {expiresOn ? (
          <CareDatePicker label="Verfalldatum" value={expiresOn} onChange={setExpiresOn} />
        ) : (
          <button className="secondary-button" type="button" onClick={() => setExpiresOn(todayInZurich())}>
            Datum wählen
          </button>
        )}
      </label>
      <label>
        <span>Lagerort</span>
        <input maxLength={160} value={location} onChange={(e) => setLocation(e.target.value)} />
      </label>
      <label className="area-editor-wide">
        <span>Grund</span>
        <input
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Pflicht bei Mengenänderung, z. B. Monatsinventur oder abgelaufene Charge"
        />
      </label>
      {item.controlled && changesQuantity && <WitnessFields value={witness} onChange={setWitness} />}
    </EditorDialog>
  );
}
