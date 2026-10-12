"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ModuleIcon, type ModuleIconName } from "@/app/components/module-icon";
import { useCareResident, useCareUnit, useWorkContext, useTerms } from "@/app/components/care-context";
import { countOf } from "@/lib/terminology";
import { requestJson, useApiData } from "@/app/components/workspace-ui";
import { AI_TASKS, type AiDraft, type AiOverview, type AiTask } from "@/lib/ai-shared";

const SUGGESTIONS: AiTask[] = ["handover", "risks", "documentation", "carePlan"];

// CareOS KI assistant: on the page "Assistenz" and in the header panel.
type Exchange = { id: string; task: AiTask; prompt: string; draft?: AiDraft; error?: string };

// variant „panel“: kompakte Darstellung im KI-Panel der Kopfzeile (Kontextleiste, Gespräch, Aufträge über dem
// Eingabefeld, Hinweis am Fuss); „page“: Seite „Assistenz“ mit Kontext- und Hinweiskarten.
export function AssistantView({
  variant = "page",
  onOpenDrafts,
}: {
  variant?: "page" | "panel";
  onOpenDrafts?: () => void;
}) {
  const t = useTerms();
  const router = useRouter();
  const context = useWorkContext();
  const [residentId] = useCareResident();
  const [storedUnitId] = useCareUnit();
  const unitId = storedUnitId ?? context?.profile.primaryCareUnitId ?? null;
  const resident = context?.residents.find((item) => item.id === residentId) ?? null;
  const overview = useApiData<AiOverview>(`/api/ai${unitId ? `?careUnitId=${unitId}` : ""}`);
  const [scope, setScope] = useState<"resident" | "unit">("resident");
  const useResident = scope === "resident" && Boolean(resident);
  const [task, setTask] = useState<AiTask>("handover");
  const [prompt, setPrompt] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [busy, setBusy] = useState(false);
  const configured = overview.data?.configured ?? true;
  const firstName = context?.profile.displayName.split(" ")[0] ?? "";
  const info = overview.data?.context;

  const send = async () => {
    const chosen = task;
    const exchange: Exchange = { id: String(Date.now()), task: chosen, prompt: prompt.trim() };
    setExchanges((current) => [...current, exchange]);
    setPrompt("");
    setBusy(true);
    try {
      const { draft } = await requestJson<{ draft: AiDraft }>("/api/ai/drafts", {
        method: "POST",
        body: {
          task: chosen,
          prompt: exchange.prompt,
          residentId: useResident ? resident?.id : null,
          careUnitId: useResident ? null : unitId,
        },
      });
      setExchanges((current) => current.map((item) => (item.id === exchange.id ? { ...item, draft } : item)));
      overview.reload();
    } catch (reason) {
      setExchanges((current) =>
        current.map((item) => (item.id === exchange.id ? { ...item, error: (reason as Error).message } : item)),
      );
    } finally {
      setBusy(false);
    }
  };
  // Pflegeplanung nur für eine Person (die aus der Kopfzeile).
  const canSend =
    !busy && configured && (task !== "question" || prompt.trim().length >= 3) && (task !== "carePlan" || useResident);

  const statusBadge = (
    <span className="intelligence-status" style={configured ? undefined : { color: "var(--attention)" }}>
      <i style={configured ? undefined : { background: "var(--attention)" }} />
      {!configured ? "Nicht eingerichtet" : busy ? "Schreibt …" : "Bereit"}
    </span>
  );
  const suggestionButtons = (
    <div className="intelligence-suggestions">
      {SUGGESTIONS.map((item) => (
        <button
          className={task === item ? "active" : ""}
          type="button"
          key={item}
          aria-pressed={task === item}
          onClick={() => setTask(item)}
        >
          <ModuleIcon name={AI_TASKS[item].icon as ModuleIconName} />
          {AI_TASKS[item].label}
        </button>
      ))}
      <button
        className={task === "question" ? "active" : ""}
        type="button"
        aria-pressed={task === "question"}
        onClick={() => setTask("question")}
      >
        <ModuleIcon name="ai" />
        Freie Frage
      </button>
    </div>
  );
  const conversationView = (
    <div className="intelligence-conversation" aria-live="polite">
      <div className="intelligence-message assistant">
        <span className="intelligence-avatar">
          <ModuleIcon name="ai" />
        </span>
        <p>
          {configured
            ? `Hallo${firstName ? ` ${firstName}` : ""}! Ich kann Übergaben strukturieren, Risiken hervorheben und Dokumentationsentwürfe vorbereiten – auf Basis der Daten in CareOS. Die finale Freigabe bleibt immer bei dir.`
            : "CareOS KI ist noch nicht eingerichtet. Die Administration muss dafür einen API-Schlüssel (MISTRAL_API_KEY) hinterlegen."}
        </p>
      </div>
      {exchanges.map((item) => (
        <div key={item.id} style={{ display: "contents" }}>
          <div className="intelligence-message user">
            <p>
              {item.task === "question"
                ? item.prompt
                : `${AI_TASKS[item.task].label}${item.prompt ? ` · ${item.prompt}` : ""}`}
            </p>
          </div>
          <div className="intelligence-message assistant">
            <span className="intelligence-avatar">
              <ModuleIcon name="ai" />
            </span>
            <p style={{ whiteSpace: "pre-wrap" }}>
              {item.draft ? item.draft.content : item.error ? item.error : "Einen Moment, ich werte die Daten aus …"}
              {item.draft && (
                <>
                  {"\n\n"}
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => router.push(`/c/intelligenz/entwuerfe?draft=${item.draft?.id}`)}
                  >
                    Als Entwurf prüfen <ModuleIcon name="chevron" />
                  </button>
                </>
              )}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
  const composerForm = (
    <form
      className="intelligence-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) void send();
      }}
    >
      <input
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder={
          task === "question"
            ? "Frage oder Auftrag eingeben…"
            : task === "documentation"
              ? "Stichworte zum Dienst (optional)…"
              : task === "carePlan"
                ? useResident
                  ? "Schwerpunkt (optional), z. B. Mobilität oder Ernährung…"
                  : `Für die Pflegeplanung zuerst ${t.oneOblique} in der Kopfzeile wählen`
                : "Zusätzliche Hinweise (optional)…"
        }
        aria-label="Auftrag an CareOS KI"
        maxLength={2000}
      />
      <button className="primary-button" type="submit" disabled={!canSend}>
        <ModuleIcon name="ai" />
        {busy ? "Arbeitet…" : "Senden"}
      </button>
    </form>
  );

  if (variant === "panel")
    return (
      <div className="ai-assist">
        <div className="ai-assist-context">
          <div>
            <span>Bezieht sich auf</span>
            <strong>
              {useResident
                ? [resident?.name, resident?.room].filter(Boolean).join(" · ")
                : (info?.careUnit ?? "alle Wohnbereiche")}
            </strong>
          </div>
          {statusBadge}
          {resident && (
            <div className="ai-assist-scope" role="group" aria-label="Bezug">
              <button type="button" aria-pressed={useResident} onClick={() => setScope("resident")}>
                Nur {resident.name.split(" ")[0]}
              </button>
              <button type="button" aria-pressed={!useResident} onClick={() => setScope("unit")}>
                Ganzer Wohnbereich
              </button>
            </div>
          )}
        </div>
        {conversationView}
        <div className="ai-assist-compose">
          {suggestionButtons}
          {composerForm}
        </div>
        <footer className="ai-assist-foot">
          <p>
            <ModuleIcon name="quality" />
            Entwürfe aus den Daten in CareOS – gespeichert wird erst nach deiner Prüfung.
          </p>
          {onOpenDrafts && (
            <button className="quiet-button" type="button" onClick={onOpenDrafts}>
              KI-Entwürfe prüfen{overview.data?.pending ? ` (${overview.data.pending})` : ""}
              <ModuleIcon name="chevron" />
            </button>
          )}
        </footer>
      </div>
    );

  return (
    <div className="intelligence-layout">
      <section className="card intelligence-chat">
        <div className="card-header">
          <div>
            <p className="eyebrow">Assistenz</p>
            <h2 className="card-title">Womit kann ich helfen?</h2>
            <p className="card-subtitle">
              {useResident
                ? `Bezieht sich auf ${resident?.name} (${t.one} in der Kopfzeile).`
                : `Bezieht sich auf ${info?.careUnit ?? "alle Wohnbereiche"}.`}
            </p>
          </div>
          {statusBadge}
        </div>
        {suggestionButtons}
        {conversationView}
        {composerForm}
      </section>
      <aside className="intelligence-side">
        <section className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Kontext</p>
              <h2 className="card-title">Aktuelle Auswahl</h2>
            </div>
          </div>
          <div className="intelligence-context">
            <strong>{useResident ? resident?.name : (info?.careUnit ?? "Alle Wohnbereiche")}</strong>
            {useResident ? (
              <span>
                {resident?.room} · {resident?.group}
              </span>
            ) : (
              <span>{info ? countOf(info.residents, t) : "Wird geladen …"}</span>
            )}
            <span>{info ? `${info.openTasks} offene Aufgaben` : ""}</span>
            <span>
              {info ? `${info.criticalVitals} kritische Vitalwerte · ${info.unreadHandovers} ungelesene Übergaben` : ""}
            </span>
            {resident && (
              <button
                className="quiet-button"
                type="button"
                onClick={() => setScope((current) => (current === "resident" ? "unit" : "resident"))}
              >
                {useResident ? "Ganzen Wohnbereich verwenden" : `Nur ${resident.name} verwenden`}
              </button>
            )}
          </div>
        </section>
        <section className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Hinweis</p>
              <h2 className="card-title">Sicher arbeiten</h2>
            </div>
          </div>
          <p className="intelligence-note">
            KI-Vorschläge sind Entwürfe und werden erst nach deiner Prüfung in CareOS gespeichert. Bewohnende werden nur
            mit Kürzel, Alter und Zimmer übermittelt.
            {overview.data?.pending ? ` ${overview.data.pending} Entwürfe warten auf Prüfung.` : ""}
          </p>
        </section>
      </aside>
    </div>
  );
}
