"use client";

import { useTerms } from "@/app/components/care-context";
import { Archive, Check, ClipboardText, PencilSimple, Plus, Prohibit, Sparkle } from "@phosphor-icons/react";
import { SidebarTooltip } from "@/app/components/app-sidebar";
import { needsReorder } from "./care-supply-catalog-model";
import type { CareSupplyCatalogState } from "./use-care-supply-catalog";

export function CatalogTable({ r }: { r: CareSupplyCatalogState }) {
  const t = useTerms();
  const { products, loading, visibleProducts, openEditor, setProductStatus } = r;
  return (
    <div className="care-supply-table-wrap">
      <div className="care-supply-table-head">
        <span>Produkt</span>
        <span>Kategorie</span>
        <span>Einheit</span>
        <span>Sollmenge</span>
        <span>Bestand</span>
        <span>Status</span>
        <span>Aktionen</span>
      </div>
      {loading ? (
        <p className="care-supply-state">Katalog wird geladen…</p>
      ) : visibleProducts.length ? (
        <div className="care-supply-products">
          {visibleProducts.map((product) => (
            <article className="care-supply-product" key={product.id}>
              <span className="care-supply-product-icon">
                <ClipboardText />
              </span>
              <div className="care-supply-product-name">
                <strong>{product.item_name}</strong>
                <small>{product.description || "Keine Zusatzinformation"}</small>
              </div>
              <span>{product.category}</span>
              <span>{product.unit}</span>
              <span>
                {product.default_target_quantity} {product.unit}
              </span>
              <span className={`care-supply-product-stock ${needsReorder(product) ? "low" : ""}`}>
                {product.current_stock_quantity} {product.unit}
                {product.min_stock_quantity > 0 && (
                  <small>{needsReorder(product) ? "Nachbestellen" : `min. ${product.min_stock_quantity}`}</small>
                )}
              </span>
              <span className={`care-supply-product-status ${product.status}`}>
                {product.status === "active" ? "Aktiv" : product.status === "blocked" ? "Gesperrt" : "Archiviert"}
              </span>
              <div className="care-supply-product-actions">
                <button
                  type="button"
                  aria-label={`${product.item_name} bearbeiten`}
                  onClick={() => openEditor(product)}
                >
                  <PencilSimple />
                  <SidebarTooltip label="Produkt bearbeiten" placement="top" />
                </button>
                {product.status === "active" ? (
                  <button
                    type="button"
                    aria-label={`${product.item_name} sperren`}
                    onClick={() => void setProductStatus(product, "blocked")}
                  >
                    <Prohibit />
                    <SidebarTooltip label="Produkt sperren" placement="top" />
                  </button>
                ) : product.status === "blocked" ? (
                  <button
                    type="button"
                    aria-label={`${product.item_name} aktivieren`}
                    onClick={() => void setProductStatus(product, "active")}
                  >
                    <Check />
                    <SidebarTooltip label="Produkt aktivieren" placement="top" />
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label={`${product.item_name} wiederherstellen`}
                    onClick={() => void setProductStatus(product, "active")}
                  >
                    <Sparkle />
                    <SidebarTooltip label="Produkt wiederherstellen" placement="top" />
                  </button>
                )}
                {product.status !== "archived" && (
                  <button
                    type="button"
                    aria-label={`${product.item_name} archivieren`}
                    onClick={() => void setProductStatus(product, "archived")}
                  >
                    <Archive />
                    <SidebarTooltip label="Produkt archivieren" placement="top" />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="care-supply-empty">
          <ClipboardText />
          <strong>{products.length ? "Keine passenden Produkte" : "Der Katalog ist noch leer"}</strong>
          <p>
            {products.length
              ? "Passe Suche oder Filter an."
              : `Lege die benötigten Pflegeprodukte an. Mitarbeitende können sie danach direkt ${t.manyDative} zuweisen.`}
          </p>
          {!products.length && (
            <button className="secondary-button" type="button" onClick={() => openEditor()}>
              <Plus /> Erstes Produkt anlegen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
