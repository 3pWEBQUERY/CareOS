"use client";

import { useState } from "react";
import { ModuleIcon } from "./module-icon";
import { useWorkContext } from "./care-context";
import { requestJson } from "./workspace-ui";
import type { AiDraft } from "@/lib/ai-shared";

// Diktierten oder getippten Rohtext mit CareOS KI als Pflegebericht umformulieren. Namen gehen nur als Platzhalter
// an die KI; der Vorschlag ersetzt den Text erst, wenn die Fachperson ihn übernimmt.
export function AiRephrase({
  text,
  residentId,
  onAccept,
}: {
  text: string;
  residentId: string | null;
  onAccept: (text: string) => void;
}) {
  const ready = useWorkContext()?.profile.aiReady ?? false;
  const [suggestion, setSuggestion] = useState<AiDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!ready) return null;

  async function rephrase() {
    setBusy(true);
    setError("");
    try {
      const result = await requestJson<{ draft: AiDraft }>("/api/ai/rephrase", {
        method: "POST",
        body: { text, residentId: residentId || null },
      });
      setSuggestion(result.draft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Der Text konnte nicht umformuliert werden.");
    } finally {
      setBusy(false);
    }
  }

  async function review(action: "accept" | "discard") {
    if (!suggestion) return;
    setSuggestion(null);
    if (action === "accept") onAccept(suggestion.content);
    try {
      await requestJson(`/api/ai/drafts/${suggestion.id}`, { method: "PATCH", body: { action } });
    } catch {
      // Der Vermerk am Entwurf ist zweitrangig; der Text im Eintrag ist bereits übernommen bzw. unverändert.
    }
  }

  return (
    <div className="ai-rephrase">
      <span className="ai-rephrase-bar">
        <button
          className="quiet-button"
          type="button"
          disabled={busy || text.trim().length < 10}
          onClick={() => void rephrase()}
        >
          <ModuleIcon name="ai" /> {busy ? "Wird umformuliert …" : "Mit CareOS KI umformulieren"}
        </button>
        <small>{error || "Namen werden vor dem Senden durch Platzhalter ersetzt."}</small>
      </span>
      {suggestion && (
        <div className="ai-suggestion" role="region" aria-label="Vorschlag der CareOS KI">
          <p className="ai-suggestion-head">
            <ModuleIcon name="ai" /> Vorschlag der CareOS KI – bitte prüfen
          </p>
          <p className="ai-suggestion-text">{suggestion.content}</p>
          <div className="ai-suggestion-actions">
            <button className="secondary-button" type="button" onClick={() => void review("discard")}>
              Verwerfen
            </button>
            <button className="primary-button" type="button" onClick={() => void review("accept")}>
              Text übernehmen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
