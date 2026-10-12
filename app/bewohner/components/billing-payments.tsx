"use client";

import { useState } from "react";
import { CareDatePicker } from "@/app/components/care-form-controls";
import { ModuleIcon } from "@/app/components/module-icon";
import {
  EditorDialog,
  EmptyState,
  LoadError,
  ReasonDialog,
  formatDate,
  requestJson,
  useApiData,
} from "@/app/components/workspace-ui";
import { formatMoney, parseMoney } from "@/lib/funds-shared";
import {
  BANK_MATCH,
  formatInvoiceNumber,
  type BankImportLine,
  type Invoice,
  type InvoicePayment,
  type OpenItems,
} from "@/lib/billing-shared";
import { monthLabel } from "./funds-view";

// Zahlungseingang von Hand, Zahlungen einer Rechnung (mit Storno), Bankdatei (camt.054/053) und offene Posten.

export function PaymentDialog({
  invoiceId,
  label,
  openCents,
  currency,
  today,
  onClose,
  onSaved,
}: {
  invoiceId: string;
  label: string;
  openCents: number;
  currency: string;
  today: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [paidOn, setPaidOn] = useState(today);
  const [amount, setAmount] = useState((openCents / 100).toFixed(2));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <EditorDialog
      id="billing-payment-entry"
      eyebrow={label}
      title="Zahlung erfassen"
      description={`Offen: ${formatMoney(openCents, currency)}. Zahlungen aus der Bankdatei werden automatisch zugeordnet; hier z. B. Barzahlungen erfassen.`}
      onClose={onClose}
      onSubmit={async () => {
        const cents = parseMoney(amount);
        if (!cents) return setError("Bitte einen gültigen Betrag eingeben (z. B. 120.00).");
        setSaving(true);
        setError("");
        try {
          await requestJson(`/api/billing/invoices/${invoiceId}`, {
            method: "POST",
            body: { action: "payment", paidOn, amountCents: cents, note },
          });
          onSaved(`Zahlung über ${formatMoney(cents, currency)} erfasst`);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
          setSaving(false);
        }
      }}
      saving={saving}
      error={error}
      submitLabel="Speichern"
    >
      <CareDatePicker label="Bezahlt am" value={paidOn} onChange={setPaidOn} max={today} />
      <label>
        <span>{`Betrag (${currency})`}</span>
        <input inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)} />
      </label>
      <label className="area-editor-wide">
        <span>Bemerkung (optional)</span>
        <input
          maxLength={500}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="z. B. bar am Empfang"
        />
      </label>
    </EditorDialog>
  );
}

// Zahlungen einer Rechnung mit Storno.
export function PaymentsDialog({
  invoiceId,
  onClose,
  onChanged,
}: {
  invoiceId: string;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const detail = useApiData<{ invoice: Invoice }>(`/api/billing/invoices/${invoiceId}`);
  const [cancelling, setCancelling] = useState<InvoicePayment | null>(null);
  const invoice = detail.data?.invoice;
  if (cancelling && invoice)
    return (
      <ReasonDialog
        eyebrow={`Rechnung ${formatInvoiceNumber(invoice.number)}`}
        title="Zahlung stornieren"
        description={`Die Zahlung über ${formatMoney(cancelling.amountCents, invoice.currency)} vom ${formatDate(cancelling.paidOn)} bleibt mit Grund sichtbar und zählt nicht mehr.`}
        label="Grund der Stornierung"
        placeholder="z. B. falscher Betrag, falsche Rechnung"
        submitLabel="Stornieren"
        danger
        onClose={() => setCancelling(null)}
        onConfirm={async (reason) => {
          await requestJson(`/api/billing/payments/${cancelling.id}`, { method: "POST", body: { reason } });
          setCancelling(null);
          detail.reload();
          onChanged("Zahlung storniert");
        }}
      />
    );
  return (
    <EditorDialog
      id="billing-payments"
      eyebrow={invoice ? `Rechnung ${formatInvoiceNumber(invoice.number)} · ${invoice.resident}` : "Rechnung"}
      title="Zahlungen"
      description={
        invoice
          ? `Betrag ${formatMoney(invoice.totalCents, invoice.currency)} · bezahlt ${formatMoney(invoice.paidCents, invoice.currency)}`
          : "Wird geladen …"
      }
      onClose={onClose}
      onSubmit={onClose}
      saving={false}
      error=""
      submitLabel="Schliessen"
    >
      {detail.error && <LoadError message={detail.error} onRetry={detail.reload} />}
      {invoice && !invoice.payments.length && (
        <p className="area-editor-wide">Zu dieser Rechnung ist noch keine Zahlung erfasst.</p>
      )}
      {invoice && invoice.payments.length > 0 && (
        <ul className="area-editor-wide billing-payment-list" aria-label="Zahlungen der Rechnung">
          {invoice.payments.map((payment) => (
            <li key={payment.id} className={payment.cancelled ? "cancelled" : ""}>
              <div>
                <strong>
                  {formatDate(payment.paidOn)} · {formatMoney(payment.amountCents, invoice.currency)}
                </strong>
                <small>
                  {[payment.source === "bank" ? "Bankdatei" : "von Hand", payment.note, payment.author]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
                {payment.cancelled && <small>Storniert: {payment.cancelled.reason}</small>}
              </div>
              {!payment.cancelled && (
                <button className="quiet-button" type="button" onClick={() => setCancelling(payment)}>
                  Stornieren
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </EditorDialog>
  );
}

export function BankImportDialog({
  currency,
  onClose,
  onBooked,
}: {
  currency: string;
  onClose: () => void;
  onBooked: (message: string) => void;
}) {
  const [xml, setXml] = useState("");
  const [fileName, setFileName] = useState("");
  const [lines, setLines] = useState<BankImportLine[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const ready = lines?.filter((line) => line.status === "ready") ?? [];

  async function read(file: File | undefined) {
    setLines(null);
    setError("");
    if (!file) return;
    if (file.size > 5_000_000) return setError("Die Bankdatei ist zu gross (höchstens 5 MB).");
    const content = await file.text();
    setXml(content);
    setFileName(file.name);
    try {
      const result = await requestJson<{ lines: BankImportLine[] }>("/api/billing/bank", {
        method: "POST",
        body: { xml: content },
      });
      setLines(result.lines);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die Bankdatei konnte nicht gelesen werden.");
    }
  }

  return (
    <EditorDialog
      id="billing-bank"
      eyebrow="Zahlungseingang"
      title="Bankdatei einlesen"
      description="Gutschriftsanzeige (camt.054) oder Kontoauszug (camt.053) aus dem E-Banking. Gutschriften mit der Referenz einer offenen Rechnung werden zugeordnet; verbucht wird erst nach Bestätigung."
      onClose={onClose}
      onSubmit={async () => {
        if (!ready.length) return setError("Keine Gutschrift zum Verbuchen.");
        setSaving(true);
        setError("");
        try {
          const result = await requestJson<{ booked: number }>("/api/billing/bank", {
            method: "POST",
            body: { xml, book: true },
          });
          onBooked(`${result.booked} ${result.booked === 1 ? "Zahlung" : "Zahlungen"} verbucht`);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Verbuchen fehlgeschlagen.");
          setSaving(false);
        }
      }}
      saving={saving}
      error={error}
      submitLabel={
        ready.length ? `${ready.length} ${ready.length === 1 ? "Zahlung" : "Zahlungen"} verbuchen` : "Verbuchen"
      }
    >
      <label className="area-editor-wide">
        <span>Bankdatei (XML)</span>
        <input
          type="file"
          accept=".xml,application/xml,text/xml"
          onChange={(event) => void read(event.target.files?.[0])}
        />
      </label>
      {lines && (
        <div className="area-editor-wide">
          <p className="billing-bank-summary">
            {fileName}: {lines.length} {lines.length === 1 ? "Gutschrift" : "Gutschriften"}, davon {ready.length}{" "}
            zuordenbar.
          </p>
          {lines.length > 0 && (
            <table className="billing-lines billing-bank-lines">
              <thead>
                <tr>
                  <th scope="col">Datum</th>
                  <th scope="col">Von</th>
                  <th scope="col">Rechnung</th>
                  <th scope="col">Stand</th>
                  <th scope="col">Betrag</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={`${line.bankReference}:${line.reference}`} data-status={line.status}>
                    <td>{line.bookedOn ? formatDate(line.bookedOn) : "–"}</td>
                    <td>{line.debtor || "–"}</td>
                    <td>{line.invoice ? `${formatInvoiceNumber(line.invoice.number)} · ${line.invoice.name}` : "–"}</td>
                    <td>{BANK_MATCH[line.status]}</td>
                    <td className="billing-amount">{formatMoney(line.amountCents, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </EditorDialog>
  );
}

export function OpenItemsCard({
  reload,
  onPayment,
  onPayments,
}: {
  reload: number;
  onPayment: (item: { invoiceId: string; label: string; openCents: number; currency: string; today: string }) => void;
  onPayments: (invoiceId: string) => void;
}) {
  const data = useApiData<OpenItems>(`/api/billing/open-items?v=${reload}`);
  const items = data.data;
  return (
    <section className="card service-records" aria-labelledby="billing-open-title">
      <header>
        <h2 className="card-title" id="billing-open-title">
          Offene Posten
        </h2>
        <p className="card-subtitle">
          {items
            ? `${items.items.length} ${items.items.length === 1 ? "Rechnung" : "Rechnungen"} offen · total ${formatMoney(items.totalOpenCents, items.currency)}`
            : "Wird geladen …"}
        </p>
      </header>
      {data.error && <LoadError message={data.error} onRetry={data.reload} />}
      {items && !items.items.length ? (
        <EmptyState icon="check" title="Alles bezahlt" text="Es gibt keine offenen Rechnungen." />
      ) : (
        <ul aria-label="Offene Posten">
          {items?.items.map((item) => {
            const open = item.totalCents - item.paidCents;
            const label = `Rechnung ${formatInvoiceNumber(item.number)} · ${item.name}`;
            return (
              <li key={item.invoiceId} className={item.overdue ? "billing-overdue" : ""}>
                <div>
                  <strong>
                    {formatInvoiceNumber(item.number)} · {item.name}
                  </strong>
                  <small>
                    {[
                      monthLabel(item.month),
                      item.recipient,
                      `fällig ${formatDate(item.dueOn)}${item.overdue ? " · überfällig" : ""}`,
                      item.paidCents ? `bezahlt ${formatMoney(item.paidCents, items.currency)}` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </div>
                <span className="service-minutes">{formatMoney(open, items.currency)}</span>
                <button className="quiet-button" type="button" onClick={() => onPayments(item.invoiceId)}>
                  Zahlungen
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() =>
                    onPayment({
                      invoiceId: item.invoiceId,
                      label,
                      openCents: open,
                      currency: items.currency,
                      today: items.today,
                    })
                  }
                >
                  <ModuleIcon name="plus" className="button-icon" /> Zahlung
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
