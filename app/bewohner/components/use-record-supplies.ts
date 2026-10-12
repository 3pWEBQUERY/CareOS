"use client";

import { useTerms } from "@/app/components/care-context";
import type { Confirm } from "@/app/components/confirm-dialog";
import { useEffect, useState, type FormEvent } from "react";
import { CareSupplyProduct, ResidentSupply, SupplyDraft, emptySupply } from "./resident-record-data";
import type { ResidentRecordData } from "./resident-record-data";

export function useRecordSupplies({
  resident,
  onAction,
  confirm,
}: {
  resident: ResidentRecordData;
  onAction: (message: string) => void;
  confirm: Confirm;
}) {
  const t = useTerms();
  const [supplies, setSupplies] = useState<ResidentSupply[]>([]);
  const [careSupplyProducts, setCareSupplyProducts] = useState<CareSupplyProduct[]>([]);
  const [suppliesLoading, setSuppliesLoading] = useState(Boolean(resident.id));
  const [suppliesError, setSuppliesError] = useState("");
  const [supplyEditor, setSupplyEditor] = useState<{ id: string | null; draft: SupplyDraft } | null>(null);
  const [supplySaving, setSupplySaving] = useState(false);

  useEffect(() => {
    if (!resident.id) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setSuppliesLoading(true);
      fetch(`/api/residents/${resident.id}/supplies`, { cache: "no-store" })
        .then(async (response) => ({ response, data: await response.json().catch(() => null) }))
        .then(({ response, data }) => {
          if (!active) return;
          if (response.ok) {
            setSupplies(data.supplies ?? []);
            setCareSupplyProducts(data.products ?? []);
            setSuppliesError("");
          } else setSuppliesError(data?.error || "Pflegebedarf konnte nicht geladen werden.");
        })
        .catch(() => active && setSuppliesError("Pflegebedarf konnte nicht geladen werden."))
        .finally(() => active && setSuppliesLoading(false));
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [resident.id]);

  function openSupplyEditor(supply?: ResidentSupply) {
    setSuppliesError("");
    setSupplyEditor(
      supply
        ? {
            id: supply.id,
            draft: {
              productId: supply.product_id ?? "",
              quantity: 1,
              itemName: supply.item_name,
              category: supply.category,
              unit: supply.unit,
              currentQuantity: supply.current_quantity,
              targetQuantity: supply.target_quantity,
              status: supply.status,
              notes: supply.notes ?? "",
            },
          }
        : { id: null, draft: { ...emptySupply } },
    );
  }
  async function saveSupply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resident.id || !supplyEditor) {
      setSuppliesError("Diese Demoakte ist nicht gespeichert.");
      return;
    }
    if (!supplyEditor.id && !supplyEditor.draft.productId) {
      setSuppliesError("Bitte wähle ein Pflegeprodukt aus dem Katalog.");
      return;
    }
    setSupplySaving(true);
    setSuppliesError("");
    try {
      const response = await fetch(
        `/api/residents/${resident.id}/supplies${supplyEditor.id ? `/${supplyEditor.id}` : ""}`,
        {
          method: supplyEditor.id ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            supplyEditor.id
              ? supplyEditor.draft
              : {
                  productId: supplyEditor.draft.productId,
                  quantity: supplyEditor.draft.quantity,
                  notes: supplyEditor.draft.notes,
                },
          ),
        },
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setSuppliesError(data?.error || "Pflegebedarf konnte nicht gespeichert werden.");
        return;
      }
      setSupplies((current) =>
        supplyEditor.id
          ? current.map((item) => (item.id === supplyEditor.id ? data.supply : item))
          : [...current.filter((item) => item.product_id !== data.supply.product_id), data.supply],
      );
      setSupplyEditor(null);
      onAction(supplyEditor.id ? "Pflegebedarf aktualisiert" : `Pflegeprodukt dem ${t.oneOblique} zugewiesen`);
    } catch {
      setSuppliesError("Pflegebedarf konnte nicht gespeichert werden.");
    } finally {
      setSupplySaving(false);
    }
  }
  async function deleteSupply(supply: ResidentSupply) {
    if (
      !resident.id ||
      !(await confirm({
        title: "Pflegebedarf entfernen",
        message: `${supply.item_name} wird aus dem Pflegebedarf von ${resident.name} entfernt.`,
        confirmLabel: "Entfernen",
      }))
    )
      return;
    const response = await fetch(`/api/residents/${resident.id}/supplies/${supply.id}`, { method: "DELETE" }).catch(
      () => null,
    );
    if (response?.ok) {
      setSupplies((current) => current.filter((item) => item.id !== supply.id));
      onAction("Pflegebedarf entfernt");
    } else setSuppliesError("Pflegebedarf konnte nicht entfernt werden.");
  }
  return {
    supplies,
    setSupplies,
    careSupplyProducts,
    setCareSupplyProducts,
    suppliesLoading,
    setSuppliesLoading,
    suppliesError,
    setSuppliesError,
    supplyEditor,
    setSupplyEditor,
    supplySaving,
    setSupplySaving,
    openSupplyEditor,
    saveSupply,
    deleteSupply,
  };
}
