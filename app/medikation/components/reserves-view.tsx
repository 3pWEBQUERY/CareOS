"use client";

import { useState } from "react";
import { InteractionNotice } from "./interaction-notice";
import { useWorkContext, useTerms } from "@/app/components/care-context";
import type { Terms } from "@/lib/terminology";
import { ModuleIcon } from "@/app/components/module-icon";
import { EFFECT_RESULTS, type EffectCheck, type EffectResult, type MedOrder } from "@/lib/medication-shared";
import {
  EmptyState,
  LoadError,
  EditorDialog,
  PageHeading,
  SummaryTiles,
  formatDate,
  formatDateTime,
  formatNumber,
  requestJson,
  timeInZurich,
  type ShowToast,
} from "@/app/components/workspace-ui";
import { useOrderDialogs } from "./order-dialogs";
import { orderTone, useSelectedResident } from "./plan-view";
import { AllergyBadge } from "@/app/components/allergy-badge";
import HeaderResidentHint from "@/app/components/header-resident-hint";
import { WitnessFields, emptyWitness } from "./btm-witness";
import { ReceiptDialog } from "./stock-dialogs";
import { MovementJournal } from "./stock-view";
import { ResuscitationBadge } from "@/app/components/resuscitation-badge";

function nextAllowedAt(order: MedOrder) {
  if (!order.lastAdministeredAt || !order.minIntervalHours) return null;
  const next = Date.parse(order.lastAdministeredAt) + order.minIntervalHours * 3_600_000;
  return next > Date.now() ? new Date(next) : null;
}

function availableStock(order: MedOrder, t: Terms) {
  if (order.residentStock !== null) return { amount: order.residentStock, source: `${t.prefix}bestand` };
  if (order.wardStock !== null) return { amount: order.wardStock, source: "Stationsbestand" };
  return null;
}

export default function ReservesView({ showToast }: { showToast: ShowToast }) {
  const t = useTerms();
  const { residents, resident, missing, detail, reloadAll } = useSelectedResident();
  const canManage = residents.data?.canManage ?? false;
  const canAdminister = residents.data?.canAdminister ?? false;
  const { openCreate, openEdit, dialogs } = useOrderDialogs({ resident, showToast, onChanged: reloadAll });
  const [administer, setAdminister] = useState<MedOrder | null>(null);
  const [receipt, setReceipt] = useState<MedOrder | null>(null);
  const [checking, setChecking] = useState<EffectCheck | null>(null);
  const reserves = (detail.data?.orders ?? []).filter((order) => order.isPrn);
  const effectChecks = detail.data?.effectChecks ?? [];
  const done = (message: string) => {
    setAdminister(null);
    setReceipt(null);
    setChecking(null);
    showToast(message);
    reloadAll();
  };

  return (
    <>
      <PageHeading
        eyebrow="Medikamente"
        title="Reserven"
        description="Ärztlich verordnete Bedarfsmedikation mit geprüfter Maximaldosis und Mindestabstand."
        action={
          canManage ? { label: "Reserve verordnen", onClick: () => openCreate(true), disabled: !resident } : undefined
        }
      />
      <SummaryTiles
        label="Reservenübersicht"
        tiles={[
          { icon: "med", value: reserves.length, caption: "aktive Reserveverordnungen" },
          {
            icon: "alert",
            value: reserves.filter((o) => (availableStock(o, t)?.amount ?? 0) <= 3).length,
            caption: "Bestand knapp",
            tone: "attention",
          },
          {
            icon: "check",
            value: reserves.reduce((sum, o) => sum + o.administeredLast24h, 0),
            caption: "Gaben in 24 h",
            tone: "info",
          },
          {
            icon: "residents",
            value: resident ? resident.name : "–",
            caption: resident
              ? [resident.room, resident.careUnit].filter(Boolean).join(" · ")
              : `${t.oneOblique} wählen`,
          },
        ]}
      />
      <section className="critical-alert med-reserve-alert">
        <span className="critical-symbol">
          <ModuleIcon name="alert" />
        </span>
        <div>
          <strong>Sicherheitsprüfung bei jeder Gabe</strong>
          <p>
            CareOS lässt eine Reservegabe nur mit gültiger Verordnung, eingehaltenem Mindestabstand, nicht erreichter
            Maximaldosis und vorhandenem Bestand zu.
          </p>
        </div>
      </section>
      {residents.error && <LoadError message={residents.error} onRetry={residents.reload} />}
      <div className="medication-two-column header-resident-layout">
        <section className="med-main-column">
          {resident && (
            <>
              <section className="card med-profile-head">
                <div className="care-profile-identity">
                  <span className="resident-avatar">{resident.initials}</span>
                  <div>
                    <p className="eyebrow">Bedarfsmedikation</p>
                    <h2>
                      {resident.name} <ResuscitationBadge residentId={resident.id} />
                    </h2>
                    <span>{[resident.room, resident.careUnit].filter(Boolean).join(" · ")}</span>
                  </div>
                </div>
                <AllergyBadge allergies={resident.allergies} />
              </section>
              {detail.error && <LoadError message={detail.error} onRetry={detail.reload} />}
              <InteractionNotice findings={detail.data?.interactions} />
              {effectChecks.length > 0 && (
                <section className="card med-reserve-card med-effect-card" aria-labelledby="med-effect-title">
                  <div className="card-header">
                    <div>
                      <p className="eyebrow">Nach Reservegabe</p>
                      <h2 className="card-title" id="med-effect-title">
                        Wirkungskontrolle
                      </h2>
                      <p className="card-subtitle">Zeitpunkt gemäss Verordnung; das Ergebnis wird dokumentiert.</p>
                    </div>
                  </div>
                  <div className="med-reserve-list">
                    {effectChecks.map((check) => (
                      <article key={check.administrationId}>
                        <div className="med-reserve-title">
                          <span className="med-pill-icon">
                            <ModuleIcon name="med" />
                          </span>
                          <span>
                            <strong>{check.medication}</strong>
                            <small>
                              Gabe {formatDateTime(check.administeredAt)}
                              {check.administeredBy ? ` · ${check.administeredBy}` : ""}
                              {check.reason ? ` · ${check.reason}` : ""}
                            </small>
                          </span>
                          <span className={`status-badge ${check.overdue ? "critical" : "info"}`}>
                            {check.overdue ? "Fällig seit" : "Fällig um"} {timeInZurich(new Date(check.dueAt))} Uhr
                          </span>
                        </div>
                        {canAdminister && (
                          <div className="med-reserve-actions">
                            <button type="button" onClick={() => setChecking(check)}>
                              Wirkung erfassen
                            </button>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                </section>
              )}
              <section className="card med-reserve-card">
                <div className="card-header">
                  <div>
                    <p className="eyebrow">Ärztlich verordnet</p>
                    <h2 className="card-title">Verfügbare Reserven</h2>
                    <p className="card-subtitle">Gaben und Eingänge werden im Bestandsjournal protokolliert.</p>
                  </div>
                </div>
                <div className="med-reserve-list">
                  {reserves.map((order) => {
                    const stock = availableStock(order, t);
                    const next = nextAllowedAt(order);
                    const limitsMissing = !order.maxDosesPer24h || !order.minIntervalHours;
                    const maxReached =
                      order.maxDosesPer24h !== null && order.administeredLast24h >= order.maxDosesPer24h;
                    const status = orderTone(order);
                    const blocked = limitsMissing
                      ? "Grenzwerte fehlen"
                      : order.status === "paused"
                        ? "Pausiert"
                        : maxReached
                          ? "Maximaldosis erreicht"
                          : next
                            ? `Frühestens ${timeInZurich(next)} Uhr`
                            : !stock || stock.amount <= 0
                              ? "Kein Bestand"
                              : null;
                    return (
                      <article key={order.id}>
                        <div className="med-reserve-title">
                          <span className="med-pill-icon">
                            <ModuleIcon name="med" />
                          </span>
                          <span>
                            <strong>
                              {`${order.name} ${order.strength}`.trim()}
                              {order.controlled && <em className="btm-badge">BtM</em>}
                            </strong>
                            <small>{order.indication || "Keine Indikation erfasst"}</small>
                          </span>
                          <span
                            className={`status-badge ${!stock ? "attention" : stock.amount <= 3 ? "critical" : stock.amount <= 8 ? "attention" : "stable"}`}
                          >
                            {stock
                              ? `${formatNumber(stock.amount)} ${order.stockUnit ?? ""} · ${stock.source}`
                              : "Kein Bestand erfasst"}
                          </span>
                        </div>
                        <div className="med-reserve-rules">
                          <span>
                            <small>Einzeldosis</small>
                            <strong>{order.amount}</strong>
                          </span>
                          <span>
                            <small>Maximaldosis</small>
                            <strong>
                              {order.maxDosesPer24h
                                ? `${order.administeredLast24h} von ${order.maxDosesPer24h} Gaben / 24 h`
                                : "nicht strukturiert"}
                            </strong>
                          </span>
                          <span>
                            <small>Mindestabstand</small>
                            <strong>
                              {order.minIntervalHours
                                ? `${formatNumber(order.minIntervalHours)} Stunden`
                                : "nicht strukturiert"}
                            </strong>
                            <em>
                              {order.lastAdministeredAt
                                ? `zuletzt ${formatDateTime(order.lastAdministeredAt)}`
                                : "noch nicht gegeben"}
                            </em>
                          </span>
                          <span>
                            <small>Verordnung</small>
                            <strong>{order.prescribedBy}</strong>
                            <em>{order.endOn ? `bis ${formatDate(order.endOn)}` : status.label}</em>
                          </span>
                        </div>
                        {(order.prnInstructions || limitsMissing) && (
                          <p className="med-reserve-note">
                            {limitsMissing && (
                              <strong>Maximaldosis und Mindestabstand fehlen – Verordnung ergänzen. </strong>
                            )}
                            {order.prnInstructions}
                          </p>
                        )}
                        {(canManage || canAdminister) && (
                          <div className="med-reserve-actions">
                            {canManage && (
                              <button type="button" onClick={() => setReceipt(order)}>
                                <ModuleIcon name="plus" />
                                Eingang eintragen
                              </button>
                            )}
                            {canManage && (
                              <button type="button" onClick={() => openEdit(order)}>
                                Verordnung
                              </button>
                            )}
                            {canAdminister && (
                              <button
                                type="button"
                                disabled={Boolean(blocked)}
                                title={blocked ?? undefined}
                                onClick={() => setAdminister(order)}
                              >
                                <span aria-hidden="true">−</span>
                                {blocked ?? "Gabe dokumentieren"}
                              </button>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                  {!detail.loading && !reserves.length && (
                    <EmptyState
                      title="Keine Reserve verordnet"
                      text="Eine Reserve kann nur mit gültiger ärztlicher Verordnung angelegt werden."
                    />
                  )}
                  {detail.loading && !detail.data && <p className="list-hint">Reserven werden geladen …</p>}
                </div>
              </section>
              <MovementJournal movements={detail.data?.movements ?? []} title={`Bestandsjournal · ${resident.name}`} />
            </>
          )}
          {!resident && <HeaderResidentHint loading={residents.loading} missing={missing} />}
        </section>
      </div>
      {dialogs}
      {administer && resident && (
        <AdministerDialog
          order={administer}
          residentName={resident.name}
          onClose={() => setAdminister(null)}
          onSaved={done}
        />
      )}
      {checking && <EffectCheckDialog check={checking} onClose={() => setChecking(null)} onSaved={done} />}
      {receipt && resident && (
        <ReceiptDialog
          items={[]}
          careUnits={[]}
          residents={[{ id: resident.id, name: resident.name }]}
          preset={{
            residentId: resident.id,
            residentName: resident.name,
            name: receipt.name,
            strength: receipt.strength,
            form: receipt.form,
            unit: receipt.stockUnit ?? "Tabletten",
          }}
          onClose={() => setReceipt(null)}
          onSaved={done}
        />
      )}
    </>
  );
}

function AdministerDialog({
  order,
  residentName,
  onClose,
  onSaved,
}: {
  order: MedOrder;
  residentName: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [note, setNote] = useState("");
  const [quantity, setQuantity] = useState(String(order.stockQuantity ?? 1));
  const [witness, setWitness] = useState(emptyWitness);
  const witnessRequired = (useWorkContext()?.settings.btmAdministrationWitness.enabled ?? false) && order.controlled;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await requestJson("/api/medication/prn", {
        method: "POST",
        body: {
          orderId: order.id,
          note,
          quantity: Number(quantity.replace(",", ".")),
          witness: witnessRequired ? witness : undefined,
        },
      });
      onSaved(`${residentName}: ${order.name} – Reservegabe dokumentiert`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gabe konnte nicht dokumentiert werden.");
      setSaving(false);
    }
  };
  return (
    <EditorDialog
      id="med-prn"
      eyebrow={`Medikamente · ${residentName}`}
      title={`${order.name} ${order.strength}`.trim()}
      description={`Einzeldosis ${order.amount} · max. ${order.maxDosesPer24h} Gaben / 24 h · Mindestabstand ${formatNumber(order.minIntervalHours ?? 0)} h · Indikation: ${order.indication}${order.effectCheckMinutes ? ` · Wirkungskontrolle nach ${order.effectCheckMinutes} Min.` : ""}`}
      onClose={onClose}
      onSubmit={save}
      saving={saving}
      error={error}
      submitLabel="Gabe dokumentieren"
    >
      <label className="area-editor-wide">
        <span>Anlass und Einschätzung</span>
        <textarea
          autoFocus
          required
          rows={3}
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="z. B. Schmerzen Hüfte links, NRS 5 – Wirkung in 60 Min. prüfen"
        />
      </label>
      <label>
        <span>Ausgebuchte Menge ({order.stockUnit ?? "Einheiten"})</span>
        <input required inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </label>
      {witnessRequired && <WitnessFields value={witness} onChange={setWitness} />}
    </EditorDialog>
  );
}

// Ergebnis der Wirkungskontrolle: wirksam, teilweise oder nicht wirksam (dann mit Beschreibung).
function EffectCheckDialog({
  check,
  onClose,
  onSaved,
}: {
  check: EffectCheck;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [result, setResult] = useState<EffectResult>("effective");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await requestJson(`/api/medication/prn/${check.administrationId}/effect`, {
        method: "POST",
        body: { result, note },
      });
      onSaved(`${check.residentName}: Wirkungskontrolle dokumentiert`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wirkungskontrolle konnte nicht gespeichert werden.");
      setSaving(false);
    }
  };
  return (
    <EditorDialog
      id="med-effect"
      eyebrow={`Medikamente · ${check.residentName}`}
      title={`Wirkungskontrolle · ${check.medication}`}
      description={`Gabe ${formatDateTime(check.administeredAt)}${check.reason ? ` · Anlass: ${check.reason}` : ""}`}
      onClose={onClose}
      onSubmit={save}
      saving={saving}
      error={error}
      submitLabel="Wirkung dokumentieren"
    >
      <fieldset className="area-editor-wide">
        <legend>Ergebnis</legend>
        <div className="operations-filter-buttons">
          {(Object.keys(EFFECT_RESULTS) as EffectResult[]).map((key) => (
            <button
              className={result === key ? "active" : ""}
              type="button"
              key={key}
              aria-pressed={result === key}
              onClick={() => setResult(key)}
            >
              {EFFECT_RESULTS[key]}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="area-editor-wide">
        <span>{result === "effective" ? "Beobachtung (optional)" : "Einschätzung und Massnahme"}</span>
        <textarea
          autoFocus
          rows={3}
          maxLength={2000}
          required={result !== "effective"}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="z. B. Schmerzen NRS 2, schläft ruhig – oder: keine Besserung, Hausarzt informiert"
        />
      </label>
    </EditorDialog>
  );
}
