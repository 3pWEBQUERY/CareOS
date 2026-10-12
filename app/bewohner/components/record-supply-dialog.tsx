"use client";

import { useTerms } from "@/app/components/care-context";
import { CareSelect } from "@/app/components/care-form-controls";
import { Check, ClipboardText } from "@phosphor-icons/react";
import { useEscapeClose } from "@/app/components/use-escape-close";
import type { ResidentRecordState } from "./use-resident-record";

export function SupplyEditorDialog({ r }: { r: ResidentRecordState }) {
  const t = useTerms();
  const { resident, careSupplyProducts, supplyEditor, setSupplyEditor, supplySaving, saveSupply } = r;
  useEscapeClose(() => !supplySaving && setSupplyEditor(null), Boolean(supplyEditor));
  if (!supplyEditor) return null;
  return (
    <div
      className="area-editor-overlay"
      role="presentation"
      onMouseDown={(event) => event.currentTarget === event.target && setSupplyEditor(null)}
    >
      <section className="area-editor-panel" role="dialog" aria-modal="true" aria-labelledby="supply-editor-title">
        <header className="area-editor-header">
          <div>
            <p className="eyebrow">CareOS {t.many} · Pflegebedarf</p>
            <h2 id="supply-editor-title">{supplyEditor.id ? "Bedarf bearbeiten" : "Pflegebedarf hinzufügen"}</h2>
            <p>
              {supplyEditor.id
                ? `Pflegebedarf für ${resident.name} verwalten.`
                : `Ein Produkt aus dem zentralen Katalog für ${resident.name} buchen.`}
            </p>
          </div>
          <button
            className="area-editor-close"
            type="button"
            onClick={() => setSupplyEditor(null)}
            aria-label="Pflegebedarf schließen"
          >
            ×
          </button>
        </header>

        <form className="area-editor-form" onSubmit={saveSupply}>
          <div className="area-editor-intro">
            <span className="area-editor-icon">
              <ClipboardText aria-hidden="true" />
            </span>
            <div>
              <strong>{supplyEditor.id ? "Bestand und Status" : "Produkt aus dem Pflegekatalog"}</strong>
              <p>
                {supplyEditor.id
                  ? `Der bestehende ${t.prefix}bestand wird aktualisiert.`
                  : `Die gebuchte Menge wird dem aktuellen ${t.prefix}bestand hinzugefügt und protokolliert.`}
              </p>
            </div>
            <span className="duty-assignment-status">
              <i />
              {supplyEditor.draft.status === "blocked"
                ? "Gesperrt"
                : supplyEditor.draft.status === "archived"
                  ? "Archiviert"
                  : "Aktiv"}
            </span>
          </div>

          <div className="area-editor-grid">
            {supplyEditor.id ? (
              <>
                <label className="area-editor-wide">
                  <span>Artikel</span>
                  <input value={supplyEditor.draft.itemName} readOnly />
                </label>
                <label>
                  <span>Aktueller Bestand</span>
                  <input
                    type="number"
                    min="0"
                    value={supplyEditor.draft.currentQuantity}
                    onChange={(event) =>
                      setSupplyEditor((current) =>
                        current
                          ? {
                              ...current,
                              draft: { ...current.draft, currentQuantity: Number(event.target.value) || 0 },
                            }
                          : current,
                      )
                    }
                  />
                </label>
                <label>
                  <span>Sollbestand</span>
                  <input
                    type="number"
                    min="0"
                    value={supplyEditor.draft.targetQuantity}
                    onChange={(event) =>
                      setSupplyEditor((current) =>
                        current
                          ? {
                              ...current,
                              draft: { ...current.draft, targetQuantity: Number(event.target.value) || 0 },
                            }
                          : current,
                      )
                    }
                  />
                </label>
                <label>
                  <span>Status</span>
                  <CareSelect
                    label="Status"
                    value={
                      supplyEditor.draft.status === "active"
                        ? "Aktiv"
                        : supplyEditor.draft.status === "blocked"
                          ? "Gesperrt"
                          : "Archiviert"
                    }
                    options={["Aktiv", "Gesperrt", "Archiviert"]}
                    onChange={(value) =>
                      setSupplyEditor((current) =>
                        current
                          ? {
                              ...current,
                              draft: {
                                ...current.draft,
                                status:
                                  value === "Gesperrt" ? "blocked" : value === "Archiviert" ? "archived" : "active",
                              },
                            }
                          : current,
                      )
                    }
                  />
                </label>
                <label>
                  <span>Kategorie</span>
                  <input value={supplyEditor.draft.category} readOnly />
                </label>
                <label className="area-editor-wide">
                  <span>Hinweis</span>
                  <textarea
                    value={supplyEditor.draft.notes}
                    onChange={(event) =>
                      setSupplyEditor((current) =>
                        current ? { ...current, draft: { ...current.draft, notes: event.target.value } } : current,
                      )
                    }
                    placeholder="Zusätzliche Hinweise für das Team …"
                    rows={4}
                  />
                </label>
              </>
            ) : (
              <>
                <label className="area-editor-wide">
                  <span>Pflegeprodukt</span>
                  <CareSelect
                    label="Pflegeprodukt"
                    value={
                      careSupplyProducts.find((product) => product.id === supplyEditor.draft.productId)?.item_name ??
                      "Produkt wählen"
                    }
                    options={careSupplyProducts.map((product) => product.item_name)}
                    onChange={(value) => {
                      const product = careSupplyProducts.find((item) => item.item_name === value);
                      setSupplyEditor((current) =>
                        current && product
                          ? {
                              ...current,
                              draft: {
                                ...current.draft,
                                productId: product.id,
                                itemName: product.item_name,
                                category: product.category,
                                unit: product.unit,
                                targetQuantity: product.default_target_quantity,
                              },
                            }
                          : current,
                      );
                    }}
                  />
                </label>
                <label>
                  <span>Menge ({supplyEditor.draft.unit})</span>
                  <input
                    type="number"
                    min="1"
                    max="100000"
                    step="1"
                    value={supplyEditor.draft.quantity}
                    onChange={(event) =>
                      setSupplyEditor((current) =>
                        current
                          ? {
                              ...current,
                              draft: { ...current.draft, quantity: Math.max(1, Number(event.target.value) || 1) },
                            }
                          : current,
                      )
                    }
                    autoFocus
                  />
                </label>
                <label>
                  <span>Vorgeschlagener Sollbestand</span>
                  <input value={`${supplyEditor.draft.targetQuantity} ${supplyEditor.draft.unit}`} readOnly />
                </label>
                <label className="area-editor-wide">
                  <span>Buchungshinweis</span>
                  <textarea
                    value={supplyEditor.draft.notes}
                    onChange={(event) =>
                      setSupplyEditor((current) =>
                        current ? { ...current, draft: { ...current.draft, notes: event.target.value } } : current,
                      )
                    }
                    placeholder="Optional: Grösse, Marke oder weiterer Hinweis …"
                    rows={3}
                  />
                </label>
                {!careSupplyProducts.length && (
                  <p className="supplies-error area-editor-wide" role="status">
                    Im Pflegekatalog sind aktuell keine aktiven Produkte verfügbar. Bitte wende dich an die
                    Administration.
                  </p>
                )}
              </>
            )}
          </div>

          {r.suppliesError && (
            <p className="appointment-editor-error" role="alert">
              {r.suppliesError}
            </p>
          )}

          <div className="duty-assignment-summary">
            <span>
              <strong>{supplyEditor.draft.itemName || "Kein Produkt ausgewählt"}</strong>
              <small>
                {supplyEditor.draft.category} · {supplyEditor.draft.unit}
              </small>
            </span>
            <span>
              <strong>
                {supplyEditor.id
                  ? `${supplyEditor.draft.currentQuantity} von ${supplyEditor.draft.targetQuantity} ${supplyEditor.draft.unit}`
                  : `${supplyEditor.draft.quantity} ${supplyEditor.draft.unit}`}
              </strong>
              <small>{supplyEditor.id ? "Bestand nach Sollmenge" : `Wird dem ${t.oneOblique} gutgeschrieben`}</small>
            </span>
          </div>

          <footer className="area-editor-actions">
            <button className="secondary-button" type="button" onClick={() => setSupplyEditor(null)}>
              Abbrechen
            </button>
            <button
              className="primary-button"
              disabled={supplySaving || (!supplyEditor.id && !careSupplyProducts.length)}
            >
              <Check /> {supplySaving ? "Speichern…" : supplyEditor.id ? "Bestand aktualisieren" : "Menge buchen"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
