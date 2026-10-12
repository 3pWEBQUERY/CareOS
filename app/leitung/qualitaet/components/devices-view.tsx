"use client";

import { useState } from "react";
import ModulePageShell from "@/app/components/module-page-shell";
import {
  EditorDialog,
  LoadError,
  formatDate,
  requestJson,
  todayInZurich,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import { DEVICE_CHECK_RESULTS, type Device, type DeviceCheckResult, type DeviceOverview } from "@/lib/devices-shared";
import { LeadershipHeading, LeadershipKpis } from "../../components/leadership-page-parts";
import { CareDatePicker } from "@/app/components/care-form-controls";

type DeviceDraft = {
  id: string | null;
  name: string;
  category: string;
  inventoryNumber: string;
  manufacturer: string;
  location: string;
  intervalMonths: string;
  nextDueOn: string;
  notes: string;
};
type CheckDraft = {
  device: Device;
  checkedOn: string;
  result: DeviceCheckResult | null;
  findings: string;
  performedBy: string;
  nextDueOn: string;
};

const EMPTY: DeviceDraft = {
  id: null,
  name: "",
  category: "",
  inventoryNumber: "",
  manufacturer: "",
  location: "",
  intervalMonths: "",
  nextDueOn: "",
  notes: "",
};

// Nächste Prüfung nach der Frist des Geräts (nur Vorschlag im Formular; die Frist legt die Einrichtung fest).
function addMonths(day: string, months: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function DevicesContent({ showToast }: { showToast: ShowToast }) {
  const { data, error, reload } = useApiData<DeviceOverview>("/api/devices");
  const [category, setCategory] = useState("");
  const [draft, setDraft] = useState<DeviceDraft | null>(null);
  const [check, setCheck] = useState<CheckDraft | null>(null);
  const [retiring, setRetiring] = useState<Device | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const devices = (data?.devices ?? []).filter((device) => !category || device.category === category);
  const active = (data?.devices ?? []).filter((device) => !device.retired);

  async function run(action: () => Promise<unknown>, message: string) {
    setSaving(true);
    setFormError("");
    try {
      await action();
      reload();
      showToast(message);
      return true;
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <LeadershipHeading
        eyebrow="Qualität · Sicherheit"
        title="Geräte & Prüfungen"
        description="Pflegebetten, Lifter, Waagen und weitere Geräte der Einrichtung mit Prüfungen. Die Frist bis zur nächsten Prüfung legt die Einrichtung bzw. der Hersteller fest."
        action={
          data?.canWrite
            ? {
                label: "Gerät erfassen",
                onClick: () => {
                  setFormError("");
                  setDraft(EMPTY);
                },
              }
            : undefined
        }
      />
      {error && <LoadError message={error} onRetry={reload} />}
      {data && (
        <LeadershipKpis
          kpis={[
            { value: String(active.length), label: "Geräte in Betrieb", note: "im Verzeichnis" },
            {
              value: String(active.filter((device) => device.due).length),
              label: "Prüfung fällig",
              note: "nächste Prüfung heute oder früher",
              tone: active.some((device) => device.due) ? "attention" : undefined,
            },
            {
              value: String(active.filter((device) => device.lastCheck?.result === "defect").length),
              label: "Mängel offen",
              note: "letzte Prüfung mit Mängeln",
              tone: active.some((device) => device.lastCheck?.result === "defect") ? "critical" : undefined,
            },
          ]}
        />
      )}
      {data && data.categories.length > 0 && (
        <div className="repositioning-choices device-filter" role="group" aria-label="Kategorie">
          {["", ...data.categories].map((item) => (
            <button
              key={item || "alle"}
              type="button"
              className={`day-toggle ${category === item ? "active" : ""}`}
              aria-pressed={category === item}
              onClick={() => setCategory(item)}
            >
              {item || "Alle"}
            </button>
          ))}
        </div>
      )}
      {data && !data.devices.length ? (
        <section className="card hygiene-empty">
          <strong>Noch keine Geräte erfasst</strong>
          <p>Zum Beispiel Pflegebetten, Patientenlifter oder Waagen mit Inventarnummer und Prüffrist.</p>
        </section>
      ) : data ? (
        <section className="card device-list" aria-label="Geräte">
          <ul>
            {devices.map((device) => (
              <li
                key={device.id}
                className={device.retired ? "retired" : device.due ? "due" : ""}
                aria-label={device.name}
              >
                <div>
                  <strong>
                    {device.name}
                    {device.inventoryNumber && <span className="diagnosis-code">{device.inventoryNumber}</span>}
                  </strong>
                  <small>
                    {[device.category, device.location, device.manufacturer].filter(Boolean).join(" · ") || "–"}
                  </small>
                  <small className="device-due">
                    {device.retired
                      ? `Ausser Betrieb: ${device.retired.reason}`
                      : device.nextDueOn
                        ? `${device.due ? "Prüfung fällig seit" : "Nächste Prüfung"} ${formatDate(device.nextDueOn)}`
                        : "Nächste Prüfung nicht festgelegt"}
                    {device.lastCheck &&
                      ` · zuletzt ${formatDate(device.lastCheck.checkedOn)}: ${DEVICE_CHECK_RESULTS[device.lastCheck.result]}`}
                  </small>
                  {device.lastCheck?.result === "defect" && (
                    <small className="device-defect">Mängel: {device.lastCheck.findings}</small>
                  )}
                  {device.checks.length > 0 && (
                    <details className="diagnosis-resolved">
                      <summary>Prüfungen ({device.checks.length})</summary>
                      <ul className="device-checks">
                        {device.checks.map((item) => (
                          <li key={item.id}>
                            {formatDate(item.checkedOn)} · {DEVICE_CHECK_RESULTS[item.result]} · {item.performedBy}
                            {item.findings ? ` · ${item.findings}` : ""}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
                {data.canWrite && !device.retired && (
                  <span className="device-actions">
                    <button
                      type="button"
                      className="death-checklist-action"
                      onClick={() => {
                        setFormError("");
                        const day = todayInZurich();
                        setCheck({
                          device,
                          checkedOn: day,
                          result: null,
                          findings: "",
                          performedBy: "",
                          nextDueOn: device.intervalMonths ? addMonths(day, device.intervalMonths) : "",
                        });
                      }}
                    >
                      Prüfung erfassen
                    </button>
                    <button
                      type="button"
                      className="death-checklist-action"
                      aria-label={`${device.name} bearbeiten`}
                      onClick={() => {
                        setFormError("");
                        setDraft({
                          id: device.id,
                          name: device.name,
                          category: device.category,
                          inventoryNumber: device.inventoryNumber,
                          manufacturer: device.manufacturer,
                          location: device.location,
                          intervalMonths: device.intervalMonths ? String(device.intervalMonths) : "",
                          nextDueOn: device.nextDueOn ?? "",
                          notes: device.notes,
                        });
                      }}
                    >
                      Bearbeiten
                    </button>
                    <button
                      type="button"
                      className="death-checklist-action"
                      aria-label={`${device.name} ausser Betrieb nehmen`}
                      onClick={() => {
                        setFormError("");
                        setReason("");
                        setRetiring(device);
                      }}
                    >
                      Ausser Betrieb
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        !error && <p className="record-export-note">Wird geladen …</p>
      )}

      {draft && (
        <EditorDialog
          id="device"
          eyebrow="Qualität · Geräte & Prüfungen"
          title={draft.id ? "Gerät bearbeiten" : "Gerät erfassen"}
          onClose={() => setDraft(null)}
          onSubmit={async () => {
            const saved = await run(
              () => requestJson("/api/devices", { method: "POST", body: draft }),
              draft.id ? "Gerät gespeichert" : "Gerät erfasst",
            );
            if (saved) setDraft(null);
          }}
          saving={saving}
          error={formError}
          submitLabel="Gerät speichern"
        >
          <label className="area-editor-wide">
            <span>Gerät</span>
            <input
              required
              maxLength={160}
              placeholder="z. B. Pflegebett Zimmer 12"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label>
            <span>Kategorie</span>
            <input
              maxLength={80}
              placeholder="z. B. Pflegebett, Lifter, Waage"
              value={draft.category}
              onChange={(event) => setDraft({ ...draft, category: event.target.value })}
            />
          </label>
          <label>
            <span>Inventarnummer</span>
            <input
              maxLength={60}
              value={draft.inventoryNumber}
              onChange={(event) => setDraft({ ...draft, inventoryNumber: event.target.value })}
            />
          </label>
          <label>
            <span>Hersteller / Modell</span>
            <input
              maxLength={160}
              value={draft.manufacturer}
              onChange={(event) => setDraft({ ...draft, manufacturer: event.target.value })}
            />
          </label>
          <label>
            <span>Standort</span>
            <input
              maxLength={200}
              value={draft.location}
              onChange={(event) => setDraft({ ...draft, location: event.target.value })}
            />
          </label>
          <label>
            <span>Prüffrist (Monate)</span>
            <input
              inputMode="numeric"
              placeholder="laut Einrichtung bzw. Hersteller"
              value={draft.intervalMonths}
              onChange={(event) => setDraft({ ...draft, intervalMonths: event.target.value.replace(/\D/g, "") })}
            />
          </label>
          <label>
            <span>Nächste Prüfung</span>
            <CareDatePicker
              clearable
              label="Nächste Prüfung"
              value={draft.nextDueOn}
              onChange={(value) => setDraft({ ...draft, nextDueOn: value })}
            />
          </label>
          <label className="area-editor-wide">
            <span>Bemerkung</span>
            <textarea
              rows={2}
              maxLength={2000}
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />
          </label>
        </EditorDialog>
      )}

      {check && (
        <EditorDialog
          id="device-check"
          eyebrow={check.device.name}
          title="Prüfung erfassen"
          onClose={() => setCheck(null)}
          onSubmit={async () => {
            if (!check.result) return setFormError("Bitte das Ergebnis wählen.");
            const saved = await run(
              () =>
                requestJson(`/api/devices/${check.device.id}/checks`, {
                  method: "POST",
                  body: { ...check, device: undefined },
                }),
              `${check.device.name}: Prüfung erfasst`,
            );
            if (saved) setCheck(null);
          }}
          saving={saving}
          error={formError}
          submitLabel="Prüfung speichern"
        >
          <label>
            <span>Geprüft am</span>
            <CareDatePicker
              label="Geprüft am"
              value={check.checkedOn}
              max={todayInZurich()}
              onChange={(value) => {
                const checkedOn = value;
                setCheck({
                  ...check,
                  checkedOn,
                  nextDueOn:
                    check.device.intervalMonths && checkedOn
                      ? addMonths(checkedOn, check.device.intervalMonths)
                      : check.nextDueOn,
                });
              }}
            />
          </label>
          <label>
            <span>Geprüft von</span>
            <input
              required
              maxLength={200}
              placeholder="z. B. Haustechnik oder Servicefirma"
              value={check.performedBy}
              onChange={(event) => setCheck({ ...check, performedBy: event.target.value })}
            />
          </label>
          <fieldset className="area-editor-wide">
            <legend>Ergebnis</legend>
            <div className="repositioning-choices" role="group" aria-label="Ergebnis">
              {(Object.keys(DEVICE_CHECK_RESULTS) as DeviceCheckResult[]).map((result) => (
                <button
                  key={result}
                  type="button"
                  className={`day-toggle ${check.result === result ? "active" : ""}`}
                  aria-pressed={check.result === result}
                  onClick={() => setCheck({ ...check, result })}
                >
                  {DEVICE_CHECK_RESULTS[result]}
                </button>
              ))}
            </div>
          </fieldset>
          {check.result === "defect" && (
            <label className="area-editor-wide">
              <span>Mängel</span>
              <textarea
                rows={2}
                required
                maxLength={2000}
                value={check.findings}
                onChange={(event) => setCheck({ ...check, findings: event.target.value })}
              />
            </label>
          )}
          <label>
            <span>Nächste Prüfung</span>
            <CareDatePicker
              clearable
              label="Nächste Prüfung"
              value={check.nextDueOn}
              onChange={(value) => setCheck({ ...check, nextDueOn: value })}
            />
          </label>
        </EditorDialog>
      )}

      {retiring && (
        <EditorDialog
          id="device-retire"
          eyebrow={retiring.name}
          title="Ausser Betrieb nehmen"
          description="Das Gerät bleibt mit seinen Prüfungen im Verzeichnis; es erscheinen keine Erinnerungen mehr."
          onClose={() => setRetiring(null)}
          onSubmit={async () => {
            if (!reason.trim()) return setFormError("Bitte den Grund angeben.");
            const done = await run(
              () => requestJson(`/api/devices/${retiring.id}/retire`, { method: "POST", body: { reason } }),
              `${retiring.name}: ausser Betrieb`,
            );
            if (done) setRetiring(null);
          }}
          saving={saving}
          error={formError}
          submitLabel="Ausser Betrieb nehmen"
          danger
        >
          <label className="area-editor-wide">
            <span>Grund</span>
            <input
              required
              maxLength={500}
              placeholder="z. B. defekt und entsorgt, an den Hersteller zurückgegeben"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        </EditorDialog>
      )}
    </>
  );
}

// Leitung › Qualität & Kennzahlen › Geräte & Prüfungen.
export default function DevicesView() {
  return (
    <ModulePageShell
      activeModule="quality"
      activeChild="Geräte & Prüfungen"
      pageClass="leadership-page devices-page"
      locationSecondary="Gesamtes Haus · alle Wohnbereiche"
    >
      {(showToast) => (
        <main className="workspace leadership-workspace">
          <DevicesContent showToast={showToast} />
        </main>
      )}
    </ModulePageShell>
  );
}
