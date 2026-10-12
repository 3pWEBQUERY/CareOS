"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Product, Draft, emptyDraft, needsReorder } from "./care-supply-catalog-model";

export function useCareSupplyCatalog() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Alle");
  const [editor, setEditor] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/care-supply-products", { cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Pflegeprodukte konnten nicht geladen werden.");
      setProducts(data.products ?? []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pflegeprodukte konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    fetch("/api/work-context", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        // Only staff with administration rights manage the catalog.
        const permissions: string[] | undefined = data?.profile?.permissions;
        if (permissions && !permissions.includes("administration.manage")) router.replace("/c");
      })
      .catch(() => undefined);
    return () => window.clearTimeout(timer);
  }, [load, router]);

  const visibleProducts = useMemo(
    () =>
      products.filter((product) => {
        const matchesFilter =
          filter === "Alle" ||
          (filter === "Nachbestellen" && needsReorder(product)) ||
          (filter === "Aktiv"
            ? product.status === "active"
            : filter === "Gesperrt"
              ? product.status === "blocked"
              : filter === "Archiviert" && product.status === "archived");
        const haystack = `${product.item_name} ${product.category} ${product.description ?? ""}`.toLocaleLowerCase(
          "de-CH",
        );
        return matchesFilter && haystack.includes(query.trim().toLocaleLowerCase("de-CH"));
      }),
    [filter, products, query],
  );

  function openEditor(product?: Product) {
    setError("");
    setEditor(
      product
        ? {
            id: product.id,
            draft: {
              itemName: product.item_name,
              category: product.category,
              unit: product.unit,
              description: product.description ?? "",
              defaultTargetQuantity: product.default_target_quantity,
              currentStockQuantity: product.current_stock_quantity,
              minStockQuantity: product.min_stock_quantity,
              status: product.status,
            },
          }
        : { id: null, draft: { ...emptyDraft } },
    );
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/care-supply-products", {
        method: editor.id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...editor.draft, id: editor.id }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Pflegeprodukt konnte nicht gespeichert werden.");
      setProducts((current) =>
        editor.id
          ? current.map((product) => (product.id === editor.id ? data.product : product))
          : [...current, data.product],
      );
      setEditor(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pflegeprodukt konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  async function setProductStatus(product: Product, status: Product["status"]) {
    setError("");
    try {
      const response = await fetch("/api/care-supply-products", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: product.id,
          itemName: product.item_name,
          category: product.category,
          unit: product.unit,
          description: product.description ?? "",
          defaultTargetQuantity: product.default_target_quantity,
          currentStockQuantity: product.current_stock_quantity,
          minStockQuantity: product.min_stock_quantity,
          status,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Status konnte nicht geändert werden.");
      setProducts((current) => current.map((item) => (item.id === product.id ? data.product : item)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Status konnte nicht geändert werden.");
    }
  }

  const activeCount = products.filter((product) => product.status === "active").length;
  const blockedCount = products.filter((product) => product.status === "blocked").length;
  const archivedCount = products.filter((product) => product.status === "archived").length;
  const reorderCount = products.filter(needsReorder).length;
  return {
    router,
    products,
    setProducts,
    loading,
    setLoading,
    error,
    setError,
    query,
    setQuery,
    filter,
    setFilter,
    editor,
    setEditor,
    saving,
    setSaving,
    load,
    visibleProducts,
    openEditor,
    save,
    setProductStatus,
    activeCount,
    blockedCount,
    archivedCount,
    reorderCount,
  };
}

export type CareSupplyCatalogState = ReturnType<typeof useCareSupplyCatalog>;
