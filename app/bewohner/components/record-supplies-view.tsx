"use client";

import { useTerms } from "@/app/components/care-context";
import { Check, ClipboardText, PencilSimple, Plus, Trash, Warning } from "@phosphor-icons/react";
import type { ResidentRecordState } from "./use-resident-record";

export function RecordSuppliesView({ r }: { r: ResidentRecordState }) {
  const t = useTerms();
  const { resident, contentRef, supplies, suppliesLoading, suppliesError, openSupplyEditor, deleteSupply } = r;
  return (
    <main className="resident-record-content supplies-view" ref={contentRef} key="supplies">
      <div className="record-subpage-heading">
        <div>
          <span className="record-section-label">{`${t.prefix}akte`}</span>
          <h3>Pflegebedarf</h3>
          <p>Persönliche Hilfs- und Verbrauchsmaterialien für {resident.name} sicher verwalten.</p>
        </div>
        <button className="primary-button" type="button" onClick={() => openSupplyEditor()}>
          <Plus /> Bedarf hinzufügen
        </button>
      </div>
      <section className="supplies-summary">
        <div>
          <span>
            <ClipboardText />
          </span>
          <p>
            <small>Aktiv</small>
            <strong>{supplies.filter((item) => item.status === "active").length} Positionen</strong>
          </p>
        </div>
        <div>
          <span>
            <Warning />
          </span>
          <p>
            <small>Nachbestellen</small>
            <strong>
              {
                supplies.filter((item) => item.status === "active" && item.current_quantity < item.target_quantity)
                  .length
              }{" "}
              Positionen
            </strong>
          </p>
        </div>
        <div>
          <span>
            <Check />
          </span>
          <p>
            <small>Gesperrt</small>
            <strong>{supplies.filter((item) => item.status === "blocked").length} Positionen</strong>
          </p>
        </div>
      </section>
      {suppliesError && (
        <p className="supplies-error" role="alert">
          {suppliesError}
        </p>
      )}
      <section className="record-card supplies-card">
        <div className="record-card-heading">
          <div>
            <span className="record-section-label">Individueller Bedarf</span>
            <h3>Materialien und Hilfsmittel</h3>
          </div>
          <span>
            {supplies.length} {supplies.length === 1 ? "Eintrag" : "Einträge"}
          </span>
        </div>
        <div className="supplies-table-head">
          <span>Artikel</span>
          <span>Bestand</span>
          <span>Status</span>
          <span>Aktionen</span>
        </div>
        <div className="supplies-list">
          {suppliesLoading ? (
            <p>Pflegebedarf wird geladen…</p>
          ) : (
            supplies.map((supply) => (
              <article key={supply.id} className={`supply-row ${supply.status}`}>
                <span className="supply-icon">
                  <ClipboardText />
                </span>
                <div>
                  <strong>{supply.item_name}</strong>
                  <small>
                    {supply.category} · {supply.notes || "Kein zusätzlicher Hinweis"}
                  </small>
                </div>
                <span className="supply-quantity">
                  <strong>
                    {supply.current_quantity}{" "}
                    <small>
                      / {supply.target_quantity} {supply.unit}
                    </small>
                  </strong>
                  <i
                    style={{
                      width: `${Math.min(100, supply.target_quantity ? (supply.current_quantity / supply.target_quantity) * 100 : 100)}%`,
                    }}
                  />
                </span>
                <span className={`supply-status ${supply.status}`}>
                  {supply.status === "active" ? "Aktiv" : supply.status === "blocked" ? "Gesperrt" : "Archiviert"}
                </span>
                <span className="supply-actions">
                  <button
                    type="button"
                    onClick={() => openSupplyEditor(supply)}
                    aria-label={`${supply.item_name} bearbeiten`}
                  >
                    <PencilSimple />
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => void deleteSupply(supply)}
                    aria-label={`${supply.item_name} entfernen`}
                  >
                    <Trash />
                  </button>
                </span>
              </article>
            ))
          )}
          {!suppliesLoading && !supplies.length && (
            <div className="supplies-empty">
              <ClipboardText />
              <strong>Noch kein Pflegebedarf hinterlegt</strong>
              <p>Lege persönliche Artikel wie Einlagen, Windeln, Zahnpasta oder Hilfsmittel an.</p>
              <button className="secondary-button" onClick={() => openSupplyEditor()}>
                <Plus /> Pflegebedarf hinzufügen
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
