"use client";

import { useState, type ReactNode } from "react";
import type { MedOrder } from "@/lib/medication-shared";
import { EditorDialog, ReasonDialog, requestJson, type ShowToast } from "@/app/components/workspace-ui";
import OrderEditor from "./order-editor";

type Dialog =
  | { kind: "editor"; order: MedOrder | null; isPrn: boolean }
  | { kind: "status"; order: MedOrder; status: "paused" | "stopped" }
  | { kind: "allergies" }
  | null;

// Dialog state for creating/editing orders, changing their status and editing allergies.
export function useOrderDialogs({
  resident,
  showToast,
  onChanged,
}: {
  resident: { id: string; name: string; allergies: string | null } | null;
  showToast: ShowToast;
  onChanged: () => void;
}): {
  openCreate: (isPrn: boolean) => void;
  openEdit: (order: MedOrder) => void;
  openAllergies: () => void;
  dialogs: ReactNode;
} {
  const [dialog, setDialog] = useState<Dialog>(null);
  const done = (message: string) => {
    setDialog(null);
    showToast(message);
    onChanged();
  };
  const changeStatus = async (order: MedOrder, status: "active" | "paused" | "stopped", reason?: string) => {
    await requestJson(`/api/medication/orders/${order.id}`, { method: "PATCH", body: { status, reason } });
    done(`${order.name}: ${status === "active" ? "fortgesetzt" : status === "paused" ? "pausiert" : "abgesetzt"}`);
  };

  let dialogs: ReactNode = null;
  if (resident && dialog?.kind === "editor")
    dialogs = (
      <OrderEditor
        residentId={resident.id}
        residentName={resident.name}
        order={dialog.order}
        isPrn={dialog.isPrn}
        onClose={() => setDialog(null)}
        onSaved={done}
        onChangeStatus={(status) => {
          if (!dialog.order) return;
          if (status === "active") void changeStatus(dialog.order, "active").catch((e: Error) => showToast(e.message));
          else setDialog({ kind: "status", order: dialog.order, status });
        }}
      />
    );
  if (dialog?.kind === "status")
    dialogs = (
      <ReasonDialog
        title={`${dialog.order.name} ${dialog.status === "stopped" ? "absetzen" : "pausieren"}`}
        description={
          dialog.status === "stopped"
            ? "Abgesetzte Verordnungen erscheinen nicht mehr im Plan und in der Runde. Der Vorgang wird protokolliert."
            : "Pausierte Verordnungen erscheinen nicht in der Runde, bis sie fortgesetzt werden."
        }
        label="Grund und ärztliche Anordnung"
        placeholder="z. B. Absetzen laut Visite Dr. Weber vom 25.09."
        submitLabel={dialog.status === "stopped" ? "Absetzen" : "Pausieren"}
        danger={dialog.status === "stopped"}
        onClose={() => setDialog(null)}
        onConfirm={(reason) => changeStatus(dialog.order, dialog.status, reason)}
      />
    );
  if (resident && dialog?.kind === "allergies")
    dialogs = (
      <AllergyDialog
        resident={resident}
        onClose={() => setDialog(null)}
        onSaved={() => done(`Allergien von ${resident.name} gespeichert`)}
      />
    );

  return {
    openCreate: (isPrn) => setDialog({ kind: "editor", order: null, isPrn }),
    openEdit: (order) => setDialog({ kind: "editor", order, isPrn: order.isPrn }),
    openAllergies: () => setDialog({ kind: "allergies" }),
    dialogs,
  };
}

function AllergyDialog({
  resident,
  onClose,
  onSaved,
}: {
  resident: { id: string; name: string; allergies: string | null };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(resident.allergies ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await requestJson(`/api/medication/residents/${resident.id}`, { method: "PATCH", body: { allergies: value } });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  };
  return (
    <EditorDialog
      id="med-allergies"
      eyebrow={`Medikamente · ${resident.name}`}
      title="Medikamentenallergien"
      description="Wird in Plan, Runde und Reserven angezeigt. „Keine bekannt“ eintragen, wenn keine Allergien vorliegen."
      onClose={onClose}
      onSubmit={save}
      saving={saving}
      error={error}
      submitLabel="Speichern"
    >
      <label className="area-editor-wide">
        <span>Allergien und Unverträglichkeiten</span>
        <textarea
          autoFocus
          rows={3}
          maxLength={1000}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="z. B. Penicillin (Exanthem), Ibuprofen – oder „Keine bekannt“"
        />
      </label>
    </EditorDialog>
  );
}
