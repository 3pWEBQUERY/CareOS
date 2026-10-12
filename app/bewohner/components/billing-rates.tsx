"use client";

import { useState } from "react";
import { CareDatePicker, CareOptionSelect } from "@/app/components/care-form-controls";
import { ModuleIcon } from "@/app/components/module-icon";
import { EditorDialog, EmptyState, formatDate, requestJson } from "@/app/components/workspace-ui";
import { formatMoney, parseMoney } from "@/lib/funds-shared";
import {
  PAYERS,
  RATE_CATEGORIES,
  ruleText,
  type AbsenceRule,
  type BillingCatalog,
  type BillingRate,
  type Payer,
  type RateCategory,
} from "@/lib/billing-shared";

// Taxen der Einrichtung: Grundtaxen (Pension, Betreuung, weitere Leistungen), Pflegetarife je Stufe und Kostenträger
// sowie die Regel zum Austrittstag. Alle Beträge legt die Einrichtung fest.

const CARE_PAYERS: Payer[] = ["insurer", "resident", "public"];
const BASE_CATEGORIES = (Object.keys(RATE_CATEGORIES) as RateCategory[]).filter((key) => key !== "care");

// Preis, der an einem Tag gilt (der jüngste mit „gültig ab“ bis zu diesem Tag), und ein künftiger.
export function currentPrice(rate: BillingRate, day: string) {
  const sorted = [...rate.prices].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  const current = sorted.filter((price) => price.validFrom <= day).at(-1) ?? null;
  const next = sorted.find((price) => price.validFrom > day) ?? null;
  return { current, next };
}

const centsText = (cents: number) => (cents / 100).toFixed(2);

function RuleFields({
  label,
  rule,
  onChange,
}: {
  label: string;
  rule: AbsenceRule;
  onChange: (rule: AbsenceRule) => void;
}) {
  return (
    <fieldset className="area-editor-wide billing-rule">
      <legend>{label}</legend>
      <div className="repositioning-choices" role="group" aria-label={label}>
        <button
          type="button"
          className={`day-toggle ${rule ? "" : "active"}`}
          aria-pressed={!rule}
          onClick={() => onChange(null)}
        >
          Voll verrechnen
        </button>
        <button
          type="button"
          className={`day-toggle ${rule ? "active" : ""}`}
          aria-pressed={Boolean(rule)}
          onClick={() => onChange(rule ?? { fullDays: 0, percent: 0 })}
        >
          Reduzieren
        </button>
      </div>
      {rule && (
        <div className="billing-rule-fields">
          <label>
            <span>Tage voll verrechnet</span>
            <input
              type="number"
              min={0}
              max={365}
              required
              value={rule.fullDays}
              onChange={(event) => onChange({ ...rule, fullDays: Number(event.target.value) })}
            />
          </label>
          <label>
            <span>Danach verrechnet (%)</span>
            <input
              type="number"
              min={0}
              max={100}
              required
              value={rule.percent}
              onChange={(event) => onChange({ ...rule, percent: Number(event.target.value) })}
            />
          </label>
        </div>
      )}
    </fieldset>
  );
}

function RateDialog({
  catalog,
  rate,
  careLevel,
  carePayer,
  onClose,
  onSaved,
}: {
  catalog: BillingCatalog;
  rate: BillingRate | null;
  // Pflegetarif für eine Stufe und einen Kostenträger (neu oder bestehend).
  careLevel?: string;
  carePayer?: Payer;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const care = Boolean(careLevel) || rate?.category === "care";
  const price = rate ? currentPrice(rate, catalog.today).current : null;
  const [name, setName] = useState(rate?.name ?? (careLevel && carePayer ? `${careLevel} · ${PAYERS[carePayer]}` : ""));
  const [category, setCategory] = useState<RateCategory | "">(rate?.category ?? (care ? "care" : ""));
  const [payer, setPayer] = useState<Payer | "">(rate?.payer ?? carePayer ?? "");
  const [applies, setApplies] = useState<"all" | "assigned">(rate?.applies ?? "all");
  const [hospital, setHospital] = useState<AbsenceRule>(rate?.hospital ?? null);
  const [absence, setAbsence] = useState<AbsenceRule>(rate?.absence ?? null);
  const [amount, setAmount] = useState(price ? centsText(price.amountCents) : "");
  const [validFrom, setValidFrom] = useState(catalog.today);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    const cents = parseMoney(amount);
    if (cents === null && (!rate || amount.trim()))
      return setError("Bitte einen gültigen Betrag je Tag eingeben (z. B. 145.00).");
    if (!category) return setError("Bitte die Art der Taxe wählen.");
    if (!payer) return setError("Bitte wählen, wer die Taxe bezahlt.");
    setSaving(true);
    setError("");
    const fields = { name, payer, applies, hospital, absence };
    try {
      if (!rate) {
        await requestJson("/api/billing", {
          method: "POST",
          body: { ...fields, category, careLevel: careLevel ?? null, validFrom, amountCents: cents },
        });
      } else {
        await requestJson(`/api/billing/rates/${rate.id}`, { method: "PATCH", body: fields });
        if (cents !== null && (!price || cents !== price.amountCents || validFrom !== price.validFrom))
          await requestJson(`/api/billing/rates/${rate.id}`, {
            method: "POST",
            body: { action: "price", validFrom, amountCents: cents },
          });
      }
      onSaved(rate ? `${name} gespeichert` : `${name} erfasst`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="billing-rate"
      eyebrow={care ? `Pflegetarif · ${careLevel ?? rate?.careLevel}` : "Taxe"}
      title={rate ? "Taxe bearbeiten" : care ? "Pflegetarif erfassen" : "Neue Taxe"}
      description="Ein neuer Preis gilt ab dem gewählten Datum; frühere Preise bleiben für vergangene Monate erhalten."
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel="Speichern"
    >
      <label className="area-editor-wide">
        <span>Bezeichnung</span>
        <input required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      {!care && (
        <label>
          <span>Art</span>
          <CareOptionSelect
            label="Art"
            value={category}
            placeholder="Bitte wählen"
            disabled={Boolean(rate)}
            options={BASE_CATEGORIES.map((key) => ({ value: key, label: RATE_CATEGORIES[key] }))}
            onChange={(value) => setCategory(value as RateCategory)}
          />
        </label>
      )}
      <label>
        <span>Bezahlt von</span>
        <CareOptionSelect
          label="Bezahlt von"
          value={payer}
          placeholder="Bitte wählen"
          disabled={care}
          options={(Object.keys(PAYERS) as Payer[]).map((key) => ({ value: key, label: PAYERS[key] }))}
          onChange={(value) => setPayer(value as Payer)}
        />
      </label>
      {!care && (
        <fieldset className="area-editor-wide">
          <legend>Gilt für</legend>
          <div className="repositioning-choices" role="group" aria-label="Gilt für">
            {(
              [
                ["all", "Alle Personen"],
                ["assigned", "Nur zugewiesene Personen"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`day-toggle ${applies === key ? "active" : ""}`}
                aria-pressed={applies === key}
                onClick={() => setApplies(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <label>
        <span>{`Preis je Tag (${catalog.currency})`}</span>
        <input
          inputMode="decimal"
          required={!rate}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="z. B. 145.00"
        />
      </label>
      <CareDatePicker label="Gültig ab" value={validFrom} onChange={setValidFrom} />
      <RuleFields label="Bei Spitalaufenthalt" rule={hospital} onChange={setHospital} />
      <RuleFields label="Bei Ferien und anderen Abwesenheiten" rule={absence} onChange={setAbsence} />
    </EditorDialog>
  );
}

function SettingsCard({ catalog, onSaved }: { catalog: BillingCatalog; onSaved: (message: string) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const value = catalog.settings.dischargeDayBilled;
  async function choose(next: boolean) {
    setSaving(true);
    setError("");
    try {
      await requestJson("/api/billing", { method: "PUT", body: { dischargeDayBilled: next } });
      onSaved("Regel zum Austrittstag gespeichert");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="card service-records billing-settings" aria-labelledby="billing-settings-title">
      <header>
        <h2 className="card-title" id="billing-settings-title">
          Austrittstag
        </h2>
        <p className="card-subtitle">
          Der Eintrittstag wird immer verrechnet. Ob der Tag des Austritts (auch der Todestag) verrechnet wird, legt die
          Einrichtung fest{value === null ? " – ohne diese Festlegung rechnet CareOS nicht." : "."}
        </p>
      </header>
      <div className="repositioning-choices" role="group" aria-label="Austrittstag">
        {(
          [
            [true, "Austrittstag verrechnen"],
            [false, "Austrittstag nicht verrechnen"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={label}
            type="button"
            className={`day-toggle ${value === key ? "active" : ""}`}
            aria-pressed={value === key}
            disabled={saving}
            onClick={() => void choose(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p className="appointment-editor-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function PriceText({ rate, catalog }: { rate: BillingRate; catalog: BillingCatalog }) {
  const { current, next } = currentPrice(rate, catalog.today);
  return (
    <>
      <span className="service-minutes">{current ? formatMoney(current.amountCents, catalog.currency) : "–"}</span>
      {next && (
        <small className="billing-next-price">
          ab {formatDate(next.validFrom)}: {formatMoney(next.amountCents, catalog.currency)}
        </small>
      )}
    </>
  );
}

export function BillingRates({ catalog, onSaved }: { catalog: BillingCatalog; onSaved: (message: string) => void }) {
  const [editing, setEditing] = useState<BillingRate | "new" | null>(null);
  const [careCell, setCareCell] = useState<{ level: string; payer: Payer; rate: BillingRate | null } | null>(null);
  const [archiving, setArchiving] = useState<BillingRate | null>(null);
  const active = catalog.rates.filter((rate) => !rate.archived);
  const base = active.filter((rate) => rate.category !== "care");
  const careRate = (level: string, payer: Payer) =>
    active.find((rate) => rate.category === "care" && rate.careLevel === level && rate.payer === payer) ?? null;
  const done = (message: string) => {
    setEditing(null);
    setCareCell(null);
    setArchiving(null);
    onSaved(message);
  };

  return (
    <>
      <SettingsCard catalog={catalog} onSaved={onSaved} />
      <section className="card service-records billing-rates" aria-labelledby="billing-rates-title">
        <header className="fund-cash-head">
          <div>
            <h2 className="card-title" id="billing-rates-title">
              Taxen
            </h2>
            <p className="card-subtitle">Pension, Betreuung und weitere Leistungen je Tag.</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => setEditing("new")}>
            <ModuleIcon name="plus" className="button-icon" /> Neue Taxe
          </button>
        </header>
        {!base.length ? (
          <EmptyState
            icon="note"
            title="Noch keine Taxen"
            text="Erfassen Sie die Taxen der Einrichtung mit ihrem Preis je Tag."
          />
        ) : (
          <ul aria-label="Taxen">
            {base.map((rate) => (
              <li key={rate.id}>
                <div>
                  <strong>{rate.name}</strong>
                  <small>
                    {[
                      RATE_CATEGORIES[rate.category],
                      PAYERS[rate.payer],
                      rate.applies === "assigned" ? "nur zugewiesene Personen" : "alle Personen",
                    ].join(" · ")}
                  </small>
                  <small>
                    Spital: {ruleText(rate.hospital)} · Ferien und andere: {ruleText(rate.absence)}
                  </small>
                </div>
                <div className="billing-price">
                  <PriceText rate={rate} catalog={catalog} />
                </div>
                <button className="secondary-button" type="button" onClick={() => setEditing(rate)}>
                  Bearbeiten
                </button>
                <button className="quiet-button" type="button" onClick={() => setArchiving(rate)}>
                  Nicht mehr verwenden
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card service-records billing-care" aria-labelledby="billing-care-title">
        <header>
          <h2 className="card-title" id="billing-care-title">
            Pflegetarife je {catalog.levelLabel}
          </h2>
          <p className="card-subtitle">
            Betrag je Tag und Kostenträger, so wie ihn Kanton bzw. Versicherer und Einrichtung festlegen. Feld wählen,
            um den Tarif zu erfassen oder zu ändern.
          </p>
        </header>
        <div className="billing-care-wrap">
          <table className="billing-care-table">
            <thead>
              <tr>
                <th scope="col">{catalog.levelLabel}</th>
                {CARE_PAYERS.map((payer) => (
                  <th scope="col" key={payer}>
                    {PAYERS[payer]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {catalog.levels.map((level) => (
                <tr key={level.value}>
                  <th scope="row">
                    {level.value}
                    <small>{level.detail}</small>
                  </th>
                  {CARE_PAYERS.map((payer) => {
                    const rate = careRate(level.value, payer);
                    const price = rate ? currentPrice(rate, catalog.today) : null;
                    return (
                      <td key={payer}>
                        <button
                          type="button"
                          className="billing-care-cell"
                          aria-label={`${level.value} · ${PAYERS[payer]}`}
                          onClick={() => setCareCell({ level: level.value, payer, rate })}
                        >
                          {price?.current ? formatMoney(price.current.amountCents, catalog.currency) : "–"}
                          {price?.next && <small>ab {formatDate(price.next.validFrom)}</small>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {editing && (
        <RateDialog
          catalog={catalog}
          rate={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={done}
        />
      )}
      {careCell && (
        <RateDialog
          catalog={catalog}
          rate={careCell.rate}
          careLevel={careCell.level}
          carePayer={careCell.payer}
          onClose={() => setCareCell(null)}
          onSaved={done}
        />
      )}
      {archiving && (
        <ArchiveDialog
          rate={archiving}
          onClose={() => setArchiving(null)}
          onDone={() => done(`${archiving.name} wird nicht mehr verwendet`)}
        />
      )}
    </>
  );
}

function ArchiveDialog({ rate, onClose, onDone }: { rate: BillingRate; onClose: () => void; onDone: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <EditorDialog
      id="billing-archive"
      eyebrow="Taxe"
      title="Nicht mehr verwenden"
      description={`„${rate.name}“ wird ab sofort nicht mehr verrechnet, auch nicht in der Vorschau vergangener Monate. Die Preise bleiben im Protokoll.`}
      onClose={onClose}
      onSubmit={async () => {
        setSaving(true);
        try {
          await requestJson(`/api/billing/rates/${rate.id}`, { method: "POST", body: { action: "archive" } });
          onDone();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
          setSaving(false);
        }
      }}
      saving={saving}
      error={error}
      submitLabel="Nicht mehr verwenden"
      danger
    >
      <p className="area-editor-wide">Um nur den Preis zu ändern, bitte stattdessen „Bearbeiten“ wählen.</p>
    </EditorDialog>
  );
}
