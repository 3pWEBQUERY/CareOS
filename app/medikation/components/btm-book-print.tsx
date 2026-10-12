"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Printer, X } from "@phosphor-icons/react";
import { formatNumber, useApiData } from "@/app/components/workspace-ui";
import type { BtmBook } from "@/lib/medication-btm-shared";
import { BtmBookTable } from "./btm-view";

// Druckansicht des BtM-Buchs einer Bestandsposition (A4 hoch, PDF über den Druckdialog).
export default function BtmBookPrint() {
  const params = useSearchParams();
  const stock = params.get("stock");
  const valid = !!stock && /^[0-9a-f-]{36}$/i.test(stock);
  const { data, error } = useApiData<BtmBook>(valid ? `/api/medication/btm/${stock}` : null);

  // Druckdialog einmal automatisch öffnen, sobald das Buch geladen ist.
  const printed = useRef(false);
  useEffect(() => {
    if (!data || printed.current || params.get("dialog") === "0") return;
    printed.current = true;
    const timer = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(timer);
  }, [data, params]);

  return (
    <main className="roster-print btm-print">
      {/* Nur auf dieser Seite: A4 hoch. */}
      <style>{"@page { size: A4 portrait; margin: 12mm; }"}</style>
      <div className="roster-print-bar">
        <strong>Druckansicht</strong>
        <span>A4 hoch · im Druckdialog „Als PDF speichern“ wählen</span>
        <button className="primary-button" type="button" disabled={!data} onClick={() => window.print()}>
          <Printer className="button-icon" /> Drucken / PDF
        </button>
        <button className="secondary-button" type="button" onClick={() => window.close()}>
          <X className="button-icon" /> Schliessen
        </button>
      </div>
      {!(valid && data) && <h1 className="print-hidden-heading">BtM-Buch</h1>}
      {!valid ? (
        <p className="roster-print-message" role="alert">
          Keine Bestandsposition angegeben.
        </p>
      ) : error && !data ? (
        <p className="roster-print-message" role="alert">
          Das BtM-Buch konnte nicht geladen werden: {error}
        </p>
      ) : !data ? (
        <p className="roster-print-message">BtM-Buch wird geladen …</p>
      ) : (
        <article className="roster-print-sheet btm-print-sheet">
          <header>
            <div>
              <h1>BtM-Buch · {data.stock.name}</h1>
              <p>
                {data.stock.owner} · aktueller Bestand {formatNumber(data.stock.quantity)} {data.stock.unit}
              </p>
            </div>
            <p>
              Erstellt am{" "}
              {new Intl.DateTimeFormat("de-CH", {
                timeZone: "Europe/Zurich",
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date())}
            </p>
          </header>
          <BtmBookTable book={data} print />
        </article>
      )}
    </main>
  );
}
