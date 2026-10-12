"use client";

import Link from "next/link";
import { useState } from "react";
import { setCareResident, useTerms, useWorkContext } from "@/app/components/care-context";
import { CareDatePicker, CareOptionSelect } from "@/app/components/care-form-controls";
import ModulePageShell from "@/app/components/module-page-shell";
import {
  EditorDialog,
  EmptyState,
  LoadError,
  PageHeading,
  SummaryTiles,
  formatDate,
  formatDateTime,
  requestJson,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import {
  DAY_PARTS,
  DAY_PART_KEYS,
  PROOF_OUTCOMES,
  slotOrder,
  type DayPart,
  type Deviation,
  type ProofIntervention,
  type ProofResident,
  type ProofView as ProofData,
} from "@/lib/intervention-proofs-shared";

type Slot = { date: string; dayPart: DayPart };
type Choice = { outcome: Deviation | "done"; reason: string };

// Abweichungen für eine Person erfassen; alle übrigen offenen Massnahmen gelten als wie geplant durchgeführt.
function DeviationDialog({
  resident,
  slot,
  onClose,
  onSaved,
}: {
  resident: ProofResident;
  slot: Slot;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const open = resident.interventions.filter((item) => !item.proof);
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(open.map((item) => [item.id, { outcome: "done", reason: "" }])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const deviations = open.filter((item) => choices[item.id].outcome !== "done");

  async function submit() {
    setSaving(true);
    setError("");
    try {
      await requestJson("/api/intervention-proofs", {
        method: "POST",
        body: {
          residentId: resident.id,
          ...slot,
          deviations: deviations.map((item) => ({ interventionId: item.id, ...choices[item.id] })),
        },
      });
      onSaved(
        deviations.length
          ? `Nachweis für ${resident.name} gespeichert, ${deviations.length === 1 ? "eine Abweichung" : `${deviations.length} Abweichungen`} dokumentiert`
          : `Nachweis für ${resident.name} gespeichert`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="proof-deviation"
      eyebrow={resident.name}
      title="Abweichungen erfassen"
      description={`${DAY_PARTS[slot.dayPart].label}, ${formatDate(slot.date)}. Massnahmen ohne Abweichung gelten als wie geplant durchgeführt; Abweichungen kommen als wichtiger Eintrag in die Pflegedokumentation.`}
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel={deviations.length ? "Nachweis mit Abweichungen speichern" : "Alle wie geplant speichern"}
    >
      <ul className="proof-choices area-editor-wide">
        {open.map((item) => {
          const choice = choices[item.id];
          const set = (next: Partial<Choice>) =>
            setChoices((current) => ({ ...current, [item.id]: { ...current[item.id], ...next } }));
          return (
            <li key={item.id}>
              <strong>{item.title}</strong>
              {item.instructions && <small>{item.instructions}</small>}
              <div className="chip-row" role="group" aria-label={`Durchführung: ${item.title}`}>
                {(Object.keys(PROOF_OUTCOMES) as Array<keyof typeof PROOF_OUTCOMES>).map((outcome) => (
                  <button
                    type="button"
                    key={outcome}
                    className={`day-toggle ${choice.outcome === outcome ? "active" : ""}`}
                    aria-pressed={choice.outcome === outcome}
                    onClick={() => set({ outcome })}
                  >
                    {PROOF_OUTCOMES[outcome]}
                  </button>
                ))}
              </div>
              {choice.outcome !== "done" && (
                <label>
                  <span>{choice.outcome === "partial" ? "Was wurde durchgeführt, was nicht?" : "Grund"}</span>
                  <textarea
                    required
                    rows={2}
                    maxLength={4000}
                    value={choice.reason}
                    onChange={(event) => set({ reason: event.target.value })}
                    placeholder={
                      choice.outcome === "partial"
                        ? "z. B. nur bis zum Flur gegangen, danach erschöpft"
                        : "z. B. abgelehnt, ausser Haus, Zustand liess es nicht zu"
                    }
                  />
                </label>
              )}
            </li>
          );
        })}
      </ul>
    </EditorDialog>
  );
}

function CancelDialog({
  item,
  resident,
  onClose,
  onSaved,
}: {
  item: ProofIntervention;
  resident: ProofResident;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setSaving(true);
    setError("");
    try {
      await requestJson(`/api/intervention-proofs/${item.proof?.id}/cancel`, { method: "POST", body: { reason } });
      onSaved("Nachweis storniert");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Stornieren fehlgeschlagen.");
      setSaving(false);
    }
  }
  return (
    <EditorDialog
      id="proof-cancel"
      eyebrow={resident.name}
      title="Nachweis stornieren"
      description={`„${item.title}“: Der Nachweis bleibt im Protokoll sichtbar; danach lässt sich die Massnahme neu nachweisen. Ein Eintrag zu einer Abweichung wird in der Pflegedokumentation korrigiert.`}
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel="Nachweis stornieren"
      danger
    >
      <label className="area-editor-wide">
        <span>Grund</span>
        <textarea
          required
          rows={3}
          maxLength={2000}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="z. B. falsche Person oder Tageszeit"
        />
      </label>
    </EditorDialog>
  );
}

function ProofContent({ showToast }: { showToast: ShowToast }) {
  const t = useTerms();
  const context = useWorkContext();
  const [unitId, setUnitId] = useState("");
  const [slot, setSlot] = useState<Slot | null>(null);
  const [deviating, setDeviating] = useState<ProofResident | null>(null);
  const [cancelling, setCancelling] = useState<{ item: ProofIntervention; resident: ProofResident } | null>(null);
  const [busy, setBusy] = useState("");
  const params = new URLSearchParams();
  if (unitId) params.set("careUnitId", unitId);
  if (slot) {
    params.set("date", slot.date);
    params.set("dayPart", slot.dayPart);
  }
  const data = useApiData<ProofData>(`/api/intervention-proofs${params.size ? `?${params}` : ""}`);
  const view = data.data;
  const units = context?.careUnits ?? [];
  const shown: Slot | null = view ? { date: view.date, dayPart: view.dayPart } : null;
  const started = view
    ? slotOrder(view.date, view.dayPart) <= slotOrder(view.current.date, view.current.dayPart)
    : false;
  const all = view?.residents.flatMap((resident) => resident.interventions) ?? [];
  const openCount = all.filter((item) => !item.proof).length;
  const deviationCount = all.filter((item) => item.proof && item.proof.outcome !== "done").length;

  async function confirmAll(resident: ProofResident) {
    if (!shown) return;
    setBusy(resident.id);
    try {
      await requestJson("/api/intervention-proofs", {
        method: "POST",
        body: { residentId: resident.id, ...shown, deviations: [] },
      });
      showToast(`Nachweis für ${resident.name} gespeichert`);
      data.reload();
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy("");
    }
  }

  const saved = (message: string) => {
    setDeviating(null);
    setCancelling(null);
    showToast(message);
    data.reload();
  };

  return (
    <>
      <PageHeading
        eyebrow="Dokumentation"
        title="Durchführungsnachweis"
        description="Geplante Massnahmen je Tageszeit: alles wie geplant mit einem Klick bestätigen, nur Abweichungen einzeln mit Grund erfassen."
      />
      <section className="proof-toolbar">
        <CareOptionSelect
          label="Wohnbereich"
          value={unitId}
          onChange={setUnitId}
          options={[
            { value: "", label: "Alle Wohnbereiche" },
            ...units.map((unit) => ({ value: unit.id, label: unit.name })),
          ]}
        />
        <CareDatePicker
          label="Tag"
          value={shown?.date ?? ""}
          max={view?.current.date}
          onChange={(date) => date && setSlot({ date, dayPart: shown?.dayPart ?? "morning" })}
        />
        <CareOptionSelect
          label="Tageszeit"
          value={shown?.dayPart ?? ""}
          onChange={(value) => shown && setSlot({ date: shown.date, dayPart: value as DayPart })}
          options={DAY_PART_KEYS.map((part) => ({
            value: part,
            label: `${DAY_PARTS[part].label} · ${DAY_PARTS[part].hours}`,
          }))}
        />
      </section>
      <SummaryTiles
        label="Durchführungsnachweis"
        tiles={[
          { icon: "residents", value: view?.residents.length ?? "–", caption: `${t.many} mit Massnahmen` },
          { icon: "tasks", value: view ? openCount : "–", caption: "offen", tone: openCount ? "attention" : undefined },
          { icon: "check", value: view ? all.length - openCount - deviationCount : "–", caption: "wie geplant" },
          {
            icon: "alert",
            value: view ? deviationCount : "–",
            caption: "Abweichungen",
            tone: deviationCount ? "info" : undefined,
          },
        ]}
      />
      {data.error && <LoadError message={data.error} onRetry={data.reload} />}
      {view && !started && (
        <p className="proof-note" role="status">
          Diese Tageszeit hat noch nicht begonnen. Nachweisen lässt sie sich ab ihrem Beginn.
        </p>
      )}
      {view && !view.residents.length && (
        <EmptyState
          icon="check"
          title="Keine Massnahmen für diese Tageszeit"
          text="In der Pflegeplanung lässt sich je Massnahme festlegen, zu welchen Tageszeiten sie nachgewiesen wird."
        />
      )}
      <div className="proof-residents">
        {view?.residents.map((resident) => {
          const open = resident.interventions.filter((item) => !item.proof).length;
          return (
            <section className="card proof-resident" key={resident.id} aria-label={resident.name}>
              <header>
                <h2>
                  <Link href={`/c/bewohner?resident=${resident.id}`} onClick={() => setCareResident(resident.id)}>
                    {resident.name}
                  </Link>
                  <span>{[resident.room, resident.careUnit].filter(Boolean).join(" · ")}</span>
                </h2>
                {view.canWrite && started && open > 0 && (
                  <div className="proof-actions">
                    <button className="secondary-button" type="button" onClick={() => setDeviating(resident)}>
                      Abweichung erfassen
                    </button>
                    <button
                      className="primary-button"
                      type="button"
                      disabled={busy === resident.id}
                      onClick={() => confirmAll(resident)}
                    >
                      {open === resident.interventions.length ? "Alle wie geplant" : "Übrige wie geplant"}
                    </button>
                  </div>
                )}
              </header>
              <ul>
                {resident.interventions.map((item) => (
                  <li key={item.id} data-state={item.proof?.outcome ?? "open"}>
                    <div>
                      <strong>{item.title}</strong>
                      <small>
                        {[item.frequency, item.responsibleRole, `Ziel: ${item.goal}`].filter(Boolean).join(" · ")}
                      </small>
                      {item.proof && item.proof.outcome !== "done" && <p>{item.proof.reason}</p>}
                    </div>
                    <span className="proof-state">
                      <b>{item.proof ? PROOF_OUTCOMES[item.proof.outcome] : "Offen"}</b>
                      {item.proof && (
                        <small>
                          {item.proof.author} · {formatDateTime(item.proof.recordedAt)}
                        </small>
                      )}
                    </span>
                    {item.proof && view.canWrite && (
                      <button
                        className="proof-cancel"
                        type="button"
                        aria-label={`Nachweis stornieren: ${item.title}`}
                        onClick={() => setCancelling({ item, resident })}
                      >
                        Stornieren
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {deviating && shown && (
        <DeviationDialog resident={deviating} slot={shown} onClose={() => setDeviating(null)} onSaved={saved} />
      )}
      {cancelling && (
        <CancelDialog
          item={cancelling.item}
          resident={cancelling.resident}
          onClose={() => setCancelling(null)}
          onSaved={saved}
        />
      )}
    </>
  );
}

// Dokumentation › Nachweis: Durchführung der geplanten Massnahmen nach Abweichungen.
export default function ProofView() {
  return (
    <ModulePageShell activeModule="chart" activeChild="Nachweis" pageClass="documentation-page documentation-proof">
      {(showToast) => (
        <main className="workspace module-workspace documentation-workspace">
          <ProofContent showToast={showToast} />
        </main>
      )}
    </ModulePageShell>
  );
}
