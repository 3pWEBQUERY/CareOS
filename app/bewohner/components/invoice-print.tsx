"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Printer, X } from "@phosphor-icons/react";
import { formatDate, useApiData } from "@/app/components/workspace-ui";
import { formatMoney } from "@/lib/funds-shared";
import { formatInvoiceNumber, type Invoice, type PostalAddress } from "@/lib/billing-shared";
import { monthLabel } from "./funds-view";

type Detail = { invoice: Invoice; paymentPart: string | null };

function AddressBlock({ address }: { address: PostalAddress }) {
  return (
    <address>
      <strong>{address.name}</strong>
      {address.addition && <span>{address.addition}</span>}
      <span>{[address.street, address.building].filter(Boolean).join(" ")}</span>
      <span>
        {address.country !== "CH" ? `${address.country}-` : ""}
        {address.zip} {address.city}
      </span>
    </address>
  );
}

function lineDetail(line: Invoice["lines"][number], currency: string) {
  const parts = [`${line.fullDays} × ${formatMoney(line.priceCents, currency)}`];
  for (const entry of line.reduced)
    parts.push(`${entry.days} ${entry.kind === "hospital" ? "Spitaltage" : "Abwesenheitstage"} zu ${entry.percent} %`);
  return parts.join(" · ");
}

// Rechnung (A4 hoch) für den Anteil der Person; unten der Zahlteil als Schweizer QR-Rechnung (210 × 105 mm).
export default function InvoicePrint() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const { data, error } = useApiData<Detail>(id ? `/api/billing/invoices/${encodeURIComponent(id)}` : null);
  const printed = useRef(false);
  useEffect(() => {
    if (!data || printed.current || params.get("dialog") === "0") return;
    printed.current = true;
    const timer = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(timer);
  }, [data, params]);
  const invoice = data?.invoice;

  return (
    <main className="transfer-print invoice-print">
      <style>{"@page { size: A4 portrait; margin: 0; }"}</style>
      <div className="roster-print-bar">
        <strong>Rechnung</strong>
        <span>A4 hoch · im Druckdialog „Als PDF speichern“ wählen, Ränder „Keine“</span>
        <button className="primary-button" type="button" disabled={!data} onClick={() => window.print()}>
          <Printer className="button-icon" /> Drucken / PDF
        </button>
        <button className="secondary-button" type="button" onClick={() => window.close()}>
          <X className="button-icon" /> Schliessen
        </button>
      </div>
      {(error || !invoice) && <h1 className="print-hidden-heading">Rechnung</h1>}
      {error || !id ? (
        <p className="roster-print-message" role="alert">
          Die Rechnung konnte nicht geladen werden{error ? `: ${error}` : "."}
        </p>
      ) : !invoice ? (
        <p className="roster-print-message">Rechnung wird geladen …</p>
      ) : (
        <article className="invoice-sheet">
          <div className="invoice-body">
            <header className="invoice-head">
              <AddressBlock address={invoice.creditor} />
              <div className="invoice-recipient">
                <AddressBlock address={invoice.recipient} />
              </div>
            </header>
            {invoice.cancelled && (
              <p className="invoice-cancelled" role="status">
                Storniert am {formatDate(invoice.cancelled.at.slice(0, 10))}: {invoice.cancelled.reason}
              </p>
            )}
            <h1>
              Rechnung {formatInvoiceNumber(invoice.number)} · {monthLabel(invoice.month)}
            </h1>
            <dl className="invoice-facts">
              <dt>Für</dt>
              <dd>{invoice.resident}</dd>
              <dt>Rechnungsdatum</dt>
              <dd>{formatDate(invoice.issuedOn)}</dd>
              <dt>Zahlbar bis</dt>
              <dd>{formatDate(invoice.dueOn)}</dd>
              {!data.paymentPart && invoice.iban && (
                <>
                  <dt>Konto (IBAN)</dt>
                  <dd>{invoice.iban.replace(/(.{4})/g, "$1 ").trim()}</dd>
                </>
              )}
            </dl>
            <table>
              <thead>
                <tr>
                  <th>Position</th>
                  <th>Berechnung</th>
                  <th className="funds-sheet-amount">Betrag</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lines.map((line, index) => (
                  <tr key={`${line.name}:${index}`}>
                    <td>{line.name}</td>
                    <td>{lineDetail(line, invoice.currency)}</td>
                    <td className="funds-sheet-amount">{formatMoney(line.amountCents, invoice.currency)}</td>
                  </tr>
                ))}
                <tr className="funds-sheet-total">
                  <td colSpan={2}>Total</td>
                  <td className="funds-sheet-amount">{formatMoney(invoice.totalCents, invoice.currency)}</td>
                </tr>
              </tbody>
            </table>
            <p className="invoice-note">
              Beiträge der Krankenversicherung und der öffentlichen Hand werden direkt mit diesen abgerechnet und sind
              hier nicht enthalten.
            </p>
          </div>
          {data.paymentPart && (
            <div
              className="invoice-payment-part"
              role="img"
              aria-label="Zahlteil mit QR-Code"
              // Von swissqrbill erzeugtes SVG aus den gespeicherten Rechnungsdaten (keine Eingaben aus dem Browser).
              dangerouslySetInnerHTML={{ __html: data.paymentPart }}
            />
          )}
        </article>
      )}
    </main>
  );
}
