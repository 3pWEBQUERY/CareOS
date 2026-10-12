"use client";

import { useState } from "react";
import { setCareResident, useHeaderResident, useTerms, useWorkContext } from "@/app/components/care-context";
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
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import { formatMoney } from "@/lib/funds-shared";
import {
  ABSENCE_KINDS,
  PAYERS,
  type Absence,
  type AbsenceKind,
  type AssignedRate,
  type BillingCatalog,
  type BillingLine,
  type BillingPerson,
  type CareLevelEntry,
} from "@/lib/billing-shared";
import { BillingRates } from "./billing-rates";
import { AddressDialog, InvoicesView, PaymentCard } from "./billing-invoices";
import { monthLabel, monthOptions } from "./funds-view";

type View = "person" | "rates" | "invoices";
type Cancel = { kind: "level" | "absence" | "rate"; id: string; title: string };

const ABSENCE_KEYS = Object.keys(ABSENCE_KINDS) as AbsenceKind[];

function personPost(residentId: string, body: Record<string, unknown>) {
  return requestJson(`/api/billing/residents/${residentId}`, { method: "POST", body });
}

function CareLevelDialog({
  person,
  catalog,
  onClose,
  onSaved,
}: {
  person: BillingPerson;
  catalog: BillingCatalog;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [level, setLevel] = useState("");
  const [validFrom, setValidFrom] = useState(person.today);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (!level) return setError(`Bitte die ${catalog.levelLabel} wählen.`);
    setSaving(true);
    setError("");
    try {
      await personPost(person.residentId, { action: "careLevel", level, validFrom, note });
      onSaved(`${level} ab ${formatDate(validFrom)} erfasst`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  }
  return (
    <EditorDialog
      id="billing-level"
      eyebrow={person.resident.name}
      title={`${catalog.levelLabel} erfassen`}
      description="Die Stufe gilt ab dem gewählten Tag bis zur nächsten erfassten Stufe, z. B. nach der Einstufung mit dem vom Kanton anerkannten Instrument."
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel="Speichern"
    >
      <label>
        <span>{catalog.levelLabel}</span>
        <CareOptionSelect
          label={catalog.levelLabel}
          value={level}
          placeholder="Bitte wählen"
          options={catalog.levels.map((entry) => ({ value: entry.value, label: `${entry.value} · ${entry.detail}` }))}
          onChange={setLevel}
        />
      </label>
      <CareDatePicker label="Gültig ab" value={validFrom} onChange={setValidFrom} />
      <label className="area-editor-wide">
        <span>Grundlage (optional)</span>
        <input
          maxLength={500}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="z. B. Einstufung vom 12.03., Verfügung der Krankenversicherung"
        />
      </label>
    </EditorDialog>
  );
}

function AbsenceDialog({
  person,
  absence,
  onClose,
  onSaved,
}: {
  person: BillingPerson;
  absence: Absence | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [kind, setKind] = useState<AbsenceKind | null>(absence?.kind ?? null);
  const [startsOn, setStartsOn] = useState(absence?.startsOn ?? person.today);
  const [endsOn, setEndsOn] = useState(absence?.endsOn ?? "");
  const [note, setNote] = useState(absence?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (!kind) return setError("Bitte die Art der Abwesenheit wählen.");
    setSaving(true);
    setError("");
    try {
      const fields = { kind, startsOn, endsOn: endsOn || null, note };
      await personPost(
        person.residentId,
        absence ? { action: "updateAbsence", id: absence.id, ...fields } : { action: "absence", ...fields },
      );
      onSaved(absence ? "Abwesenheit gespeichert" : `${ABSENCE_KINDS[kind]} erfasst`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  }
  return (
    <EditorDialog
      id="billing-absence"
      eyebrow={person.resident.name}
      title={absence ? "Abwesenheit bearbeiten" : "Abwesenheit erfassen"}
      description="Erster und letzter ganzer Tag, an dem die Person nicht im Haus war. Solange sie fehlt, bleibt der letzte Tag leer."
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel="Speichern"
    >
      <fieldset className="area-editor-wide">
        <legend>Art</legend>
        <div className="repositioning-choices" role="group" aria-label="Art der Abwesenheit">
          {ABSENCE_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className={`day-toggle ${kind === key ? "active" : ""}`}
              aria-pressed={kind === key}
              onClick={() => setKind(key)}
            >
              {ABSENCE_KINDS[key]}
            </button>
          ))}
        </div>
      </fieldset>
      <CareDatePicker label="Erster ganzer Tag" value={startsOn} onChange={setStartsOn} />
      <CareDatePicker
        label="Letzter ganzer Tag"
        value={endsOn}
        onChange={setEndsOn}
        min={startsOn}
        clearable
        placeholder="Noch abwesend"
      />
      <label className="area-editor-wide">
        <span>Bemerkung (optional)</span>
        <input maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
    </EditorDialog>
  );
}

function AssignDialog({
  person,
  catalog,
  onClose,
  onSaved,
}: {
  person: BillingPerson;
  catalog: BillingCatalog;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const options = catalog.rates.filter((rate) => !rate.archived && rate.applies === "assigned");
  const [rateId, setRateId] = useState("");
  const [validFrom, setValidFrom] = useState(person.today);
  const [validUntil, setValidUntil] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (!rateId) return setError("Bitte eine Taxe wählen.");
    setSaving(true);
    setError("");
    try {
      await personPost(person.residentId, { action: "assign", rateId, validFrom, validUntil: validUntil || null });
      onSaved(`${options.find((rate) => rate.id === rateId)?.name ?? "Taxe"} zugewiesen`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  }
  return (
    <EditorDialog
      id="billing-assign"
      eyebrow={person.resident.name}
      title="Zusätzliche Taxe zuweisen"
      description="Taxen, die nur für einzelne Personen gelten (z. B. Zuschlag Einzelzimmer)."
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel="Zuweisen"
    >
      {options.length ? (
        <label className="area-editor-wide">
          <span>Taxe</span>
          <CareOptionSelect
            label="Taxe"
            value={rateId}
            placeholder="Bitte wählen"
            options={options.map((rate) => ({ value: rate.id, label: `${rate.name} · ${PAYERS[rate.payer]}` }))}
            onChange={setRateId}
          />
        </label>
      ) : (
        <p className="area-editor-wide">
          Es gibt noch keine Taxe für „nur zugewiesene Personen“. Bitte zuerst unter „Taxen der Einrichtung“ erfassen.
        </p>
      )}
      <CareDatePicker label="Ab" value={validFrom} onChange={setValidFrom} />
      <CareDatePicker
        label="Bis (optional)"
        value={validUntil}
        onChange={setValidUntil}
        min={validFrom}
        clearable
        placeholder="Ohne Ende"
      />
    </EditorDialog>
  );
}

function EndRateDialog({
  person,
  rate,
  onClose,
  onSaved,
}: {
  person: BillingPerson;
  rate: AssignedRate;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [validUntil, setValidUntil] = useState(person.today);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <EditorDialog
      id="billing-end-rate"
      eyebrow={person.resident.name}
      title={`${rate.name} beenden`}
      description="Letzter Tag, an dem die Taxe verrechnet wird."
      onClose={onClose}
      onSubmit={async () => {
        setSaving(true);
        try {
          await personPost(person.residentId, { action: "endRate", id: rate.id, validUntil });
          onSaved(`${rate.name} endet am ${formatDate(validUntil)}`);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
          setSaving(false);
        }
      }}
      saving={saving}
      error={error}
      submitLabel="Speichern"
    >
      <CareDatePicker label="Bis" value={validUntil} onChange={setValidUntil} />
    </EditorDialog>
  );
}

function lineDetail(line: BillingLine, currency: string) {
  const parts = [`${line.fullDays} × ${formatMoney(line.priceCents, currency)}`];
  for (const entry of line.reduced)
    parts.push(`${entry.days} ${entry.kind === "hospital" ? "Spitaltage" : "Abwesenheitstage"} zu ${entry.percent} %`);
  return parts.join(" · ");
}

function PreviewCard({ person, onRates }: { person: BillingPerson; onRates: () => void }) {
  const preview = person.preview;
  const money = (cents: number) => formatMoney(cents, person.currency);
  return (
    <section className="card service-records billing-preview" aria-labelledby="billing-preview-title">
      <header>
        <h2 className="card-title" id="billing-preview-title">
          Vorschau {monthLabel(person.previewMonth)}
        </h2>
        <p className="card-subtitle">
          Berechnet aus Aufenthalt, Pflegestufe, Abwesenheiten und den Taxen der Einrichtung. Noch keine Rechnung.
        </p>
      </header>
      {!preview ? (
        <div className="billing-notice">
          <p>Bitte zuerst festlegen, ob der Austrittstag verrechnet wird.</p>
          <button className="secondary-button" type="button" onClick={onRates}>
            Zu den Taxen der Einrichtung
          </button>
        </div>
      ) : (
        <>
          {preview.warnings.length > 0 && (
            <ul className="billing-warnings" aria-label="Hinweise zur Vorschau">
              {preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          {!preview.lines.length ? (
            <EmptyState
              icon="note"
              title="Nichts zu verrechnen"
              text={
                preview.billedDays
                  ? "Für diesen Monat gelten keine Taxen. Bitte die Taxen der Einrichtung prüfen."
                  : "In diesem Monat war die Person nicht im Haus."
              }
            />
          ) : (
            <table className="billing-lines">
              <thead>
                <tr>
                  <th scope="col">Position</th>
                  <th scope="col" className="billing-detail">
                    Berechnung
                  </th>
                  <th scope="col">Betrag</th>
                </tr>
              </thead>
              {preview.totals.map((total) => (
                <tbody key={total.payer}>
                  <tr className="billing-payer">
                    <th scope="rowgroup" colSpan={3}>
                      {PAYERS[total.payer]}
                    </th>
                  </tr>
                  {preview.lines
                    .filter((line) => line.payer === total.payer)
                    .map((line) => (
                      <tr key={`${line.rateId}:${line.priceCents}`}>
                        <td>{line.name}</td>
                        <td className="billing-detail">{lineDetail(line, person.currency)}</td>
                        <td className="billing-amount">{money(line.amountCents)}</td>
                      </tr>
                    ))}
                  <tr className="billing-subtotal">
                    <td colSpan={2}>Total {PAYERS[total.payer]}</td>
                    <td className="billing-amount">{money(total.amountCents)}</td>
                  </tr>
                </tbody>
              ))}
              <tfoot>
                <tr>
                  <td colSpan={2}>Total Monat</td>
                  <td className="billing-amount">{money(preview.totalCents)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </>
      )}
    </section>
  );
}

function PersonCards({
  person,
  catalog,
  onAction,
}: {
  person: BillingPerson;
  catalog: BillingCatalog;
  onAction: (action: Action) => void;
}) {
  const current = person.careLevels.find((entry) => entry.validFrom <= person.today) ?? null;
  return (
    <div className="billing-side">
      <section className="card service-records" aria-labelledby="billing-address-card-title">
        <header className="fund-cash-head">
          <div>
            <h2 className="card-title" id="billing-address-card-title">
              Rechnungsadresse
            </h2>
            <p className="card-subtitle">
              {person.address
                ? [
                    person.address.name,
                    person.address.addition,
                    [person.address.street, person.address.building].filter(Boolean).join(" "),
                    `${person.address.zip} ${person.address.city}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "Noch nicht erfasst – ohne Adresse gibt es keine Rechnung."}
            </p>
          </div>
          <button className="secondary-button" type="button" onClick={() => onAction({ type: "address" })}>
            {person.address ? "Ändern" : "Erfassen"}
          </button>
        </header>
      </section>
      <section className="card service-records" aria-labelledby="billing-levels-title">
        <header className="fund-cash-head">
          <div>
            <h2 className="card-title" id="billing-levels-title">
              {catalog.levelLabel}
            </h2>
            <p className="card-subtitle">
              {current ? `Aktuell ${current.level}` : "Noch keine Stufe erfasst"}
              {person.planCareLevel && person.planCareLevel !== current?.level
                ? ` · im Pflegeplan: ${person.planCareLevel}`
                : ""}
            </p>
          </div>
          <button className="secondary-button" type="button" onClick={() => onAction({ type: "level" })}>
            Neue Stufe
          </button>
        </header>
        {person.careLevels.length > 0 && (
          <ul aria-label={`Verlauf ${catalog.levelLabel}`}>
            {person.careLevels.map((entry: CareLevelEntry) => (
              <li key={entry.id}>
                <div>
                  <strong>
                    {entry.level} · ab {formatDate(entry.validFrom)}
                  </strong>
                  <small>{[entry.note, entry.author].filter(Boolean).join(" · ")}</small>
                </div>
                <button
                  className="quiet-button"
                  type="button"
                  onClick={() =>
                    onAction({
                      type: "cancel",
                      cancel: {
                        kind: "level",
                        id: entry.id,
                        title: `${entry.level} ab ${formatDate(entry.validFrom)}`,
                      },
                    })
                  }
                >
                  Stornieren
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card service-records" aria-labelledby="billing-absences-title">
        <header className="fund-cash-head">
          <div>
            <h2 className="card-title" id="billing-absences-title">
              Abwesenheiten
            </h2>
            <p className="card-subtitle">Spital, Ferien und andere ganze Tage ausser Haus.</p>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={() => onAction({ type: "absence", absence: null })}
          >
            Erfassen
          </button>
        </header>
        {person.absences.length > 0 && (
          <ul aria-label="Abwesenheiten">
            {person.absences.map((absence) => (
              <li key={absence.id}>
                <div>
                  <strong>
                    {ABSENCE_KINDS[absence.kind]} · {formatDate(absence.startsOn)} bis{" "}
                    {absence.endsOn ? formatDate(absence.endsOn) : "offen"}
                  </strong>
                  <small>{[absence.note, absence.author].filter(Boolean).join(" · ")}</small>
                </div>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => onAction({ type: "absence", absence })}
                >
                  {absence.endsOn ? "Bearbeiten" : "Rückkehr eintragen"}
                </button>
                <button
                  className="quiet-button"
                  type="button"
                  onClick={() =>
                    onAction({
                      type: "cancel",
                      cancel: {
                        kind: "absence",
                        id: absence.id,
                        title: `${ABSENCE_KINDS[absence.kind]} ab ${formatDate(absence.startsOn)}`,
                      },
                    })
                  }
                >
                  Stornieren
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card service-records" aria-labelledby="billing-assigned-title">
        <header className="fund-cash-head">
          <div>
            <h2 className="card-title" id="billing-assigned-title">
              Zusätzliche Taxen
            </h2>
            <p className="card-subtitle">Nur für diese Person, z. B. Zuschlag Einzelzimmer.</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => onAction({ type: "assign" })}>
            Zuweisen
          </button>
        </header>
        {person.assigned.length > 0 && (
          <ul aria-label="Zusätzliche Taxen">
            {person.assigned.map((rate) => (
              <li key={rate.id}>
                <div>
                  <strong>{rate.name}</strong>
                  <small>
                    ab {formatDate(rate.validFrom)}
                    {rate.validUntil ? ` bis ${formatDate(rate.validUntil)}` : ""}
                  </small>
                </div>
                {!rate.validUntil && (
                  <button className="secondary-button" type="button" onClick={() => onAction({ type: "end", rate })}>
                    Beenden
                  </button>
                )}
                <button
                  className="quiet-button"
                  type="button"
                  onClick={() => onAction({ type: "cancel", cancel: { kind: "rate", id: rate.id, title: rate.name } })}
                >
                  Stornieren
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

type Action =
  | { type: "level" }
  | { type: "absence"; absence: Absence | null }
  | { type: "assign" }
  | { type: "end"; rate: AssignedRate }
  | { type: "address" }
  | { type: "cancel"; cancel: Cancel };

function BillingContent({ showToast }: { showToast: ShowToast }) {
  const t = useTerms();
  const context = useWorkContext();
  const residents = context?.residents ?? [];
  const { resident, missing } = useHeaderResident(residents, !context);
  const [view, setView] = useState<View>("person");
  const [month, setMonth] = useState("");
  const [action, setAction] = useState<Action | null>(null);
  const catalog = useApiData<BillingCatalog>("/api/billing");
  const data = useApiData<BillingPerson>(
    resident && view === "person" ? `/api/billing/residents/${resident.id}${month ? `?month=${month}` : ""}` : null,
  );
  const person = data.data?.residentId === resident?.id ? data.data : null;
  const currentLevel = person?.careLevels.find((entry) => entry.validFrom <= person.today) ?? null;
  const done = (message: string) => {
    setAction(null);
    showToast(message);
    data.reload();
    catalog.reload();
  };

  return (
    <>
      <PageHeading
        eyebrow={`CareOS ${t.many}`}
        title="Abrechnung"
        description={`Taxen der Einrichtung, ${catalog.data?.levelLabel ?? "Pflegestufe"} und Abwesenheiten je ${t.one} – mit Vorschau des Monats nach Kostenträger.`}
      />
      <section className="service-toolbar billing-toolbar">
        <div className="repositioning-choices" role="group" aria-label="Ansicht">
          {(
            [
              ["person", `Je ${t.one}`],
              ["rates", "Taxen der Einrichtung"],
              ["invoices", "Rechnungen"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`day-toggle ${view === key ? "active" : ""}`}
              aria-pressed={view === key}
              onClick={() => setView(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {view === "person" && person && (
          <CareOptionSelect
            label="Monat"
            value={person.previewMonth}
            onChange={setMonth}
            options={monthOptions(person.today)}
          />
        )}
        {view === "person" && resident && (
          <p>
            {resident.name} · {resident.room}
          </p>
        )}
      </section>
      {catalog.error && <LoadError message={catalog.error} onRetry={catalog.reload} />}
      {view === "invoices" ? (
        <InvoicesView
          onSaved={showToast}
          onPerson={(id) => {
            setCareResident(id);
            setView("person");
          }}
        />
      ) : view === "rates" ? (
        catalog.data && (
          <div className="billing-rates-layout">
            <PaymentCard onSaved={showToast} />
            <BillingRates catalog={catalog.data} onSaved={done} />
          </div>
        )
      ) : !resident ? (
        <HeaderResidentHint loading={!context} missing={missing} />
      ) : (
        <>
          <SummaryTiles
            label="Monat"
            tiles={[
              { icon: "plan", value: currentLevel?.level ?? "–", caption: catalog.data?.levelLabel ?? "Pflegestufe" },
              { icon: "calendar", value: person?.preview?.billedDays ?? "–", caption: "Verrechnete Tage" },
              {
                icon: "alert",
                value: person?.preview ? person.preview.absentDays.hospital + person.preview.absentDays.absence : "–",
                caption: "Davon abwesend",
              },
              {
                icon: "check",
                value: person?.preview ? formatMoney(person.preview.totalCents, person.currency) : "–",
                caption: "Total Monat",
              },
            ]}
          />
          {data.error && <LoadError message={data.error} onRetry={data.reload} />}
          {person && catalog.data && (
            <div className="service-layout billing-layout">
              <PreviewCard person={person} onRates={() => setView("rates")} />
              <PersonCards person={person} catalog={catalog.data} onAction={setAction} />
            </div>
          )}
        </>
      )}
      {person && catalog.data && action?.type === "level" && (
        <CareLevelDialog person={person} catalog={catalog.data} onClose={() => setAction(null)} onSaved={done} />
      )}
      {person && action?.type === "absence" && (
        <AbsenceDialog person={person} absence={action.absence} onClose={() => setAction(null)} onSaved={done} />
      )}
      {person && catalog.data && action?.type === "assign" && (
        <AssignDialog person={person} catalog={catalog.data} onClose={() => setAction(null)} onSaved={done} />
      )}
      {person && action?.type === "address" && (
        <AddressDialog
          residentId={person.residentId}
          residentName={person.resident.name}
          address={person.address}
          onClose={() => setAction(null)}
          onSaved={done}
        />
      )}
      {person && action?.type === "end" && (
        <EndRateDialog person={person} rate={action.rate} onClose={() => setAction(null)} onSaved={done} />
      )}
      {person && action?.type === "cancel" && (
        <ReasonDialog
          eyebrow={person.resident.name}
          title="Eintrag stornieren"
          description={`„${action.cancel.title}“ zählt danach nicht mehr für die Abrechnung und bleibt im Protokoll sichtbar.`}
          label="Grund der Stornierung"
          placeholder="z. B. falsches Datum, doppelt erfasst"
          submitLabel="Stornieren"
          danger
          onClose={() => setAction(null)}
          onConfirm={async (reason) => {
            await personPost(person.residentId, {
              action: "cancel",
              kind: action.cancel.kind,
              id: action.cancel.id,
              reason,
            });
            done("Eintrag storniert");
          }}
        />
      )}
    </>
  );
}

// Bewohner › Abrechnung: Grundlagen je Person (Pflegestufe, Abwesenheiten, zusätzliche Taxen) mit Monatsvorschau
// und die Taxen der Einrichtung.
export default function BillingView() {
  return (
    <ModulePageShell activeModule="residents" activeChild="Abrechnung" pageClass="residents-page billing-page">
      {(showToast) => (
        <main className="workspace module-workspace">
          <BillingContent showToast={showToast} />
        </main>
      )}
    </ModulePageShell>
  );
}
