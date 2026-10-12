"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { ModuleIcon, type ModuleIconName } from "./module-icon";
import { useTerms } from "./care-context";
import { shortcutGroups } from "./keyboard-shortcuts";
import type { Terms } from "@/lib/terminology";
import { requestJson, useApiData } from "./workspace-ui";

const HELP_EVENT = "carecore:help";

// Opens "Hilfe & Support" from anywhere (sidebar, mobile menu).
export const openHelp = () => window.dispatchEvent(new Event(HELP_EVENT));

const guides = (t: Terms): Array<{ icon: ModuleIconName; title: string; steps: string[] }> => [
  {
    icon: "apps",
    title: "So funktioniert CareOS",
    steps: [
      "CareOS ist wie ein Tablet: Jeder Bereich ist eine App mit eigener Farbe und eigenem Symbol.",
      "„Start“ führt immer zurück zur Startseite. Dort stehen alle deine Apps.",
      "Die Leiste (am Computer links, auf dem Handy unten) zeigt immer dieselben Apps an derselben Stelle.",
      "„Alle Apps“ zeigt alle Apps mit einem kurzen Satz, wofür sie da sind. Oben kannst du eine App suchen.",
      "In einer App stehen die Seiten oben als Knöpfe nebeneinander. Die gewählte Seite ist farbig.",
      "Eine rote Zahl an einer App heisst: Hier wartet etwas auf dich.",
    ],
  },
  {
    icon: "residents",
    title: `${t.oneOblique} wählen`,
    steps: [
      `Oben in der Kopfzeile auf den ${t.oneOblique} tippen und die Person wählen.`,
      "Alle Seiten wie Medikation, Vitalwerte oder Dokumentation zeigen dann diese Person.",
      "Mit den Pfeilen neben dem Namen (oder J/K) zur nächsten Person des Wohnbereichs wechseln.",
    ],
  },
  {
    icon: "note",
    title: "Dokumentieren",
    steps: [
      "In der Leiste auf „Doku“ tippen (grünes Symbol).",
      "Art und Einordnung wählen, Text eingeben und speichern.",
      `„Speichern & nächster ${t.one}“ springt direkt zur nächsten Person.`,
    ],
  },
  {
    icon: "med",
    title: "Medikamentenrunde",
    steps: [
      "In der Leiste „Medikamente“ öffnen (rosa Symbol); die Zahl zeigt überfällige Gaben.",
      "Pro Gabe „Gegeben“ oder mit Begründung „Nicht gegeben“ dokumentieren.",
      "Reservemedikation unter „Reserven“ erfassen.",
    ],
  },
  {
    icon: "handover",
    title: "Übergabe",
    steps: [
      "App „Mein Dienst“ öffnen, oben „Übergabe“ wählen: Dort stehen die offenen Punkte seit deinem letzten Dienst.",
      "Punkte lesen und bestätigen, eigene Hinweise für den nächsten Dienst erfassen.",
    ],
  },
  {
    icon: "tasks",
    title: "Tagesliste",
    steps: [
      `Die Startseite zeigt pro ${t.one}, was heute fällig ist.`,
      "Ein Tipp auf einen Punkt öffnet direkt die passende Seite für diese Person.",
    ],
  },
];

export function HelpPanel() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(HELP_EVENT, onOpen);
    return () => window.removeEventListener(HELP_EVENT, onOpen);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;
  return createPortal(<HelpContent onClose={() => setOpen(false)} />, document.body);
}

function HelpContent({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const help = useApiData<{ contacts: Array<{ name: string; jobTitle: string; phone: string }> }>("/api/help");
  const [guide, setGuide] = useState(0);
  const t = useTerms();
  const GUIDES = guides(t);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState("");

  const report = async () => {
    setSending(true);
    setResult("");
    try {
      const response = await requestJson<{ notified: number }>("/api/help", {
        method: "POST",
        body: { message, page: pathname },
      });
      setMessage("");
      setResult(
        `Gesendet – ${response.notified} Person${response.notified === 1 ? "" : "en"} der Administration informiert.`,
      );
    } catch (reason) {
      setResult((reason as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="area-editor-overlay"
      role="presentation"
      onMouseDown={(event) => event.currentTarget === event.target && onClose()}
    >
      <section className="area-editor-panel help-panel" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <header className="area-editor-header">
          <div>
            <p className="eyebrow">CareOS</p>
            <h2 id="help-title">Hilfe & Support</h2>
            <p>Kurzanleitungen, Tastaturkürzel und direkter Kontakt zur Administration.</p>
          </div>
          <button className="area-editor-close" type="button" aria-label="Hilfe schliessen" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="help-panel-body">
          <section className="help-section">
            <h3>Kurzanleitungen</h3>
            <div className="help-guide-tabs" role="tablist" aria-label="Kurzanleitungen">
              {GUIDES.map((item, index) => (
                <button
                  className={guide === index ? "active" : ""}
                  type="button"
                  role="tab"
                  aria-selected={guide === index}
                  key={item.title}
                  onClick={() => setGuide(index)}
                >
                  <ModuleIcon name={item.icon} />
                  {item.title}
                </button>
              ))}
            </div>
            <ol className="help-steps">
              {GUIDES[guide].steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>

          <section className="help-section">
            <h3>Problem melden</h3>
            <p>
              Etwas funktioniert nicht oder ist unklar? Die Administration erhält deine Meldung mit der aktuellen Seite.
            </p>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Was ist passiert? Was wolltest du tun?"
              aria-label="Problem beschreiben"
            />
            <div className="help-report-actions">
              {result && <small role="status">{result}</small>}
              <button
                className="primary-button"
                type="button"
                disabled={sending || message.trim().length < 5}
                onClick={() => void report()}
              >
                {sending ? "Wird gesendet …" : "Meldung senden"}
              </button>
            </div>
          </section>

          <section className="help-section">
            <h3>Ansprechpersonen</h3>
            {help.data?.contacts.length ? (
              <ul className="help-contacts">
                {help.data.contacts.map((contact) => (
                  <li key={contact.name}>
                    <strong>{contact.name}</strong>
                    <small>{[contact.jobTitle, "Administration"].filter(Boolean).join(" · ")}</small>
                    {contact.phone && <a href={`tel:${contact.phone.replace(/\s+/g, "")}`}>{contact.phone}</a>}
                  </li>
                ))}
              </ul>
            ) : (
              <p>{help.loading ? "Wird geladen …" : "Keine Administration hinterlegt."}</p>
            )}
          </section>

          <section className="help-section">
            <h3>Tastaturkürzel</h3>
            <div className="help-shortcuts">
              {shortcutGroups(t).map((group) => (
                <div key={group.title}>
                  <strong>{group.title}</strong>
                  {group.items.map((item) => (
                    <span key={item.label}>
                      <span>
                        {item.keys.map((key) => (
                          <kbd key={key}>{key}</kbd>
                        ))}
                      </span>
                      {item.label}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
