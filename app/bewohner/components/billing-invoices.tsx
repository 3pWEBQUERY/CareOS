"use client";

import { useState } from "react";
import { useTerms } from "@/app/components/care-context";
import { CareOptionSelect } from "@/app/components/care-form-controls";
import { ModuleIcon } from "@/app/components/module-icon";
import {
  EditorDialog,
  EmptyState,
  LoadError,
  ReasonDialog,
  requestJson,
  useApiData,
} from "@/app/components/workspace-ui";
import { formatMoney } from "@/lib/funds-shared";
import {
  formatInvoiceNumber,
  type InvoiceRow,
  type InvoiceRun,
  type InvoiceSettings,
  type PostalAddress,
} from "@/lib/billing-shared";
import { monthLabel } from "./funds-view";
import { BankImportDialog, OpenItemsCard, PaymentDialog, PaymentsDialog } from "./billing-payments";

// Rechnungen je Monat, Zahlungsangaben der Einrichtung und Rechnungsadresse je Person.

const EMPTY: PostalAddress = { name: "", addition: "", street: "", building: "", zip: "", city: "", country: "CH" };

function AddressFields({
  value,
  onChange,
  withAddition,
}: {
  value: PostalAddress;
  onChange: (value: PostalAddress) => void;
  withAddition?: boolean;
}) {
  const field = (key: keyof PostalAddress, label: string, max: number, wide = false) => (
    <label className={wide ? "area-editor-wide" : undefined}>
      <span>{label}</span>
      <input
        maxLength={max}
        required={!["building", "addition"].includes(key)}
        value={value[key] ?? ""}
        onChange={(event) => onChange({ ...value, [key]: event.target.value })}
      />
    </label>
  );
  return (
    <>
      {field("name", "Name", 70, true)}
      {withAddition && field("addition", "Zusatz (optional, z. B. c/o Beistandschaft)", 70, true)}
      {field("street", "Strasse", 70)}
      {field("building", "Hausnummer (optional)", 16)}
      {field("zip", "Postleitzahl", 16)}
      {field("city", "Ort", 35)}
      <label>
        <span>Land (Kürzel)</span>
        <input
          maxLength={2}
          required
          value={value.country}
          onChange={(event) => onChange({ ...value, country: event.target.value.toUpperCase() })}
        />
      </label>
    </>
  );
}

export function AddressDialog({
  residentId,
  residentName,
  address,
  onClose,
  onSaved,
}: {
  residentId: string;
  residentName: string;
  address: PostalAddress | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [value, setValue] = useState<PostalAddress>(address ?? EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <EditorDialog
      id="billing-address"
      eyebrow={residentName}
      title="Rechnungsadresse"
      description="An wen die Rechnung für den Anteil der Person geht, z. B. an die Person selbst, Angehörige oder die Beistandschaft."
      onClose={onClose}
      onSubmit={async () => {
        setSaving(true);
        setError("");
        try {
          await requestJson(`/api/billing/residents/${residentId}`, {
            method: "POST",
            body: { action: "address", address: value },
          });
          onSaved("Rechnungsadresse gespeichert");
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
          setSaving(false);
        }
      }}
      saving={saving}
      error={error}
      submitLabel="Speichern"
    >
      <AddressFields value={value} onChange={setValue} withAddition />
    </EditorDialog>
  );
}

function PaymentSettingsDialog({
  settings,
  onClose,
  onSaved,
}: {
  settings: InvoiceSettings;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [creditor, setCreditor] = useState<PostalAddress>(settings.creditor ?? EMPTY);
  const [iban, setIban] = useState(settings.iban);
  const [days, setDays] = useState(settings.paymentDays === null ? "" : String(settings.paymentDays));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <EditorDialog
      id="billing-payment"
      eyebrow="Rechnungen"
      title="Zahlungsangaben der Einrichtung"
      description="Erscheinen auf jeder Rechnung und im Zahlteil. Mit einer IBAN aus der Schweiz oder Liechtenstein entsteht ein Zahlteil mit QR-Code; mit einer QR-IBAN zusätzlich eine QR-Referenz."
      onClose={onClose}
      onSubmit={async () => {
        if (days.trim() === "") return setError("Bitte die Zahlungsfrist in Tagen angeben.");
        setSaving(true);
        setError("");
        try {
          await requestJson("/api/billing/invoices/settings", {
            method: "PUT",
            body: { creditor, iban, paymentDays: Number(days) },
          });
          onSaved("Zahlungsangaben gespeichert");
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
          setSaving(false);
        }
      }}
      saving={saving}
      error={error}
      submitLabel="Speichern"
    >
      <AddressFields value={creditor} onChange={setCreditor} />
      <label className="area-editor-wide">
        <span>IBAN</span>
        <input
          required
          maxLength={42}
          value={iban}
          onChange={(event) => setIban(event.target.value)}
          placeholder="CH.. .... .... .... .... ."
        />
      </label>
      <label>
        <span>Zahlungsfrist (Tage)</span>
        <input
          type="number"
          min={0}
          max={120}
          required
          value={days}
          onChange={(event) => setDays(event.target.value)}
        />
      </label>
    </EditorDialog>
  );
}

export function PaymentCard({ onSaved }: { onSaved: (message: string) => void }) {
  const settings = useApiData<InvoiceSettings>("/api/billing/invoices/settings");
  const [editing, setEditing] = useState(false);
  const data = settings.data;
  return (
    <section className="card service-records billing-settings" aria-labelledby="billing-payment-card-title">
      <header className="fund-cash-head">
        <div>
          <h2 className="card-title" id="billing-payment-card-title">
            Zahlungsangaben
          </h2>
          <p className="card-subtitle">
            {!data
              ? "Wird geladen …"
              : data.creditor
                ? `${data.creditor.name} · ${data.creditor.zip} ${data.creditor.city} · IBAN …${data.iban.slice(-4)} · zahlbar innert ${data.paymentDays} Tagen`
                : "Noch nicht erfasst – ohne Zahlungsangaben gibt es keine Rechnungen."}
          </p>
        </div>
        <button className="secondary-button" type="button" disabled={!data} onClick={() => setEditing(true)}>
          {data?.creditor ? "Bearbeiten" : "Erfassen"}
        </button>
      </header>
      {settings.error && <LoadError message={settings.error} onRetry={settings.reload} />}
      {editing && data && (
        <PaymentSettingsDialog
          settings={data}
          onClose={() => setEditing(false)}
          onSaved={(message) => {
            setEditing(false);
            settings.reload();
            onSaved(message);
          }}
        />
      )}
    </section>
  );
}

// Abgeschlossene Monate zur Auswahl: der Vormonat und die 23 davor.
function closedMonths(today: string) {
  const [year, month] = today.split("-").map(Number);
  return Array.from({ length: 24 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 2 - index, 1));
    const value = date.toISOString().slice(0, 7);
    return { value, label: monthLabel(value) };
  });
}

function rowState(row: InvoiceRow, currency: string, today: string) {
  if (row.invoice) {
    const open = row.invoice.totalCents - row.invoice.paidCents;
    const state = !open
      ? "bezahlt"
      : `${row.invoice.paidCents ? "teilweise bezahlt, " : ""}offen ${formatMoney(open, currency)}${row.invoice.dueOn < today ? " · überfällig" : ""}`;
    return `Rechnung ${formatInvoiceNumber(row.invoice.number)} · ${formatMoney(row.invoice.totalCents, currency)} · ${state}`;
  }
  if (row.totalCents === null) return "Keine Berechnung möglich";
  if (!row.totalCents) return "Kein Betrag für die Person";
  if (!row.hasAddress) return `${formatMoney(row.totalCents, currency)} · Rechnungsadresse fehlt`;
  return `${formatMoney(row.totalCents, currency)} · bereit`;
}

export function InvoicesView({
  onSaved,
  onPerson,
}: {
  onSaved: (message: string) => void;
  onPerson: (residentId: string) => void;
}) {
  const t = useTerms();
  const [month, setMonth] = useState("");
  const run = useApiData<InvoiceRun>(`/api/billing/invoices${month ? `?month=${month}` : ""}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState<InvoiceRow | null>(null);
  const [payment, setPayment] = useState<{
    invoiceId: string;
    label: string;
    openCents: number;
    currency: string;
    today: string;
  } | null>(null);
  const [payments, setPayments] = useState<string | null>(null);
  const [bank, setBank] = useState(false);
  const [version, setVersion] = useState(0);
  const data = run.data;
  const refresh = (message: string) => {
    onSaved(message);
    run.reload();
    setVersion((value) => value + 1);
  };
  const ready = data?.rows.filter((row) => !row.invoice && row.hasAddress && row.totalCents) ?? [];
  const canCreate = Boolean(data && !data.missing.length && data.monthClosed);

  async function create(residentIds: string[] | null) {
    if (!data) return;
    setBusy(true);
    setError("");
    try {
      const result = await requestJson<{ created: unknown[]; skipped: unknown[] }>("/api/billing/invoices", {
        method: "POST",
        body: { month: data.month, ...(residentIds ? { residentIds } : {}) },
      });
      onSaved(
        `${result.created.length} ${result.created.length === 1 ? "Rechnung" : "Rechnungen"} erstellt` +
          (result.skipped.length ? `, ${result.skipped.length} übersprungen` : ""),
      );
      run.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die Rechnungen konnten nicht erstellt werden.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="billing-rates-layout">
      <section className="service-toolbar billing-toolbar">
        {data && (
          <CareOptionSelect label="Monat" value={data.month} onChange={setMonth} options={closedMonths(data.today)} />
        )}
        <button
          className="primary-button"
          type="button"
          disabled={!canCreate || !ready.length || busy}
          onClick={() => void create(null)}
        >
          <ModuleIcon name="check" className="button-icon" />
          {busy ? "Wird erstellt …" : `Rechnungen erstellen (${ready.length})`}
        </button>
        <button className="secondary-button" type="button" disabled={!data} onClick={() => setBank(true)}>
          <ModuleIcon name="plus" className="button-icon" /> Bankdatei einlesen
        </button>
        {data && (
          <>
            <a className="secondary-button" href={`/api/billing/exports?kind=journal&month=${data.month}`} download>
              <ModuleIcon name="docs" className="button-icon" /> Rechnungsjournal
            </a>
            <a className="secondary-button" href={`/api/billing/exports?kind=payers&month=${data.month}`} download>
              <ModuleIcon name="docs" className="button-icon" /> Kostenträger
            </a>
          </>
        )}
      </section>
      {run.error && <LoadError message={run.error} onRetry={run.reload} />}
      {data && data.missing.length > 0 && (
        <div className="billing-notice" role="status">
          <p>Bevor Rechnungen erstellt werden können, fehlen noch: {data.missing.join(", ")}.</p>
        </div>
      )}
      {error && (
        <p className="appointment-editor-error" role="alert">
          {error}
        </p>
      )}
      <section className="card service-records" aria-labelledby="billing-invoices-title">
        <header>
          <h2 className="card-title" id="billing-invoices-title">
            Rechnungen {data ? monthLabel(data.month) : ""}
          </h2>
          <p className="card-subtitle">
            Je {t.one} eine Rechnung für den eigenen Anteil, nach Monatsende. Die Positionen werden beim Erstellen
            festgehalten; Fehler werden storniert und neu verrechnet.
            {data && !data.qrBill && data.missing.length === 0
              ? " Ohne IBAN aus der Schweiz oder Liechtenstein erscheint statt des QR-Zahlteils die IBAN auf der Rechnung."
              : ""}
          </p>
        </header>
        {data && !data.rows.length ? (
          <EmptyState
            icon="note"
            title="Niemand zu verrechnen"
            text={`Im gewählten Monat wohnte kein ${t.one} im Haus.`}
          />
        ) : (
          <ul aria-label="Rechnungen des Monats">
            {data?.rows.map((row) => (
              <li key={row.residentId}>
                <div>
                  <button type="button" className="fund-account-link" onClick={() => onPerson(row.residentId)}>
                    {row.name}
                  </button>
                  <small>{[row.room, rowState(row, data.currency, data.today)].filter(Boolean).join(" · ")}</small>
                  {!row.invoice && row.warnings.map((warning) => <small key={warning}>{warning}</small>)}
                </div>
                {row.invoice ? (
                  <>
                    <a
                      className="secondary-button"
                      href={`/c/bewohner/abrechnung/rechnung?id=${row.invoice.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ModuleIcon name="docs" className="button-icon" /> Rechnung öffnen
                    </a>
                    {row.invoice.paidCents < row.invoice.totalCents && (
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() =>
                          row.invoice &&
                          setPayment({
                            invoiceId: row.invoice.id,
                            label: `Rechnung ${formatInvoiceNumber(row.invoice.number)} · ${row.name}`,
                            openCents: row.invoice.totalCents - row.invoice.paidCents,
                            currency: data.currency,
                            today: data.today,
                          })
                        }
                      >
                        Zahlung
                      </button>
                    )}
                    <button
                      className="quiet-button"
                      type="button"
                      onClick={() => row.invoice && setPayments(row.invoice.id)}
                    >
                      Zahlungen
                    </button>
                    <button className="quiet-button" type="button" onClick={() => setCancelling(row)}>
                      Stornieren
                    </button>
                  </>
                ) : (
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!canCreate || !row.hasAddress || !row.totalCents || busy}
                    onClick={() => void create([row.residentId])}
                  >
                    Erstellen
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {data && data.cancelled.length > 0 && (
          <div className="fund-counts">
            <h3>Stornierte Rechnungen</h3>
            <ul aria-label="Stornierte Rechnungen">
              {data.cancelled.map((entry) => (
                <li key={entry.id}>
                  <div>
                    <strong>
                      {formatInvoiceNumber(entry.number)} · {entry.name}
                    </strong>
                    <small>{entry.reason}</small>
                  </div>
                  <a
                    className="quiet-button"
                    href={`/c/bewohner/abrechnung/rechnung?id=${entry.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ansehen
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      <OpenItemsCard reload={version} onPayment={setPayment} onPayments={setPayments} />
      {payment && (
        <PaymentDialog
          {...payment}
          onClose={() => setPayment(null)}
          onSaved={(message) => {
            setPayment(null);
            refresh(message);
          }}
        />
      )}
      {payments && <PaymentsDialog invoiceId={payments} onClose={() => setPayments(null)} onChanged={refresh} />}
      {bank && data && (
        <BankImportDialog
          currency={data.currency}
          onClose={() => setBank(false)}
          onBooked={(message) => {
            setBank(false);
            refresh(message);
          }}
        />
      )}
      {cancelling?.invoice && (
        <ReasonDialog
          eyebrow={cancelling.name}
          title="Rechnung stornieren"
          description={`Rechnung ${formatInvoiceNumber(cancelling.invoice.number)} bleibt mit Grund sichtbar; danach kann der Monat neu verrechnet werden.`}
          label="Grund der Stornierung"
          placeholder="z. B. Abwesenheit nachgetragen, falsche Rechnungsadresse"
          submitLabel="Stornieren"
          danger
          onClose={() => setCancelling(null)}
          onConfirm={async (reason) => {
            await requestJson(`/api/billing/invoices/${cancelling.invoice?.id}`, { method: "POST", body: { reason } });
            setCancelling(null);
            refresh("Rechnung storniert");
          }}
        />
      )}
    </div>
  );
}
