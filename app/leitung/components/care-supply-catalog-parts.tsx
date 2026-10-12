"use client";

import { useTerms } from "@/app/components/care-context";
import type { CareSupplyCatalogState } from "./use-care-supply-catalog";

export function CatalogKpis({ r }: { r: CareSupplyCatalogState }) {
  const t = useTerms();
  const { products, activeCount, blockedCount, archivedCount, reorderCount, setFilter } = r;
  return (
    <section className="leadership-kpis" aria-label="Katalogübersicht">
      <article className="leadership-kpi info">
        <span className="leadership-kpi-value">{products.length}</span>
        <strong>Produkte im Katalog</strong>
        <small>alle erfassten Pflegeprodukte</small>
      </article>
      <article className="leadership-kpi stable">
        <span className="leadership-kpi-value">{activeCount}</span>
        <strong>Aktiv und buchbar</strong>
        <small>für {t.prefix}akten verfügbar</small>
      </article>
      <article className={`leadership-kpi ${reorderCount ? "critical" : "stable"}`}>
        <span className="leadership-kpi-value">{reorderCount}</span>
        <strong>Nachbestellen</strong>
        <small>
          {reorderCount ? (
            <button className="link-button" type="button" onClick={() => setFilter("Nachbestellen")}>
              Mindestbestand erreicht · anzeigen
            </button>
          ) : (
            "alle Bestände über dem Minimum"
          )}
        </small>
      </article>
      <article className="leadership-kpi attention">
        <span className="leadership-kpi-value">{blockedCount}</span>
        <strong>Gesperrt</strong>
        <small>derzeit nicht auswählbar · {archivedCount} archiviert</small>
      </article>
    </section>
  );
}
