"use client";

import { useTerms } from "@/app/components/care-context";
import { Check, ClipboardText } from "@phosphor-icons/react";
import { CareSelect } from "@/app/components/care-form-controls";
import type { CareSupplyCatalogState } from "./use-care-supply-catalog";
import { categories, units } from "./care-supply-catalog-model";

export function CatalogEditorDialog({ r }: { r: CareSupplyCatalogState }) {
  const t = useTerms();
  const { error, editor, setEditor, saving, save } = r;
  if (!editor) return null;
  return (
    <div
      className="area-editor-overlay"
      role="presentation"
      onMouseDown={(event) => event.currentTarget === event.target && setEditor(null)}
    >
      <section className="area-editor-panel" role="dialog" aria-modal="true" aria-labelledby="care-supply-editor-title">
        <header className="area-editor-header">
          <div>
            <p className="eyebrow">Administration · Pflegebedarf</p>
            <h2 id="care-supply-editor-title">{editor.id ? "Pflegeprodukt bearbeiten" : "Pflegeprodukt anlegen"}</h2>
            <p>Der Katalog wird für die Pflegebedarfsbuchung in allen {t.prefix}akten verwendet.</p>
          </div>
          <button
            className="area-editor-close"
            type="button"
            aria-label="Editor schließen"
            onClick={() => setEditor(null)}
          >
            ×
          </button>
        </header>
        <form className="area-editor-form" onSubmit={save}>
          <div className="area-editor-intro">
            <span className="area-editor-icon">
              <ClipboardText />
            </span>
            <div>
              <strong>Produktstammdaten</strong>
              <p>Name, Einheit und Sollmenge erscheinen bei der Buchung an {t.many}.</p>
            </div>
          </div>
          <div className="area-editor-grid care-supply-editor-grid">
            <label className="area-editor-wide">
              <span>Produktname</span>
              <input
                required
                maxLength={180}
                autoFocus
                value={editor.draft.itemName}
                onChange={(event) =>
                  setEditor((current) =>
                    current ? { ...current, draft: { ...current.draft, itemName: event.target.value } } : current,
                  )
                }
                placeholder="z. B. Inkontinenzeinlage M"
              />
            </label>
            <label>
              <span>Kategorie</span>
              <CareSelect
                label="Kategorie"
                value={editor.draft.category}
                options={categories}
                onChange={(value) =>
                  setEditor((current) =>
                    current ? { ...current, draft: { ...current.draft, category: value } } : current,
                  )
                }
              />
            </label>
            <label>
              <span>Einheit</span>
              <CareSelect
                label="Einheit"
                value={editor.draft.unit}
                options={units}
                onChange={(value) =>
                  setEditor((current) => (current ? { ...current, draft: { ...current.draft, unit: value } } : current))
                }
              />
            </label>
            <label>
              <span>Vorgeschlagene Sollmenge pro {t.one}</span>
              <input
                type="number"
                min="0"
                max="100000"
                step="1"
                value={editor.draft.defaultTargetQuantity}
                onChange={(event) =>
                  setEditor((current) =>
                    current
                      ? {
                          ...current,
                          draft: { ...current.draft, defaultTargetQuantity: Number(event.target.value) || 0 },
                        }
                      : current,
                  )
                }
              />
            </label>
            <label>
              <span>Vorhandener Bestand</span>
              <input
                type="number"
                min="0"
                max="100000"
                step="1"
                value={editor.draft.currentStockQuantity}
                onChange={(event) =>
                  setEditor((current) =>
                    current
                      ? {
                          ...current,
                          draft: { ...current.draft, currentStockQuantity: Number(event.target.value) || 0 },
                        }
                      : current,
                  )
                }
                aria-describedby="care-supply-stock-help"
              />
              <small id="care-supply-stock-help">
                Aktuell verfügbare Menge im Haus, gemessen in {editor.draft.unit.toLocaleLowerCase("de-CH")}.
              </small>
            </label>
            <label>
              <span>Mindestbestand</span>
              <input
                type="number"
                min="0"
                max="100000"
                step="1"
                value={editor.draft.minStockQuantity}
                onChange={(event) =>
                  setEditor((current) =>
                    current
                      ? {
                          ...current,
                          draft: { ...current.draft, minStockQuantity: Number(event.target.value) || 0 },
                        }
                      : current,
                  )
                }
                aria-describedby="care-supply-min-help"
              />
              <small id="care-supply-min-help">
                Erreicht der Bestand diese Menge, wird die Administration zum Nachbestellen benachrichtigt. 0 = keine
                Überwachung.
              </small>
            </label>
            {editor.id && (
              <label>
                <span>Katalogstatus</span>
                <CareSelect
                  label="Katalogstatus"
                  value={
                    editor.draft.status === "active"
                      ? "Aktiv"
                      : editor.draft.status === "blocked"
                        ? "Gesperrt"
                        : "Archiviert"
                  }
                  options={["Aktiv", "Gesperrt", "Archiviert"]}
                  onChange={(value) =>
                    setEditor((current) =>
                      current
                        ? {
                            ...current,
                            draft: {
                              ...current.draft,
                              status: value === "Gesperrt" ? "blocked" : value === "Archiviert" ? "archived" : "active",
                            },
                          }
                        : current,
                    )
                  }
                />
              </label>
            )}
            <label className="area-editor-wide">
              <span>Beschreibung oder Hinweise</span>
              <textarea
                rows={4}
                maxLength={1200}
                value={editor.draft.description}
                onChange={(event) =>
                  setEditor((current) =>
                    current ? { ...current, draft: { ...current.draft, description: event.target.value } } : current,
                  )
                }
                placeholder="Grösse, Anwendung oder interne Hinweise …"
              />
            </label>
          </div>
          {error && (
            <p className="supplies-error" role="alert">
              {error}
            </p>
          )}
          <footer className="area-editor-actions">
            <button className="secondary-button" type="button" onClick={() => setEditor(null)}>
              Abbrechen
            </button>
            <button className="primary-button" type="submit" disabled={saving}>
              <Check /> {saving ? "Speichern…" : editor.id ? "Änderungen speichern" : "Produkt anlegen"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
