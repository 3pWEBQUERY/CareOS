"use client";

import { useState } from "react";
import ModulePageShell from "@/app/components/module-page-shell";
import { AssistantView } from "./assistant-view";
import { ModuleIcon } from "@/app/components/module-icon";
import { EditorDialog, formatDateTime, requestJson, useApiData } from "@/app/components/workspace-ui";
import { AI_TASKS, type AiDraft } from "@/lib/ai-shared";

type IntelligenceView = "assistant" | "drafts";

const viewMeta: Record<IntelligenceView, { child: string; title: string; description: string }> = {
  assistant: {
    child: "Assistenz",
    title: "CareOS Assistenz",
    description: "Kontextbezogene Unterstützung für deine nächste Pflegeentscheidung.",
  },
  drafts: {
    child: "KI-Entwürfe",
    title: "KI-Entwürfe",
    description: "Vorschläge prüfen, anpassen und sicher in deine Dokumentation übernehmen.",
  },
};

export default function IntelligenceWorkspace({ view }: { view: IntelligenceView }) {
  const meta = viewMeta[view];
  return (
    <ModulePageShell
      activeModule="ai"
      activeChild={meta.child}
      pageClass={`intelligence-page intelligence-${view}`}
      locationSecondary="Gesamtes Haus · alle Wohnbereiche"
    >
      {(showToast) => (
        <main className="workspace intelligence-workspace">
          <section className="intelligence-heading page-heading">
            <div className="heading-copy">
              <p className="eyebrow">CareOS KI</p>
              <h1>{meta.title}</h1>
              <p>{meta.description}</p>
            </div>
            <span
              className="intelligence-trust"
              title="Bewohnende werden nur mit Kürzel, Alter und Zimmer übermittelt."
            >
              <ModuleIcon name="check" /> Pseudonymisiert · Freigabe durch dich
            </span>
          </section>
          {view === "assistant" ? <AssistantView /> : <DraftsView showToast={showToast} />}
        </main>
      )}
    </ModulePageShell>
  );
}

const SAVE_LABEL = (draft: AiDraft) =>
  draft.task === "documentation" && draft.residentId
    ? "In Pflegebericht übernehmen"
    : draft.task === "handover"
      ? "Als Übergabe speichern"
      : "Als geprüft übernehmen";

function DraftsView({ showToast }: { showToast: (message: string) => void }) {
  const drafts = useApiData<{ drafts: AiDraft[] }>("/api/ai/drafts");
  const [openId, setOpenId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("draft"),
  );
  const list = drafts.data?.drafts ?? [];
  const pending = list.filter((draft) => draft.status === "draft" || draft.status === "reviewed");
  const open = list.find((draft) => draft.id === openId) ?? null;

  return (
    <div className="intelligence-layout">
      <section className="card intelligence-drafts">
        <div className="operations-toolbar">
          <div>
            <p className="eyebrow">Prüfwarteschlange</p>
            <h2 className="card-title">Entwürfe zur Freigabe</h2>
            <p className="card-subtitle">
              {drafts.loading && !drafts.data
                ? "Wird geladen …"
                : drafts.error
                  ? drafts.error
                  : `${pending.length} Vorschl${pending.length === 1 ? "ag wartet" : "äge warten"} auf deine Entscheidung`}
            </p>
          </div>
          <button className="secondary-button" type="button" onClick={drafts.reload}>
            Aktualisieren
          </button>
        </div>
        <div className="intelligence-draft-list">
          {list.map((draft) => {
            const done = draft.status === "accepted" || draft.status === "discarded";
            return (
              <article key={draft.id}>
                <span className={`governance-icon ${done ? (draft.status === "accepted" ? "stable" : "") : ""}`}>
                  <ModuleIcon name={done ? (draft.status === "accepted" ? "check" : "close") : "sparkle"} />
                </span>
                <span>
                  <strong>
                    {AI_TASKS[draft.task].label} · {draft.residentName ?? "Wohnbereich"}
                  </strong>
                  <small>{draft.content.slice(0, 110).replace(/\s+/g, " ")}…</small>
                  <em>
                    {formatDateTime(draft.createdAt)} · {draft.requestedBy ?? "CareOS KI"}
                    {draft.status === "accepted"
                      ? ` · übernommen von ${draft.reviewedBy}`
                      : draft.status === "discarded"
                        ? ` · verworfen von ${draft.reviewedBy}`
                        : draft.status === "reviewed"
                          ? " · bearbeitet"
                          : ""}
                  </em>
                </span>
                <button className="quiet-button" type="button" onClick={() => setOpenId(draft.id)}>
                  {done ? "Ansehen" : "Prüfen"}
                </button>
              </article>
            );
          })}
          {drafts.data && !list.length && (
            <article>
              <span className="governance-icon">
                <ModuleIcon name="sparkle" />
              </span>
              <span>
                <strong>Noch keine Entwürfe</strong>
                <small>Entwürfe entstehen in der Assistenz und warten hier auf deine Prüfung.</small>
              </span>
            </article>
          )}
        </div>
      </section>
      <aside className="intelligence-side">
        <section className="card intelligence-review">
          <div className="card-header">
            <div>
              <p className="eyebrow">Freigabe</p>
              <h2 className="card-title">Prüfregeln</h2>
            </div>
          </div>
          <ul>
            <li>
              <ModuleIcon name="check" />
              Keine automatische Veröffentlichung
            </li>
            <li>
              <ModuleIcon name="check" />
              Änderungen bleiben nachvollziehbar
            </li>
            <li>
              <ModuleIcon name="check" />
              Fachliche Verantwortung bleibt beim Team
            </li>
          </ul>
        </section>
      </aside>
      {open && (
        <DraftReview
          key={open.id}
          draft={open}
          onClose={() => setOpenId(null)}
          onDone={(message) => {
            drafts.reload();
            setOpenId(null);
            showToast(message);
          }}
        />
      )}
    </div>
  );
}

function DraftReview({
  draft,
  onClose,
  onDone,
}: {
  draft: AiDraft;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [content, setContent] = useState(draft.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const done = draft.status === "accepted" || draft.status === "discarded";
  const act = async (action: "accept" | "discard" | "save") => {
    setSaving(true);
    setError("");
    try {
      await requestJson(`/api/ai/drafts/${draft.id}`, { method: "PATCH", body: { action, content } });
      onDone(
        action === "discard"
          ? "Entwurf verworfen"
          : action === "save"
            ? "Änderungen gespeichert"
            : draft.task === "documentation" && draft.residentId
              ? "In den Pflegebericht übernommen"
              : draft.task === "handover"
                ? "Als Übergabe gespeichert"
                : "Entwurf übernommen",
      );
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <EditorDialog
      id="ai-draft"
      eyebrow="CareOS KI · Entwurf prüfen"
      title={`${AI_TASKS[draft.task].label} · ${draft.residentName ?? "Wohnbereich"}`}
      description={`Erstellt ${formatDateTime(draft.createdAt)}${draft.prompt ? ` · Hinweis: ${draft.prompt}` : ""}`}
      submitLabel={done ? "Schliessen" : SAVE_LABEL(draft)}
      saving={saving}
      error={error}
      onClose={onClose}
      onSubmit={() => (done ? onClose() : act("accept"))}
      extraActions={
        done ? undefined : (
          <>
            <button className="secondary-button" type="button" disabled={saving} onClick={() => void act("discard")}>
              Verwerfen
            </button>
            <button className="secondary-button" type="button" disabled={saving} onClick={() => void act("save")}>
              Änderungen speichern
            </button>
          </>
        )
      }
    >
      <label className="area-editor-wide">
        Text {done ? "" : "(vor dem Übernehmen prüfen und anpassen)"}
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={18}
          maxLength={10000}
          readOnly={done}
        />
      </label>
    </EditorDialog>
  );
}
