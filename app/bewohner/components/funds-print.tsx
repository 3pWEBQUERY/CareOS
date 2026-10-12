"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Printer, X } from "@phosphor-icons/react";
import { useTerms, useWorkContext } from "@/app/components/care-context";
import { formatDate, useApiData } from "@/app/components/workspace-ui";
import { FUND_KINDS, fundSign, formatMoney, type FundAccount } from "@/lib/funds-shared";
import { monthLabel } from "./funds-view";

// Kontoauszug der Bewohnergelder (A4 hoch) für einen Monat: Anfangsbestand, Buchungen mit laufendem Saldo,
// Endbestand und Platz für die Unterschriften. Stornierte Buchungen erscheinen nicht.
export default function FundsPrint() {
  const t = useTerms();
  const context = useWorkContext();
  const params = useSearchParams();
  const residentId = params.get("residentId") ?? "";
  const month = params.get("month") ?? "";
  const { data, error } = useApiData<FundAccount>(
    residentId
      ? `/api/funds?residentId=${encodeURIComponent(residentId)}${month ? `&month=${encodeURIComponent(month)}` : ""}`
      : null,
  );
  const printed = useRef(false);
  useEffect(() => {
    if (!data || printed.current || params.get("dialog") === "0") return;
    printed.current = true;
    const timer = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(timer);
  }, [data, params]);

  const rows = data
    ? [...data.entries]
        .filter((entry) => !entry.cancelled)
        .sort((a, b) => a.bookedOn.localeCompare(b.bookedOn) || a.createdAt.localeCompare(b.createdAt))
    : [];
  // Laufender Saldo nach jeder Buchung.
  const balances: number[] = [];
  for (const entry of rows)
    balances.push(
      (balances[balances.length - 1] ?? data?.openingCents ?? 0) + fundSign(entry.kind) * entry.amountCents,
    );

  return (
    <main className="transfer-print">
      <style>{"@page { size: A4 portrait; margin: 12mm; }"}</style>
      <div className="roster-print-bar">
        <strong>Kontoauszug</strong>
        <span>A4 hoch · im Druckdialog „Als PDF speichern“ wählen</span>
        <button className="primary-button" type="button" disabled={!data} onClick={() => window.print()}>
          <Printer className="button-icon" /> Drucken / PDF
        </button>
        <button className="secondary-button" type="button" onClick={() => window.close()}>
          <X className="button-icon" /> Schliessen
        </button>
      </div>
      {(error || !data) && <h1 className="print-hidden-heading">Kontoauszug</h1>}
      {error || !residentId ? (
        <p className="roster-print-message" role="alert">
          Der Kontoauszug konnte nicht erstellt werden{error ? `: ${error}` : "."}
        </p>
      ) : !data ? (
        <p className="roster-print-message">Kontoauszug wird erstellt …</p>
      ) : (
        <article className="transfer-sheet funds-sheet">
          <header className="transfer-head">
            <div>
              <p>{`Kontoauszug · ${t.prefix}gelder`}</p>
              <h1>{data.resident.name}</h1>
              <span>
                {[
                  data.resident.birthDate ? `geb. ${formatDate(data.resident.birthDate)}` : "",
                  data.resident.room,
                  data.resident.unit,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
            <div className="transfer-facility">
              {context?.profile.organizationName && <strong>{context.profile.organizationName}</strong>}
              <span>{monthLabel(data.month)}</span>
              <span>
                {/* Auf Papier ein festes Datum statt „Heute“. */}
                Stand{" "}
                {new Intl.DateTimeFormat("de-CH", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "Europe/Zurich",
                }).format(new Date())}
              </span>
            </div>
          </header>
          <table>
            <thead>
              <tr>
                <th>Datum</th>
                <th>Buchung</th>
                <th>Beleg</th>
                <th className="funds-sheet-amount">Betrag</th>
                <th className="funds-sheet-amount">Saldo</th>
              </tr>
            </thead>
            <tbody>
              <tr className="funds-sheet-total">
                <td className="funds-sheet-date">{formatDate(`${data.month}-01`)}</td>
                <td colSpan={3}>Anfangsbestand</td>
                <td className="funds-sheet-amount">{formatMoney(data.openingCents, data.currency)}</td>
              </tr>
              {rows.map((entry, index) => {
                const signed = fundSign(entry.kind) * entry.amountCents;
                return (
                  <tr key={entry.id} className="funds-sheet-entry">
                    <td className="funds-sheet-date">{formatDate(entry.bookedOn)}</td>
                    <td className="funds-sheet-text">
                      {FUND_KINDS[entry.kind]} · {entry.purpose}
                      {(entry.party || entry.author) && (
                        <small>{[entry.party, `gebucht von ${entry.author}`].filter(Boolean).join(" · ")}</small>
                      )}
                    </td>
                    <td className="funds-sheet-receipt" data-label="Beleg">
                      {entry.receipt || "–"}
                    </td>
                    <td className="funds-sheet-amount funds-sheet-change" data-direction={signed > 0 ? "in" : "out"}>
                      {signed > 0 ? "+" : "−"}
                      {formatMoney(entry.amountCents, data.currency)}
                    </td>
                    <td className="funds-sheet-amount funds-sheet-balance" data-label="Saldo">
                      {formatMoney(balances[index], data.currency)}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={5}>{`Keine Buchungen im ${monthLabel(data.month)}.`}</td>
                </tr>
              )}
              <tr className="funds-sheet-total">
                <td colSpan={4}>Endbestand</td>
                <td className="funds-sheet-amount">{formatMoney(data.closingCents, data.currency)}</td>
              </tr>
            </tbody>
          </table>
          <dl className="funds-sheet-sums">
            <dt>Einzahlungen</dt>
            <dd>{formatMoney(data.depositsCents, data.currency)}</dd>
            <dt>Auszahlungen und Ausgaben</dt>
            <dd>{formatMoney(data.withdrawalsCents, data.currency)}</dd>
          </dl>
          <div className="funds-sheet-signatures">
            <span>Ort, Datum, Unterschrift Einrichtung</span>
            <span>{`Gesehen: ${t.one} bzw. Vertretung`}</span>
          </div>
        </article>
      )}
    </main>
  );
}
