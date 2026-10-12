"use client";

import { CareDatePicker, CareSelect } from "@/app/components/care-form-controls";
import { ArrowsLeftRight, Check, Pulse, Stethoscope, Warning } from "@phosphor-icons/react";
import { useWorkContext, useTerms } from "@/app/components/care-context";
import { DOC_CATEGORIES } from "@/lib/documentation-shared";
import { AmendDialog } from "@/app/pflegedokumentation/components/entry-parts";
import type { ResidentRecordState } from "./use-resident-record";

export function RecordDocumentationView({ r }: { r: ResidentRecordState }) {
  const t = useTerms();
  const {
    resident,
    contentRef,
    entries,
    setActiveView,
    selectedEntryId,
    documentationText,
    setDocumentationText,
    documentationDate,
    setDocumentationDate,
    documentationCategory,
    setDocumentationCategory,
    documentationFlags,
    selectedEntry,
    openDocumentation,
    toggleDocumentationFlag,
    saveDocumentation,
    documentationTime,
    setDocumentationTime,
    documentationGoals,
    toggleDocumentationGoal,
    documentationSaving,
    documentationError,
    amendingEntry,
    setAmendingEntryId,
    selectedDocEntry,
    careDomains,
    live,
    onAction,
  } = r;
  const profile = useWorkContext()?.profile;
  const readOnly = Boolean(selectedDocEntry);
  const canWrite = live.documentation.data?.canWrite ?? false;
  return (
    <main className="resident-record-content record-documentation-view" ref={contentRef} key="documentation">
      <div className="documentation-page-heading">
        <div>
          <span className="record-section-label">Dokumentation</span>
          <h3>{selectedEntry ? selectedEntry.title : "Neuer Pflegeeintrag"}</h3>
          <p>
            {readOnly
              ? `Erfasst ${selectedEntry?.time} von ${selectedEntry?.author}. Einträge bleiben unverändert; Korrekturen werden als Nachtrag gespeichert.`
              : `Die Erfassung bleibt vollständig innerhalb der geöffneten ${t.prefix}akte.`}
          </p>
        </div>
        <button type="button" onClick={() => setActiveView("overview")}>
          <span aria-hidden="true">←</span> Zur Übersicht
        </button>
      </div>

      <div className="documentation-layout">
        <form className="record-card documentation-editor" onSubmit={saveDocumentation}>
          <div className="documentation-form-grid">
            <label>
              <span>Datum</span>
              {readOnly ? (
                <input value={documentationDate.split("-").reverse().join(".")} readOnly />
              ) : (
                <CareDatePicker label="Datum" value={documentationDate} onChange={setDocumentationDate} />
              )}
            </label>
            <label>
              <span>Uhrzeit</span>
              <input
                type="time"
                required
                value={documentationTime}
                readOnly={readOnly}
                onChange={(event) => setDocumentationTime(event.target.value)}
              />
            </label>
            <label>
              <span>Kategorie</span>
              {readOnly ? (
                <input value={documentationCategory} readOnly />
              ) : (
                <CareSelect
                  label="Kategorie"
                  value={documentationCategory}
                  options={[...DOC_CATEGORIES]}
                  onChange={setDocumentationCategory}
                />
              )}
            </label>
            <label>
              <span>Dokumentiert von</span>
              <input
                type="text"
                value={
                  readOnly
                    ? (selectedEntry?.author ?? "Unbekannt")
                    : profile
                      ? [...new Set([profile.displayName, profile.jobTitle].filter(Boolean))].join(" · ")
                      : "…"
                }
                readOnly
              />
            </label>
          </div>

          <label className="documentation-text-field">
            <span>Pflegeeintrag</span>
            <textarea
              required
              minLength={3}
              readOnly={readOnly}
              value={documentationText}
              onChange={(event) => setDocumentationText(event.target.value)}
              placeholder="Beobachtung, Massnahme und Wirkung dokumentieren …"
            />
          </label>

          <fieldset className="documentation-flags">
            <legend>Kennzeichnung &amp; Weitergabe</legend>
            <p>Eine Markierung pro Eintrag macht ihn in Übergabe, Visite und Schichtübersicht sichtbar.</p>
            <div>
              <button
                className={documentationFlags.includes("important") ? "active important" : ""}
                type="button"
                disabled={readOnly}
                role="checkbox"
                aria-checked={documentationFlags.includes("important")}
                onClick={() => toggleDocumentationFlag("important")}
              >
                <Warning aria-hidden="true" />
                <span>
                  <strong>Wichtig</strong>
                  <small>Als kritisch mit höchster Priorität anzeigen</small>
                </span>
                <i aria-hidden="true">
                  <Check />
                </i>
              </button>
              <button
                className={documentationFlags.includes("visit") ? "active visit" : ""}
                type="button"
                disabled={readOnly}
                role="checkbox"
                aria-checked={documentationFlags.includes("visit")}
                onClick={() => toggleDocumentationFlag("visit")}
              >
                <Stethoscope aria-hidden="true" />
                <span>
                  <strong>Wichtig für Visite</strong>
                  <small>Für die nächste Visite vormerken</small>
                </span>
                <i aria-hidden="true">
                  <Check />
                </i>
              </button>
              <button
                className={documentationFlags.includes("observation") ? "active observation" : ""}
                type="button"
                disabled={readOnly}
                role="checkbox"
                aria-checked={documentationFlags.includes("observation")}
                onClick={() => toggleDocumentationFlag("observation")}
              >
                <Pulse aria-hidden="true" />
                <span>
                  <strong>Beobachtungsphase</strong>
                  <small>Verlauf engmaschig weiterführen</small>
                </span>
                <i aria-hidden="true">
                  <Check />
                </i>
              </button>
              <button
                className={documentationFlags.includes("handover") ? "active handover" : ""}
                type="button"
                disabled={readOnly}
                role="checkbox"
                aria-checked={documentationFlags.includes("handover")}
                onClick={() => toggleDocumentationFlag("handover")}
              >
                <ArrowsLeftRight aria-hidden="true" />
                <span>
                  <strong>Übergaberelevant</strong>
                  <small>In die nächste Übergabe aufnehmen</small>
                </span>
                <i aria-hidden="true">
                  <Check />
                </i>
              </button>
            </div>
          </fieldset>

          {!readOnly && careDomains.length > 0 && (
            <fieldset className="documentation-tags">
              <legend>Bezug zur Pflegeplanung</legend>
              <div>
                {careDomains.map((domain) => (
                  <button
                    className={documentationGoals.includes(domain.label) ? "active" : ""}
                    type="button"
                    key={domain.id}
                    aria-pressed={documentationGoals.includes(domain.label)}
                    onClick={() => toggleDocumentationGoal(domain.label)}
                  >
                    {domain.label}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <div className="documentation-quality-note">
            <Check aria-hidden="true" />
            <span>
              <strong>Dokumentationsqualität</strong>
              <small>Eintrag ist eindeutig dem {t.oneOblique}, Zeitpunkt und Fachbereich zugeordnet.</small>
            </span>
          </div>

          {documentationError && (
            <p className="appointment-editor-error" role="alert">
              {documentationError}
            </p>
          )}
          <footer className="documentation-form-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => (readOnly ? openDocumentation() : setActiveView("overview"))}
            >
              {readOnly ? "Neuer Eintrag" : "Abbrechen"}
            </button>
            {canWrite && !readOnly && r.navigation && (
              <button
                className="secondary-button"
                type="submit"
                data-next="true"
                disabled={documentationSaving}
                title={`Speichern und die nächste ${t.prefix}akte öffnen`}
              >
                Speichern &amp; weiter
              </button>
            )}
            {canWrite && (
              <button className="primary-button" type="submit" disabled={documentationSaving}>
                <Check aria-hidden="true" />{" "}
                {readOnly ? "Nachtrag erfassen" : documentationSaving ? "Speichern…" : "Dokumentation speichern"}
              </button>
            )}
          </footer>
        </form>

        <aside className="documentation-sidebar">
          <section className="record-card documentation-context">
            <div className="record-card-heading">
              <div>
                <span className="record-section-label">Kontext</span>
                <h3>{resident.name}</h3>
              </div>
            </div>
            <dl className="record-details">
              <div>
                <dt>Zimmer</dt>
                <dd>{resident.room}</dd>
              </div>
              <div>
                <dt>Wohnbereich</dt>
                <dd>{resident.unit}</dd>
              </div>
              <div>
                <dt>Pflegebedarf</dt>
                <dd>{resident.careLevel}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{resident.statusLabel}</dd>
              </div>
            </dl>
          </section>

          <section className="record-card documentation-recent">
            <div className="record-card-heading">
              <div>
                <span className="record-section-label">Letzte 30 Tage</span>
                <h3>Dokumentationspunkte</h3>
              </div>
            </div>
            <div>
              {entries.map((entry) => (
                <button
                  className={selectedEntryId === entry.id ? "active" : ""}
                  type="button"
                  key={entry.id}
                  onClick={() => openDocumentation(entry)}
                >
                  <time>{entry.time}</time>
                  <span>
                    <strong>{entry.title}</strong>
                    <small>{entry.text.length > 70 ? `${entry.text.slice(0, 70)}…` : entry.text}</small>
                  </span>
                </button>
              ))}
            </div>
            {!live.documentation.loading && entries.length === 0 && (
              <p className="body-observation-empty">Noch keine Einträge.</p>
            )}
          </section>
        </aside>
      </div>
      {amendingEntry && (
        <AmendDialog
          entry={amendingEntry}
          onClose={() => setAmendingEntryId(null)}
          onSaved={(message) => {
            setAmendingEntryId(null);
            live.reloadDocumentation();
            openDocumentation();
            onAction(message);
          }}
        />
      )}
    </main>
  );
}
