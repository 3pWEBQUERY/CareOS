"use client";

import { useMemo, useState } from "react";
import { ModuleIcon, type ModuleIconName } from "@/app/components/module-icon";
import { LoadError, formatDate, requestJson, useApiData, type ShowToast } from "@/app/components/workspace-ui";
import {
  ACTION_STATUS,
  EFFECTIVENESS,
  type ActionStatus,
  type QualityAction,
  type QualityActionsPayload,
} from "@/lib/quality-shared";
import { LeadershipHeading, LeadershipKpis, initialsOf } from "../../components/leadership-page-parts";
import { ActionDialog, CompleteActionDialog } from "./quality-dialogs";

const columns: Array<{ status: ActionStatus; icon: ModuleIconName }> = [
  { status: "open", icon: "alert" },
  { status: "planned", icon: "calendar" },
  { status: "done", icon: "check" },
];

type Dialog =
  { kind: "edit"; action: QualityAction | null } | { kind: "complete"; action: QualityAction; cancel?: boolean } | null;

export default function ActionsView({ showToast }: { showToast: ShowToast }) {
  const data = useApiData<QualityActionsPayload>("/api/quality/actions");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const actions = useMemo(() => data.data?.actions ?? [], [data.data]);
  const selected = actions.find((action) => action.id === selectedId) ?? actions[0] ?? null;
  const stats = data.data?.stats;
  const done = (message: string) => {
    setDialog(null);
    showToast(message);
    data.reload();
  };
  const setStatus = async (action: QualityAction, status: ActionStatus) => {
    setBusy(true);
    try {
      await requestJson(`/api/quality/actions/${action.id}`, { method: "PATCH", body: { status } });
      done(`${action.title}: ${ACTION_STATUS[status].label}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Status konnte nicht geändert werden.");
    } finally {
      setBusy(false);
    }
  };
  const lists = data.data;

  return (
    <>
      <LeadershipHeading
        eyebrow="Qualität"
        title="Massnahmen"
        description="Verbesserungen priorisieren, Verantwortlichkeiten klären und Wirkung messen."
        action={
          lists?.canManage
            ? { label: "Massnahme planen", onClick: () => setDialog({ kind: "edit", action: null }) }
            : undefined
        }
      />
      <LeadershipKpis
        kpis={[
          {
            value: String(stats?.active ?? "–"),
            label: "Massnahmen aktiv",
            note: stats?.overdue ? `${stats.overdue} überfällig` : "keine überfällig",
            tone: stats?.overdue ? "attention" : "stable",
          },
          {
            value: stats?.effectiveShare === null || !stats ? "–" : `${stats.effectiveShare} %`,
            label: "wirksam",
            note: "aus abgeschlossenen Massnahmen",
            tone: "stable",
          },
          {
            value: String(stats?.owners ?? "–"),
            label: "Verantwortliche",
            note: "mit aktiven Massnahmen",
            tone: "info",
          },
          {
            value: String(stats?.doneThisYear ?? "–"),
            label: "abgeschlossen",
            note: "dieses Jahr",
            tone: "stable",
          },
        ]}
      />
      {data.error && <LoadError message={data.error} onRetry={data.reload} />}
      <div className="quality-actions-layout">
        <section className="card quality-kanban">
          <div className="card-header">
            <div>
              <p className="eyebrow">Verbesserungsboard</p>
              <h2 className="card-title">Massnahmen steuern</h2>
              <p className="card-subtitle">Prioritäten und Zuständigkeiten im Überblick</p>
            </div>
            {lists?.canManage && (
              <button
                className="secondary-button"
                type="button"
                onClick={() => setDialog({ kind: "edit", action: null })}
              >
                <ModuleIcon name="plus" /> Neue Massnahme
              </button>
            )}
          </div>
          <div className="quality-kanban-grid">
            {columns.map((column) => {
              const items = actions.filter((action) => action.status === column.status);
              return (
                <div className="quality-kanban-column" key={column.status}>
                  <div>
                    <strong>{ACTION_STATUS[column.status].label}</strong>
                    <span className={`status-badge ${ACTION_STATUS[column.status].tone}`}>{items.length}</span>
                  </div>
                  {items.map((action) => (
                    <button
                      className={selected?.id === action.id ? "selected" : ""}
                      type="button"
                      key={action.id}
                      onClick={() => setSelectedId(action.id)}
                    >
                      <span
                        className={`governance-icon ${action.overdue ? "critical" : ACTION_STATUS[action.status].tone}`}
                      >
                        <ModuleIcon name={column.icon} />
                      </span>
                      <span>
                        <strong>{action.title}</strong>
                        <small>{action.ownerName ?? "Ohne Verantwortung"}</small>
                        <em>
                          {action.status === "done"
                            ? `Erledigt ${formatDate(action.completedAt)}`
                            : action.overdue
                              ? `Überfällig seit ${formatDate(action.dueOn)}`
                              : `Fällig ${formatDate(action.dueOn)}`}
                        </em>
                      </span>
                    </button>
                  ))}
                  {!items.length && <p className="list-hint">Keine Einträge</p>}
                </div>
              );
            })}
          </div>
        </section>
        <aside className="card quality-action-detail">
          {selected ? (
            <>
              <div className="card-header">
                <div>
                  <p className="eyebrow">Massnahmendetail</p>
                  <h2 className="card-title">{selected.title}</h2>
                </div>
                <span className={`status-badge ${selected.overdue ? "critical" : ACTION_STATUS[selected.status].tone}`}>
                  {selected.overdue ? "Überfällig" : ACTION_STATUS[selected.status].label}
                </span>
              </div>
              <div className="quality-action-owner">
                <span className="avatar">{selected.ownerName ? initialsOf(selected.ownerName) : "–"}</span>
                <span>
                  <strong>{selected.ownerName ?? "Noch nicht festgelegt"}</strong>
                  <small>Verantwortlich</small>
                </span>
              </div>
              <p>{selected.description ?? "Keine Beschreibung erfasst."}</p>
              <dl>
                <div>
                  <dt>Termin</dt>
                  <dd>{formatDate(selected.dueOn)}</dd>
                </div>
                <div>
                  <dt>Ereignis</dt>
                  <dd>{selected.eventTitle ?? "–"}</dd>
                </div>
                <div>
                  <dt>Bereich</dt>
                  <dd>{selected.careUnit ?? "Gesamtes Haus"}</dd>
                </div>
                {selected.status === "done" && (
                  <div>
                    <dt>Wirksamkeit</dt>
                    <dd>{selected.effectiveness ? EFFECTIVENESS[selected.effectiveness] : "–"}</dd>
                  </div>
                )}
                {selected.completionNote && (
                  <div>
                    <dt>{selected.status === "cancelled" ? "Grund" : "Nachweis"}</dt>
                    <dd>{selected.completionNote}</dd>
                  </div>
                )}
              </dl>
              {lists?.canManage && (
                <div className="quality-detail-actions">
                  {(selected.status === "open" || selected.status === "planned") && (
                    <>
                      <button
                        className="primary-button"
                        type="button"
                        onClick={() => setDialog({ kind: "complete", action: selected })}
                      >
                        Als erledigt markieren
                      </button>
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={busy}
                        onClick={() => void setStatus(selected, selected.status === "open" ? "planned" : "open")}
                      >
                        {selected.status === "open" ? "Als geplant markieren" : "Zurück auf offen"}
                      </button>
                      <button
                        className="quiet-button"
                        type="button"
                        onClick={() => setDialog({ kind: "edit", action: selected })}
                      >
                        Bearbeiten
                      </button>
                      <button
                        className="quiet-button"
                        type="button"
                        onClick={() => setDialog({ kind: "complete", action: selected, cancel: true })}
                      >
                        Verwerfen
                      </button>
                    </>
                  )}
                  {(selected.status === "done" || selected.status === "cancelled") && (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={busy}
                      onClick={() => void setStatus(selected, "open")}
                    >
                      Wieder öffnen
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="resident-empty">
              <ModuleIcon name="quality" />
              <strong>{data.loading ? "Massnahmen werden geladen …" : "Noch keine Massnahmen"}</strong>
              <p>Massnahmen entstehen aus Ereignissen oder werden direkt geplant.</p>
            </div>
          )}
        </aside>
      </div>
      {dialog?.kind === "edit" && lists && (
        <ActionDialog
          action={dialog.action}
          events={lists.events}
          careUnits={lists.careUnits}
          staff={lists.staff}
          onClose={() => setDialog(null)}
          onSaved={done}
        />
      )}
      {dialog?.kind === "complete" && (
        <CompleteActionDialog
          action={dialog.action}
          cancel={dialog.cancel}
          onClose={() => setDialog(null)}
          onSaved={done}
        />
      )}
    </>
  );
}
