"use client";

import { useTerms } from "@/app/components/care-context";
import ModulePageShell from "@/app/components/module-page-shell";
import { ModuleIcon } from "@/app/components/module-icon";
import { useCareSupplyCatalog } from "./use-care-supply-catalog";
import { CatalogKpis } from "./care-supply-catalog-parts";
import { CatalogTable } from "./care-supply-catalog-table";
import { CatalogEditorDialog } from "./care-supply-catalog-editor";

export default function CareSupplyCatalog() {
  const t = useTerms();
  const r = useCareSupplyCatalog();
  const { products, error, query, setQuery, filter, setFilter, editor, visibleProducts, openEditor } = r;
  return (
    <ModulePageShell
      activeModule="admin"
      activeChild="Pflegebedarf"
      pageClass="leadership-page leadership-users admin-supply-catalog-page"
    >
      {() => (
        <main className="workspace leadership-workspace leadership-users care-supply-catalog">
          <header className="leadership-heading page-heading">
            <div className="heading-copy">
              <p className="eyebrow">Administration</p>
              <h1>Pflegebedarf</h1>
              <p>Pflegeprodukte zentral pflegen und für die {t.prefix}akte bereitstellen.</p>
            </div>
            <button className="primary-button" type="button" onClick={() => openEditor()}>
              <ModuleIcon name="plus" className="button-icon" />
              Produkt anlegen
            </button>
          </header>
          <CatalogKpis r={r} />
          <section className="card admin-users-card care-supply-catalog-card">
            <header className="admin-table-header care-supply-card-head">
              <div>
                <p className="eyebrow">Produktkatalog</p>
                <h2 className="card-title">Material und Hilfsmittel</h2>
                <p className="card-subtitle">
                  {visibleProducts.length} von {products.length} Produkten
                </p>
              </div>
              <label className="resident-search">
                <ModuleIcon name="search" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Produkt suchen…"
                  aria-label="Pflegeprodukt suchen"
                />
              </label>
            </header>
            <div className="care-supply-filters" role="group" aria-label="Produkte filtern">
              {["Alle", "Aktiv", "Nachbestellen", "Gesperrt", "Archiviert"].map((label) => (
                <button
                  type="button"
                  key={label}
                  className={filter === label ? "active" : ""}
                  aria-pressed={filter === label}
                  onClick={() => setFilter(label)}
                >
                  {label}
                </button>
              ))}
            </div>
            {error && !editor && (
              <p className="supplies-error" role="alert">
                {error}
              </p>
            )}
            <CatalogTable r={r} />
          </section>

          {editor && <CatalogEditorDialog r={r} />}
        </main>
      )}
    </ModulePageShell>
  );
}
