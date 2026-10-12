"use client";

import { useState } from "react";
import { CareSelect } from "@/app/components/care-form-controls";
import { useApiData } from "@/app/components/workspace-ui";
import {
  EDGE_OPTIONS,
  EXUDATE_OPTIONS,
  SKIN_OPTIONS,
  TISSUE_OPTIONS,
  WOUND_MATERIALS_MAX,
  materialLabel,
} from "@/lib/wounds-shared";

type CatalogProduct = { id: string; item_name: string; unit: string; category: string };
type DraftMaterial = { productId: string; name: string; unit: string; quantity: number };

export type EntryDraft = {
  lengthCm: string;
  widthCm: string;
  depthCm: string;
  tissue: string;
  exudate: string;
  woundEdge: string;
  surroundingSkin: string;
  odor: boolean;
  infectionSigns: boolean;
  painScore: string;
  treatment: string;
  materials: DraftMaterial[];
  note: string;
};

export const emptyEntry: EntryDraft = {
  lengthCm: "",
  widthCm: "",
  depthCm: "",
  tissue: "",
  exudate: "",
  woundEdge: "",
  surroundingSkin: "",
  odor: false,
  infectionSigns: false,
  painScore: "",
  treatment: "",
  materials: [],
  note: "",
};

const NOT_SET = "Nicht beurteilt";
const PAIN = ["Nicht erhoben", ...Array.from({ length: 11 }, (_, i) => `${i}`)];
const decimal = (value: string) => (value.trim() ? Number(value.replace(",", ".")) : null);

export function entryPayload(draft: EntryDraft) {
  return {
    lengthCm: decimal(draft.lengthCm),
    widthCm: decimal(draft.widthCm),
    depthCm: decimal(draft.depthCm),
    tissue: draft.tissue || null,
    exudate: draft.exudate || null,
    woundEdge: draft.woundEdge || null,
    surroundingSkin: draft.surroundingSkin || null,
    odor: draft.odor,
    infectionSigns: draft.infectionSigns,
    painScore: draft.painScore === "" ? null : Number(draft.painScore),
    treatment: draft.treatment,
    materials: draft.materials.map(({ productId, quantity }) => ({ productId, quantity })),
    note: draft.note,
  };
}

// Structured wound assessment shared by the initial assessment and follow-up entries.
export default function EntryFields({ draft, onChange }: { draft: EntryDraft; onChange: (draft: EntryDraft) => void }) {
  const set = <K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) => onChange({ ...draft, [key]: value });
  const select = (
    key: "tissue" | "exudate" | "woundEdge" | "surroundingSkin",
    label: string,
    options: readonly string[],
  ) => (
    <label>
      <span>{label}</span>
      <CareSelect
        label={label}
        value={draft[key] || NOT_SET}
        options={[NOT_SET, ...options]}
        onChange={(value) => set(key, value === NOT_SET ? "" : value)}
      />
    </label>
  );
  return (
    <>
      <div className="area-editor-wide form-field">
        <span>Grösse (cm)</span>
        <div className="wound-size-inputs">
          <input
            inputMode="decimal"
            aria-label="Länge in cm"
            placeholder="Länge"
            value={draft.lengthCm}
            onChange={(e) => set("lengthCm", e.target.value)}
          />
          <b aria-hidden="true">×</b>
          <input
            inputMode="decimal"
            aria-label="Breite in cm"
            placeholder="Breite"
            value={draft.widthCm}
            onChange={(e) => set("widthCm", e.target.value)}
          />
          <b aria-hidden="true">×</b>
          <input
            inputMode="decimal"
            aria-label="Tiefe in cm"
            placeholder="Tiefe (optional)"
            value={draft.depthCm}
            onChange={(e) => set("depthCm", e.target.value)}
          />
        </div>
      </div>
      {select("tissue", "Wundgrund", TISSUE_OPTIONS)}
      {select("exudate", "Exsudat", EXUDATE_OPTIONS)}
      {select("woundEdge", "Wundrand", EDGE_OPTIONS)}
      {select("surroundingSkin", "Wundumgebung", SKIN_OPTIONS)}
      <label>
        <span>Schmerz (NRS 0–10)</span>
        <CareSelect
          label="Schmerz"
          value={draft.painScore === "" ? PAIN[0] : draft.painScore}
          options={PAIN}
          onChange={(value) => set("painScore", value === PAIN[0] ? "" : value)}
        />
      </label>
      <div className="form-field">
        <span>Beobachtungen</span>
        <label className="form-checkbox">
          <input type="checkbox" checked={draft.odor} onChange={(e) => set("odor", e.target.checked)} />
          Auffälliger Geruch
        </label>
        <label className="form-checkbox">
          <input
            type="checkbox"
            checked={draft.infectionSigns}
            onChange={(e) => set("infectionSigns", e.target.checked)}
          />
          Infektionszeichen (Rötung, Wärme, Schwellung, Eiter)
        </label>
      </div>
      <label className="area-editor-wide">
        <span>Durchgeführte Versorgung</span>
        <textarea
          rows={2}
          maxLength={4000}
          value={draft.treatment}
          onChange={(e) => set("treatment", e.target.value)}
          placeholder="z. B. Reinigung mit NaCl 0,9 %, Hydrokolloidverband, Druckentlastung"
        />
      </label>
      <MaterialFields materials={draft.materials} onChange={(materials) => set("materials", materials)} />
      <label className="area-editor-wide">
        <span>Bemerkung</span>
        <textarea
          rows={2}
          maxLength={4000}
          value={draft.note}
          onChange={(e) => set("note", e.target.value)}
          placeholder="Weitere Beobachtungen, Absprachen"
        />
      </label>
    </>
  );
}

const CHOOSE = "Material wählen";
const productLabel = (p: CatalogProduct) => `${p.item_name} (${p.unit})`;

// Verbandsmaterial aus dem Materialkatalog (Administration · Pflegebedarf) mit Menge je Versorgung.
function MaterialFields({
  materials,
  onChange,
}: {
  materials: DraftMaterial[];
  onChange: (materials: DraftMaterial[]) => void;
}) {
  const catalog = useApiData<{ products: CatalogProduct[] }>("/api/care-supply-products");
  const [choice, setChoice] = useState(CHOOSE);
  const [quantity, setQuantity] = useState("1");
  const products = (catalog.data?.products ?? []).filter((p) => !materials.some((m) => m.productId === p.id));
  const product = products.find((p) => productLabel(p) === choice);
  const amount = Number(quantity);
  const valid = Boolean(product) && Number.isInteger(amount) && amount >= 1 && amount <= 999;
  return (
    <div className="area-editor-wide form-field wound-materials">
      <span>Verbandsmaterial</span>
      {materials.length > 0 && (
        <ul>
          {materials.map((m) => (
            <li key={m.productId}>
              {materialLabel(m)}
              <button
                className="quiet-button"
                type="button"
                aria-label={`${m.name} entfernen`}
                onClick={() => onChange(materials.filter((x) => x.productId !== m.productId))}
              >
                Entfernen
              </button>
            </li>
          ))}
        </ul>
      )}
      {catalog.data && !catalog.data.products.length ? (
        <small>Im Materialkatalog (Administration · Pflegebedarf) sind keine Produkte hinterlegt.</small>
      ) : (
        materials.length < WOUND_MATERIALS_MAX && (
          <div className="wound-material-add">
            <CareSelect
              label="Material"
              value={product ? choice : CHOOSE}
              options={[CHOOSE, ...products.map(productLabel)]}
              onChange={setChoice}
            />
            <input
              type="number"
              min={1}
              max={999}
              aria-label="Menge"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
            <button
              className="quiet-button"
              type="button"
              disabled={!valid}
              onClick={() => {
                if (!product) return;
                onChange([
                  ...materials,
                  { productId: product.id, name: product.item_name, unit: product.unit, quantity: amount },
                ]);
                setChoice(CHOOSE);
                setQuantity("1");
              }}
            >
              Hinzufügen
            </button>
          </div>
        )
      )}
    </div>
  );
}
