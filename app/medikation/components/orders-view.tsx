"use client";

import { useState } from "react";
import { CareOptionSelect } from "@/app/components/care-form-controls";
import {
  EditorDialog,
  EmptyState,
  LoadError,
  PageHeading,
  formatDate,
  formatDateTime,
  requestJson,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import { ORDER_STATUSES, type PharmacyOrder, type PharmacyOrderItem } from "@/lib/portal-shared";

type Option = { id: string; name: string };
type Payload = { orders: PharmacyOrder[]; pharmacies: Option[]; careUnits: Option[]; residents: Option[] };
type Draft = { pharmacyId: string; careUnitId: string; residentId: string; note: string; items: PharmacyOrderItem[] };

const emptyItem = (): PharmacyOrderItem => ({ medication: "", strength: "", quantity: 1, unit: "Packungen", note: "" });
const tone: Record<PharmacyOrder["status"], string> = {
  open: "attention",
  confirmed: "info",
  delivered: "stable",
  rejected: "critical",
  cancelled: "info",
};

// Medikation › Bestellungen: Bestellungen bei der Apotheke über das Apothekenportal. Die Apotheke bestätigt, liefert
// oder lehnt ab; den Eingang bucht die Pflege wie bisher im Bestand.
export default function OrdersView({ showToast }: { showToast: ShowToast }) {
  const data = useApiData<Payload>("/api/pharmacy/orders");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [cancelling, setCancelling] = useState<PharmacyOrder | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const orders = data.data?.orders ?? [];
  const pharmacies = data.data?.pharmacies ?? [];
  const setItem = (index: number, change: Partial<PharmacyOrderItem>) =>
    draft &&
    setDraft({
      ...draft,
      items: draft.items.map((item, position) => (position === index ? { ...item, ...change } : item)),
    });

  return (
    <>
      <PageHeading
        eyebrow="Medikamente"
        title="Bestellungen"
        description="Medikamente bei der Apotheke bestellen; die Apotheke antwortet im Apothekenportal."
        action={{
          label: "Bestellung erfassen",
          disabled: !pharmacies.length,
          onClick: () => {
            setDraft({
              pharmacyId: pharmacies[0]?.id ?? "",
              careUnitId: "",
              residentId: "",
              note: "",
              items: [emptyItem()],
            });
            setError("");
          },
        }}
      />
      {data.error && <LoadError message={data.error} onRetry={data.reload} />}
      {data.data && !pharmacies.length && (
        <p className="list-hint">
          Noch keine Apotheke angebunden. Die Administration legt dafür unter Leitung › Administration › Portal einen
          Zugang der Art „Apotheke“ an.
        </p>
      )}
      <section className="card med-orders-card" aria-labelledby="med-orders-title">
        <div className="card-header">
          <div>
            <p className="eyebrow">Apotheke</p>
            <h2 className="card-title" id="med-orders-title">
              Bestellungen ({orders.length})
            </h2>
          </div>
        </div>
        <ul className="med-interaction-list med-orders-list">
          {orders.map((order) => (
            <li key={order.id}>
              <span className={`status-badge ${tone[order.status]}`}>{ORDER_STATUSES[order.status]}</span>
              <div>
                <strong>
                  {order.pharmacyName} · {formatDateTime(order.createdAt)}
                </strong>
                <ul className="portal-order-items">
                  {order.items.map((item, index) => (
                    <li key={index}>
                      {item.quantity} {item.unit} {item.medication} {item.strength}
                      {item.note ? ` – ${item.note}` : ""}
                    </li>
                  ))}
                </ul>
                <small>
                  {[order.careUnit, order.residentName, order.requestedBy && `bestellt von ${order.requestedBy}`]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
                {order.note && <p>Hinweis: {order.note}</p>}
                {(order.pharmacyNote || order.expectedOn) && (
                  <p>
                    Apotheke: {order.pharmacyNote}
                    {order.expectedOn ? ` (Lieferung ${formatDate(order.expectedOn)})` : ""}
                  </p>
                )}
                {(order.status === "open" || order.status === "confirmed") && (
                  <button className="quiet-button" type="button" onClick={() => setCancelling(order)}>
                    Stornieren
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {data.data && !orders.length && (
          <EmptyState title="Noch keine Bestellungen" text="Über „Bestellung erfassen“ bei der Apotheke bestellen." />
        )}
      </section>

      {draft && (
        <EditorDialog
          id="pharmacy-order"
          eyebrow="Medikation · Bestellung"
          title="Bestellung erfassen"
          description="Die Apotheke sieht die Bestellung sofort im Apothekenportal."
          onClose={() => setDraft(null)}
          onSubmit={async () => {
            setSaving(true);
            setError("");
            try {
              await requestJson("/api/pharmacy/orders", {
                method: "POST",
                body: {
                  ...draft,
                  careUnitId: draft.careUnitId || null,
                  residentId: draft.residentId || null,
                },
              });
              setDraft(null);
              data.reload();
              showToast("Bestellung an die Apotheke gesendet");
            } catch (cause) {
              setError((cause as Error).message);
            } finally {
              setSaving(false);
            }
          }}
          saving={saving}
          error={error}
          submitLabel="Bestellen"
        >
          <label className="area-editor-wide">
            <span>Apotheke</span>
            <CareOptionSelect
              label="Apotheke"
              value={draft.pharmacyId}
              options={pharmacies.map((entry) => ({ value: entry.id, label: entry.name }))}
              onChange={(value) => setDraft({ ...draft, pharmacyId: value })}
            />
          </label>
          <label>
            <span>Wohnbereich (optional)</span>
            <CareOptionSelect
              label="Wohnbereich"
              value={draft.careUnitId}
              placeholder="Ganzes Haus"
              options={(data.data?.careUnits ?? []).map((entry) => ({ value: entry.id, label: entry.name }))}
              onChange={(value) => setDraft({ ...draft, careUnitId: value })}
            />
          </label>
          <label>
            <span>Für Person (optional)</span>
            <CareOptionSelect
              label="Person"
              value={draft.residentId}
              placeholder="Stationsbestand"
              options={(data.data?.residents ?? []).map((entry) => ({ value: entry.id, label: entry.name }))}
              onChange={(value) => setDraft({ ...draft, residentId: value })}
            />
          </label>
          {draft.items.map((item, index) => (
            <fieldset className="area-editor-wide med-order-item" key={index}>
              <legend>Position {index + 1}</legend>
              <label>
                <span>Präparat</span>
                <input
                  value={item.medication}
                  maxLength={220}
                  onChange={(event) => setItem(index, { medication: event.target.value })}
                  required
                />
              </label>
              <label>
                <span>Stärke</span>
                <input
                  value={item.strength}
                  maxLength={80}
                  onChange={(event) => setItem(index, { strength: event.target.value })}
                />
              </label>
              <label>
                <span>Menge</span>
                <input
                  type="number"
                  min={0.25}
                  step={0.25}
                  value={item.quantity}
                  onChange={(event) => setItem(index, { quantity: Number(event.target.value) })}
                  required
                />
              </label>
              <label>
                <span>Einheit</span>
                <input
                  value={item.unit}
                  maxLength={40}
                  onChange={(event) => setItem(index, { unit: event.target.value })}
                  required
                />
              </label>
              {draft.items.length > 1 && (
                <button
                  className="quiet-button"
                  type="button"
                  onClick={() => setDraft({ ...draft, items: draft.items.filter((_, position) => position !== index) })}
                >
                  Position entfernen
                </button>
              )}
            </fieldset>
          ))}
          <button
            className="secondary-button area-editor-wide"
            type="button"
            disabled={draft.items.length >= 30}
            onClick={() => setDraft({ ...draft, items: [...draft.items, emptyItem()] })}
          >
            Position hinzufügen
          </button>
          <label className="area-editor-wide">
            <span>Hinweis an die Apotheke</span>
            <textarea
              rows={3}
              value={draft.note}
              maxLength={2000}
              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            />
          </label>
        </EditorDialog>
      )}
      {cancelling && (
        <EditorDialog
          id="pharmacy-order-cancel"
          eyebrow="Medikation · Bestellung"
          title="Bestellung stornieren"
          description="Die Apotheke sieht die Bestellung danach als storniert."
          onClose={() => setCancelling(null)}
          onSubmit={async () => {
            setSaving(true);
            setError("");
            try {
              await requestJson("/api/pharmacy/orders", { method: "DELETE", body: { id: cancelling.id } });
              setCancelling(null);
              data.reload();
              showToast("Bestellung storniert");
            } catch (cause) {
              setError((cause as Error).message);
            } finally {
              setSaving(false);
            }
          }}
          saving={saving}
          error={error}
          submitLabel="Stornieren"
          danger
        >
          <p className="area-editor-wide">
            {cancelling.items.map((item) => `${item.quantity} ${item.unit} ${item.medication}`).join(", ")}
          </p>
        </EditorDialog>
      )}
    </>
  );
}
