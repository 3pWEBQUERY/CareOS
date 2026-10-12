"use client";

import { useState } from "react";
import { CareDatePicker, CareSelect } from "@/app/components/care-form-controls";
import { EditorDialog, requestJson, timeInZurich, todayInZurich } from "@/app/components/workspace-ui";
import { zurichTimeToIso } from "@/lib/resident-appointments";
import {
  ASSISTANCE,
  BEVERAGES,
  DIETS,
  MEALS,
  MEAL_RHYTHMS,
  PORTIONS,
  TEXTURES,
  type NutritionPlan,
} from "@/lib/nutrition-shared";
import { sendOrQueue } from "@/app/components/offline-queue";

type Base = { residentId: string; residentName: string; onClose: () => void; onSaved: (message: string) => void };
const NONE = "Nicht festgelegt";
const int = (value: string) => (value.trim() ? Number(value) : null);

function useSave(onSaved: (message: string) => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async (request: () => Promise<unknown>, message: string) => {
    setSaving(true);
    setError("");
    try {
      const result = await request();
      const queued = !!result && typeof result === "object" && "queued" in result && result.queued === true;
      onSaved(queued ? `${message} (offline gespeichert – wird gesendet, sobald die Verbindung zurück ist)` : message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  };
  return { saving, error, save };
}

export function PlanDialog({
  residentId,
  residentName,
  plan,
  onClose,
  onSaved,
}: Base & { plan: NutritionPlan | null }) {
  const [form, setForm] = useState({
    diet: plan?.diet ?? DIETS[0],
    texture: plan?.texture ?? TEXTURES[0],
    allergies: plan?.allergies ?? "",
    fluidTargetMl: plan?.fluidTargetMl ? String(plan.fluidTargetMl) : "1500",
    fluidLimitMl: plan?.fluidLimitMl ? String(plan.fluidLimitMl) : "",
    calorieTarget: plan?.calorieTarget ? String(plan.calorieTarget) : "",
    mealRhythm: plan?.mealRhythm ?? NONE,
    assistance: plan?.assistance ?? NONE,
    preferences: plan?.preferences ?? "",
    instructions: plan?.instructions ?? "",
  });
  const { saving, error, save } = useSave(onSaved);
  const set = <K extends keyof typeof form>(key: K, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const submit = () =>
    save(
      () =>
        requestJson(`/api/nutrition/residents/${residentId}/plan`, {
          method: "PUT",
          body: {
            ...form,
            mealRhythm: form.mealRhythm === NONE ? null : form.mealRhythm,
            assistance: form.assistance === NONE ? null : form.assistance,
            fluidTargetMl: int(form.fluidTargetMl),
            fluidLimitMl: int(form.fluidLimitMl),
            calorieTarget: int(form.calorieTarget),
          },
        }),
      `Ernährungsplan für ${residentName} gespeichert`,
    );
  return (
    <EditorDialog
      id="nutrition-plan"
      eyebrow={`Ernährung · ${residentName}`}
      title={plan ? "Ernährungsplan anpassen" : "Ernährungsplan anlegen"}
      description="Beim Speichern wird eine neue Fassung aktiv; die bisherige bleibt im Verlauf erhalten."
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel="Plan speichern"
    >
      <label>
        <span>Kostform</span>
        <CareSelect label="Kostform" value={form.diet} options={[...DIETS]} onChange={(v) => set("diet", v)} />
      </label>
      <label>
        <span>Konsistenz</span>
        <CareSelect
          label="Konsistenz"
          value={form.texture}
          options={[...TEXTURES]}
          onChange={(v) => set("texture", v)}
        />
      </label>
      <label>
        <span>Trinkziel (ml / Tag)</span>
        <input
          inputMode="numeric"
          value={form.fluidTargetMl}
          onChange={(e) => set("fluidTargetMl", e.target.value)}
          placeholder="z. B. 1500"
        />
      </label>
      <label>
        <span>Trinkmengenbegrenzung (ml / Tag)</span>
        <input
          inputMode="numeric"
          value={form.fluidLimitMl}
          onChange={(e) => set("fluidLimitMl", e.target.value)}
          placeholder="nur bei ärztlicher Anordnung"
        />
      </label>
      <label>
        <span>Mahlzeitenrhythmus</span>
        <CareSelect
          label="Mahlzeitenrhythmus"
          value={form.mealRhythm}
          options={[NONE, ...MEAL_RHYTHMS]}
          onChange={(v) => set("mealRhythm", v)}
        />
      </label>
      <label>
        <span>Hilfestellung</span>
        <CareSelect
          label="Hilfestellung"
          value={form.assistance}
          options={[NONE, ...ASSISTANCE]}
          onChange={(v) => set("assistance", v)}
        />
      </label>
      <label>
        <span>Energiebedarf (kcal / Tag)</span>
        <input
          inputMode="numeric"
          value={form.calorieTarget}
          onChange={(e) => set("calorieTarget", e.target.value)}
          placeholder="optional"
        />
      </label>
      <label className="area-editor-wide">
        <span>Allergien und Unverträglichkeiten</span>
        <input
          maxLength={2000}
          value={form.allergies}
          onChange={(e) => set("allergies", e.target.value)}
          placeholder="z. B. Nüsse, Laktoseintoleranz – oder „Keine bekannt“"
        />
      </label>
      <label className="area-editor-wide">
        <span>Vorlieben und Abneigungen</span>
        <textarea
          rows={2}
          maxLength={2000}
          value={form.preferences}
          onChange={(e) => set("preferences", e.target.value)}
          placeholder="z. B. mag warme Getränke, isst ungern Fisch"
        />
      </label>
      <label className="area-editor-wide">
        <span>Hinweise für das Team</span>
        <textarea
          rows={2}
          maxLength={4000}
          value={form.instructions}
          onChange={(e) => set("instructions", e.target.value)}
          placeholder="z. B. aufrecht sitzend essen, Getränke andicken, Kohlenhydrate verteilen"
        />
      </label>
    </EditorDialog>
  );
}

export function FluidDialog({ residentId, residentName, onClose, onSaved }: Base) {
  const [amount, setAmount] = useState("200");
  const [beverage, setBeverage] = useState<string>(BEVERAGES[0]);
  const [date, setDate] = useState(todayInZurich);
  const [time, setTime] = useState(() => timeInZurich());
  const [note, setNote] = useState("");
  const { saving, error, save } = useSave(onSaved);
  return (
    <EditorDialog
      id="nutrition-fluid"
      eyebrow={`Ernährung · ${residentName}`}
      title="Trinkmenge erfassen"
      onClose={onClose}
      onSubmit={() =>
        save(
          () =>
            sendOrQueue(
              "/api/nutrition/fluids",
              { residentId, amountMl: Number(amount), beverage, note, consumedAt: zurichTimeToIso(date, time) },
              `Trinkmenge ${amount} ml · ${residentName}`,
            ),
          `${residentName}: ${amount} ml ${beverage} erfasst`,
        )
      }
      saving={saving}
      error={error}
      submitLabel="Trinkmenge speichern"
    >
      <label>
        <span>Menge (ml)</span>
        <input required inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label>
        <span>Getränk</span>
        <CareSelect label="Getränk" value={beverage} options={[...BEVERAGES]} onChange={setBeverage} />
      </label>
      <label>
        <span>Datum</span>
        <CareDatePicker label="Datum" value={date} onChange={setDate} />
      </label>
      <label>
        <span>Uhrzeit</span>
        <input type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
      </label>
      <label className="area-editor-wide">
        <span>Bemerkung</span>
        <input
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="z. B. mit Unterstützung, Schnabelbecher"
        />
      </label>
    </EditorDialog>
  );
}

export function MealDialog({
  residentId,
  residentName,
  meal: initialMeal,
  onClose,
  onSaved,
}: Base & { meal?: string }) {
  const [meal, setMeal] = useState(initialMeal ?? MEALS[2]);
  const [portion, setPortion] = useState<number>(100);
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayInZurich);
  const [time, setTime] = useState(() => timeInZurich());
  const { saving, error, save } = useSave(onSaved);
  return (
    <EditorDialog
      id="nutrition-meal"
      eyebrow={`Ernährung · ${residentName}`}
      title="Mahlzeit dokumentieren"
      description="Gegessene Menge bezogen auf die angebotene Portion."
      onClose={onClose}
      onSubmit={() =>
        save(
          () =>
            sendOrQueue(
              "/api/nutrition/meals",
              { residentId, meal, portionPercent: portion, note, eatenAt: zurichTimeToIso(date, time) },
              `${meal} ${portion} % · ${residentName}`,
            ),
          `${residentName}: ${meal} ${portion} % dokumentiert`,
        )
      }
      saving={saving}
      error={error}
      submitLabel="Mahlzeit speichern"
    >
      <label className="area-editor-wide">
        <span>Mahlzeit</span>
        <CareSelect label="Mahlzeit" value={meal} options={[...MEALS]} onChange={setMeal} />
      </label>
      <div className="appointment-kind-switch area-editor-wide" role="group" aria-label="Gegessene Menge">
        {PORTIONS.map((value) => (
          <button
            key={value}
            type="button"
            className={portion === value ? "active" : ""}
            aria-pressed={portion === value}
            onClick={() => setPortion(value)}
          >
            {value === 0 ? "Nichts" : `${value} %`}
          </button>
        ))}
      </div>
      <label>
        <span>Datum</span>
        <CareDatePicker label="Datum" value={date} onChange={setDate} />
      </label>
      <label>
        <span>Uhrzeit</span>
        <input type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
      </label>
      <label className="area-editor-wide">
        <span>{portion <= 25 ? "Grund (Pflicht)" : "Bemerkung"}</span>
        <input
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={portion <= 25 ? "z. B. Appetitlosigkeit, Übelkeit, Schluckbeschwerden" : "optional"}
        />
      </label>
    </EditorDialog>
  );
}
