"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ModuleIcon } from "@/app/components/module-icon";
import { requestJson } from "@/app/components/workspace-ui";
import type { SetupChecklist } from "@/lib/setup-checklist";
import { onAdminChanged } from "./admin-board";

// Schritt auf derselben Seite (z. B. Standort, Wohnbereiche): öffnet dort den passenden Dialog.
export const SETUP_STEP_EVENT = "carecore:setup-step";
export function onSetupStep(listener: (anchor: string) => void) {
  const handle = (event: Event) => listener((event as CustomEvent<string>).detail);
  window.addEventListener(SETUP_STEP_EVENT, handle);
  return () => window.removeEventListener(SETUP_STEP_EVENT, handle);
}

// Ersteinrichtung: offene Schritte einer neuen Installation. Erscheint nur, solange etwas offen ist und die
// Liste nicht ausgeblendet wurde.
export function SetupChecklistCard({ showToast }: { showToast: (message: string) => void }) {
  const [checklist, setChecklist] = useState<SetupChecklist | null>(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(
    () =>
      requestJson<SetupChecklist>("/api/admin/setup")
        .then(setChecklist)
        .catch(() => undefined),
    [],
  );
  // Neu prüfen beim Öffnen, nach jeder Änderung der Administration (Standort, Wohnbereich, Land …) und wenn das
  // Fenster wieder in den Vordergrund kommt (z. B. nach dem Einrichten der Zwei-Faktor-Anmeldung in einem anderen Tab).
  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const stop = onAdminChanged(() => void load());
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(initial);
      stop();
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);
  if (!checklist || checklist.dismissed) return null;
  const open = checklist.steps.filter((step) => !step.done).length;
  if (!open) return null;
  const done = checklist.steps.length - open;

  const dismiss = () => {
    setSaving(true);
    requestJson<SetupChecklist>("/api/admin/setup", { method: "PATCH", body: { dismissed: true } })
      .then((result) => {
        setChecklist(result);
        showToast("Ersteinrichtung ausgeblendet");
      })
      .catch((reason: Error) => showToast(reason.message))
      .finally(() => setSaving(false));
  };

  return (
    <section className="card setup-checklist" aria-labelledby="setup-checklist-title">
      <div className="card-header">
        <div>
          <p className="eyebrow">Ersteinrichtung</p>
          <h2 className="card-title" id="setup-checklist-title">
            CareOS einrichten
          </h2>
          <p className="card-subtitle">
            {done} von {checklist.steps.length} Schritten erledigt
          </p>
        </div>
        <button className="quiet-button" type="button" disabled={saving} onClick={dismiss}>
          Ausblenden
        </button>
      </div>
      <ol className="setup-checklist-steps">
        {checklist.steps.map((step) => (
          <li key={step.id} className={step.done ? "done" : ""}>
            <span className="setup-checklist-mark" aria-hidden="true">
              {step.done ? <ModuleIcon name="check" /> : null}
            </span>
            <span className="setup-checklist-copy">
              <strong>
                {step.label}
                <span className="setup-checklist-state">{step.done ? " – erledigt" : " – offen"}</span>
              </strong>
              <small>{step.detail}</small>
            </span>
            {!step.done && step.href && <StepLink href={step.href} />}
          </li>
        ))}
      </ol>
    </section>
  );
}

// „Öffnen“: Auf dieser Seite öffnet der Anker den Dialog direkt; sonst zur Seite (die zum Anker springt).
function StepLink({ href }: { href: string }) {
  const [path, anchor = ""] = href.split("#");
  const samePage = typeof window !== "undefined" && window.location.pathname === path;
  if (samePage && anchor)
    return (
      <button
        className="secondary-button"
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent(SETUP_STEP_EVENT, { detail: anchor }))}
      >
        Öffnen
      </button>
    );
  return (
    <Link className="secondary-button" href={href}>
      Öffnen
    </Link>
  );
}
