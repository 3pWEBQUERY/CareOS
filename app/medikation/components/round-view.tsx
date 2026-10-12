"use client";

import { useState, useSyncExternalStore } from "react";
import { useCountry, useWorkContext, useTerms } from "@/app/components/care-context";
import { CareDatePicker, CareSelect } from "@/app/components/care-form-controls";
import { ModuleIcon } from "@/app/components/module-icon";
import {
  ROUNDS,
  administrationLabels,
  roundForTime,
  type AdministrationStatus,
  type RoundDose,
  type RoundKey,
} from "@/lib/medication-shared";
import type { WitnessInput } from "@/lib/medication-btm-shared";
import {
  EditorDialog,
  EmptyState,
  LoadError,
  PageHeading,
  ReasonDialog,
  SummaryTiles,
  formatDateTime,
  requestJson,
  timeInZurich,
  todayInZurich,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import { WitnessFields, emptyWitness } from "./btm-witness";
import type { ResidentsPayload } from "./plan-view";
import { ResuscitationBadge } from "@/app/components/resuscitation-badge";

const statusTone: Record<RoundDose["status"], string> = {
  scheduled: "info",
  administered: "stable",
  declined: "critical",
  omitted: "attention",
  delayed: "attention",
};

const reasonCopy: Record<
  Exclude<AdministrationStatus, "administered">,
  { title: string; label: string; placeholder: string }
> = {
  declined: {
    title: "Verweigerung dokumentieren",
    label: "Begründung",
    placeholder: "z. B. Bewohner lehnt Einnahme ab, Arzt informiert",
  },
  omitted: {
    title: "Auslassung dokumentieren",
    label: "Begründung",
    placeholder: "z. B. nüchtern für Untersuchung, laut Arzt pausiert",
  },
  delayed: {
    title: "Verschiebung dokumentieren",
    label: "Begründung und neue Zeit",
    placeholder: "z. B. schläft, Gabe um 09:00 nachholen",
  },
};

// Aktuelle Runde und heutiges Datum erst im Browser bestimmen: die Seite wird beim Build vorgerendert, eine dort
// berechnete Uhrzeit wiche später ab (z. B. „Mittag“ im Build, „Abend“ beim Aufruf) und störte die Hydration.
const noSubscribe = () => () => undefined;
const currentRound = () => roundForTime(timeInZurich());

export default function RoundView({ showToast }: { showToast: ShowToast }) {
  const t = useTerms();
  const country = useCountry();
  const nowRound = useSyncExternalStore(noSubscribe, currentRound, () => null);
  const today = useSyncExternalStore(noSubscribe, todayInZurich, () => null);
  const [roundChoice, setRound] = useState<RoundKey | null>(null);
  const [dateChoice, setDate] = useState<string | null>(null);
  const round = roundChoice ?? nowRound ?? "morning";
  const date = dateChoice ?? today ?? "";
  const [pending, setPending] = useState<{
    dose: RoundDose;
    status: Exclude<AdministrationStatus, "administered">;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [witnessDose, setWitnessDose] = useState<RoundDose | null>(null);
  const witnessRequired = useWorkContext()?.settings.btmAdministrationWitness.enabled ?? false;
  const permissions = useApiData<ResidentsPayload>("/api/medication/residents");
  const canManage = permissions.data?.canAdminister ?? false;
  const { data, error, loading, reload } = useApiData<{ date: string; doses: RoundDose[] }>(
    nowRound && today ? `/api/medication/round?round=${round}&date=${date}` : null,
  );
  const doses = data?.doses ?? [];
  const documented = doses.filter((dose) => dose.status !== "scheduled").length;
  const residentsInRound = new Set(doses.map((dose) => dose.residentId)).size;
  const changed = doses.filter((dose) => dose.orderChangedRecently);
  const percent = doses.length ? Math.round((documented / doses.length) * 100) : 0;
  const keyOf = (dose: RoundDose) => `${dose.orderId}-${dose.scheduledAt}`;

  async function documentDose(dose: RoundDose, status: AdministrationStatus, note?: string, witness?: WitnessInput) {
    setBusy(keyOf(dose));
    try {
      const result = await requestJson<{ stockNote: string | null }>("/api/medication/round", {
        method: "POST",
        body: { orderId: dose.orderId, scheduledAt: dose.scheduledAt, status, note, witness },
      });
      showToast(
        `${dose.residentName}: ${dose.medication} – ${administrationLabels[status]} dokumentiert${result.stockNote ? `. ${result.stockNote}` : ""}`,
      );
      setPending(null);
      setWitnessDose(null);
      reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="Medikamente"
        title="Medikamentenrunde"
        description="Geplante Gaben vorbereiten, prüfen und direkt dokumentieren."
      />
      <SummaryTiles
        label="Status der Medikamentenrunde"
        tiles={[
          { icon: "residents", value: residentsInRound, caption: `${t.many} in der Runde` },
          { icon: "check", value: documented, caption: "Gaben dokumentiert" },
          { icon: "alert", value: doses.length - documented, caption: "noch offen", tone: "attention" },
          { icon: "med", value: doses.length, caption: "Einzelgaben geplant", tone: "info" },
        ]}
      />
      {changed.length > 0 && (
        <section className="critical-alert">
          <span className="critical-symbol">
            <ModuleIcon name="alert" />
          </span>
          <div>
            <strong>Geänderte Verordnungen in den letzten 48 Stunden</strong>
            <p>{[...new Set(changed.map((dose) => `${dose.residentName}: ${dose.medication}`))].join(" · ")}</p>
          </div>
        </section>
      )}
      {error && <LoadError message={error} onRetry={reload} />}
      {permissions.data && !canManage && (
        <p className="med-reserve-note med-round-readonly">
          <strong>Nur Ansicht.</strong> Gaben dokumentieren dürfen die Leitung und Mitarbeitende mit einer hinterlegten
          Qualifikation, die zur Medikation berechtigt (z. B. {country.medicationExamples}).
        </p>
      )}
      <section className="card med-round-card">
        <div className="med-round-toolbar">
          <div>
            <h2 className="card-title">{ROUNDS[round].label.split(" · ")[0]}</h2>
            <p className="card-subtitle">
              {documented} von {doses.length} Gaben dokumentiert
            </p>
          </div>
          <label>
            <span>Runde</span>
            <CareSelect
              label="Runde"
              value={ROUNDS[round].label}
              options={Object.values(ROUNDS).map((item) => item.label)}
              onChange={(label) =>
                setRound((Object.keys(ROUNDS) as RoundKey[]).find((key) => ROUNDS[key].label === label) ?? round)
              }
            />
          </label>
          <label>
            <span>Datum</span>
            <CareDatePicker label="Datum der Runde" value={date} onChange={setDate} />
          </label>
          <div className="med-round-progress">
            <span>
              <i style={{ width: `${percent}%` }} />
            </span>
            <strong>{percent}%</strong>
          </div>
        </div>
        <div className="med-round-list">
          {doses.map((dose) => {
            const hasAllergy = dose.allergies && !/^(keine|keine bekannt|nicht bekannt)$/i.test(dose.allergies.trim());
            const isBusy = busy === keyOf(dose);
            return (
              <article className={`med-round-row ${dose.status === "scheduled" ? "" : "gegeben"}`} key={keyOf(dose)}>
                <span className="resident-avatar">{dose.initials}</span>
                <div className="med-round-person">
                  <strong>
                    {dose.residentName} <ResuscitationBadge residentId={dose.residentId} />
                  </strong>
                  <small>{[dose.room, dose.careUnit].filter(Boolean).join(" · ")}</small>
                  {hasAllergy && <small className="med-allergy-text">Allergie: {dose.allergies}</small>}
                </div>
                <div className="med-round-meds">
                  <span>
                    <ModuleIcon name="med" />
                    <strong>
                      {dose.time} · {dose.medication}
                      {dose.controlled && <em className="btm-badge">BtM</em>}
                    </strong>
                    <small>
                      {dose.amount}
                      {dose.route ? ` · ${dose.route}` : ""}
                      {dose.status !== "scheduled" &&
                        ` · ${dose.administeredBy ?? "unbekannt"}${dose.administeredAt ? `, ${formatDateTime(dose.administeredAt)}` : ""}`}
                      {dose.note ? ` · ${dose.note}` : ""}
                    </small>
                  </span>
                </div>
                <span className={`status-badge ${statusTone[dose.status]}`}>{administrationLabels[dose.status]}</span>
                {canManage ? (
                  <div className="med-round-actions">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() =>
                        dose.controlled && witnessRequired
                          ? setWitnessDose(dose)
                          : void documentDose(dose, "administered").catch((e: Error) => showToast(e.message))
                      }
                    >
                      Gegeben
                    </button>
                    <button type="button" disabled={isBusy} onClick={() => setPending({ dose, status: "declined" })}>
                      Verweigert
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      aria-label={`${dose.medication} für ${dose.residentName} auslassen oder verschieben`}
                      title="Auslassen oder verschieben"
                      onClick={() => setPending({ dose, status: "omitted" })}
                    >
                      <ModuleIcon name="alert" />
                    </button>
                  </div>
                ) : (
                  <span />
                )}
              </article>
            );
          })}
          {!loading && !doses.length && !error && (
            <EmptyState
              title="Keine Gaben in dieser Runde"
              text="Für den gewählten Zeitraum sind keine Regelmedikationen verordnet."
            />
          )}
          {loading && !data && <p className="list-hint">Runde wird geladen …</p>}
        </div>
      </section>
      {witnessDose && (
        <WitnessDialog
          dose={witnessDose}
          onClose={() => setWitnessDose(null)}
          onConfirm={(witness) => documentDose(witnessDose, "administered", undefined, witness)}
        />
      )}
      {pending && (
        <ReasonDialog
          title={reasonCopy[pending.status].title}
          description={`${pending.dose.residentName} · ${pending.dose.time} · ${pending.dose.medication}`}
          label={reasonCopy[pending.status].label}
          placeholder={reasonCopy[pending.status].placeholder.replace("Bewohner", t.one)}
          submitLabel={administrationLabels[pending.status]}
          danger={pending.status === "declined"}
          onClose={() => setPending(null)}
          onConfirm={(note) => documentDose(pending.dose, pending.status, note)}
        >
          {pending.status !== "declined" && (
            <div className="appointment-kind-switch area-editor-wide" role="group" aria-label="Art der Abweichung">
              {(["omitted", "delayed"] as const).map((status) => (
                <button
                  type="button"
                  key={status}
                  className={pending.status === status ? "active" : ""}
                  aria-pressed={pending.status === status}
                  onClick={() => setPending({ ...pending, status })}
                >
                  {administrationLabels[status]}
                </button>
              ))}
            </div>
          )}
        </ReasonDialog>
      )}
    </>
  );
}

// Gabe eines Betäubungsmittels, wenn die Einrichtung dafür eine Zweitunterschrift verlangt.
function WitnessDialog({
  dose,
  onClose,
  onConfirm,
}: {
  dose: RoundDose;
  onClose: () => void;
  onConfirm: (witness: WitnessInput) => Promise<void>;
}) {
  const [witness, setWitness] = useState(emptyWitness);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      await onConfirm(witness);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die Gabe konnte nicht dokumentiert werden.");
      setSaving(false);
    }
  };
  return (
    <EditorDialog
      id="med-round-witness"
      eyebrow={`Medikamente · ${dose.residentName}`}
      title={`${dose.medication} geben`}
      description={`${dose.time} · ${dose.amount}${dose.route ? ` · ${dose.route}` : ""}. Die Einrichtung verlangt bei Betäubungsmitteln eine Zweitunterschrift.`}
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel="Gabe dokumentieren"
    >
      <WitnessFields value={witness} onChange={setWitness} />
    </EditorDialog>
  );
}
