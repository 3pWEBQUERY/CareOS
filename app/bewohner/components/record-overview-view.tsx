"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useEscapeClose } from "@/app/components/use-escape-close";
import { useRouter } from "next/navigation";
import { setCareResident, useTerms } from "@/app/components/care-context";
import { formatDate, formatDateTime } from "@/app/components/workspace-ui";
import { BodyMap3D } from "./body-map-3d";
import { RecordCareProcess } from "./record-care-process";
import { appointmentDateLabel, appointmentLocalParts } from "@/lib/resident-appointments";
import {
  CalendarDots,
  CaretDown,
  ClipboardText,
  FileText,
  Heartbeat,
  ListChecks,
  NotePencil,
  PencilSimple,
  Pill,
  Plus,
  Pulse,
  Stethoscope,
  Trash,
  User,
  FirstAidKit,
} from "@phosphor-icons/react";
import type { ResidentRecordState } from "./use-resident-record";
import type { BodyObservation } from "./resident-record-data";

const BODY_KINDS = [
  ["wound", "Wunde"],
  ["redness", "Rötung"],
  ["fracture", "Fraktur"],
  ["other", "Sonstiges"],
] as const satisfies ReadonlyArray<readonly [BodyObservation["kind"], string]>;
const BODY_KIND_LABELS = Object.fromEntries(BODY_KINDS) as Record<BodyObservation["kind"], string>;

// Standardtext der Bewohnerliste, wenn weder ein klinischer Hinweis noch eine Notiz vorliegt.
const NO_HINT = "Keine aktuellen Hinweise";

export function RecordOverviewView({ r }: { r: ResidentRecordState }) {
  const t = useTerms();
  const {
    resident,
    contentRef,
    entries,
    setActiveView,
    activeBodyObservationId,
    setActiveBodyObservationId,
    bodyObservations,
    bodyLoading,
    bodyError,
    placingBodyPoint,
    setPlacingBodyPoint,
    residentGender,
    appointmentsLoading,
    nextAppointment,
    genderLabel,
    newBodyObservation,
    editBodyObservation,
    archiveBodyObservation,
    openDocumentation,
    live,
    bodyEditor,
  } = r;
  const router = useRouter();
  const summary = live.summary.data;
  const [hiddenKinds, setHiddenKinds] = useState<BodyObservation["kind"][]>([]);
  const visibleObservations = useMemo(
    () => bodyObservations.filter((item) => !hiddenKinds.includes(item.kind)),
    [bodyObservations, hiddenKinds],
  );
  const mapObservations = useMemo(
    () =>
      visibleObservations.map((item) => ({
        id: item.id,
        kind: item.kind,
        label: item.label,
        location: item.location,
        x: Number(item.body_x),
        y: Number(item.body_y),
        z: Number(item.body_z),
      })),
    [visibleObservations],
  );
  // Escape beendet das Markieren, ohne die Akte zu schliessen.
  useEscapeClose(() => setPlacingBodyPoint(false), placingBodyPoint && !bodyEditor);
  // Quick actions open the module for this resident; the record's resident becomes the working context.
  const openModule = (href: string) => {
    if (resident.id) setCareResident(resident.id);
    router.push(href);
  };
  const loading = live.summary.loading && !summary;
  return (
    <main className="resident-record-content" ref={contentRef} key="overview">
      <RecordCareProcess r={r} />
      <section className="record-metrics" aria-label="Aktenübersicht">
        <div>
          <span className="record-metric-icon">
            <User aria-hidden="true" />
          </span>
          <span>
            <small>Bezugspflege</small>
            <strong>
              {summary?.primaryNurse ?? summary?.planOwner ?? (loading ? "Wird geladen…" : "Nicht festgelegt")}
            </strong>
          </span>
        </div>
        <div>
          <span className="record-metric-icon">
            <Heartbeat aria-hidden="true" />
          </span>
          <span>
            <small>Letzte Vitalwerte</small>
            <strong>
              {summary?.lastVital
                ? `${formatDateTime(summary.lastVital.measuredAt)} · ${summary.lastVital.metric}`
                : loading
                  ? "Wird geladen…"
                  : "Noch keine Messung"}
            </strong>
          </span>
        </div>
        <div>
          <span className="record-metric-icon">
            <Pill aria-hidden="true" />
          </span>
          <span>
            <small>Medikationen heute</small>
            <strong>
              {summary
                ? summary.medsToday.total
                  ? `${summary.medsToday.given} von ${summary.medsToday.total} erfolgt`
                  : "Keine geplanten Gaben"
                : "Wird geladen…"}
            </strong>
          </span>
        </div>
        <div>
          <span className="record-metric-icon">
            <CalendarDots aria-hidden="true" />
          </span>
          <span>
            <small>Nächster Termin</small>
            <strong>
              {nextAppointment
                ? `${nextAppointment.title} · ${appointmentDateLabel(nextAppointment.starts_at, { day: "2-digit", month: "2-digit" })}, ${appointmentLocalParts(nextAppointment.starts_at).time}`
                : appointmentsLoading
                  ? "Wird geladen…"
                  : "Kein Termin geplant"}
            </strong>
          </span>
        </div>
      </section>

      <section className="record-card record-quick-access" aria-labelledby="quick-access-title">
        <div className="record-card-heading">
          <div>
            <span className="record-section-label">Direktzugriff</span>
            <h3 id="quick-access-title">Schnellaktionen</h3>
          </div>
          <span>8 Aktionen</span>
        </div>
        <div className="record-horizontal-actions">
          <button type="button" onClick={() => openDocumentation()}>
            <NotePencil aria-hidden="true" />
            <span>
              <strong>Dokumentieren</strong>
              <small>Pflegeeintrag</small>
            </span>
          </button>
          <button type="button" onClick={() => openModule("/c/vitalwerte/entwicklung")}>
            <Heartbeat aria-hidden="true" />
            <span>
              <strong>Vitalwert</strong>
              <small>Messung erfassen</small>
            </span>
          </button>
          <button type="button" onClick={() => openModule("/c/medikation")}>
            <Pill aria-hidden="true" />
            <span>
              <strong>Medikation</strong>
              <small>Gabe erfassen</small>
            </span>
          </button>
          <button type="button" onClick={() => openModule("/c/betrieb/aufgaben")}>
            <ListChecks aria-hidden="true" />
            <span>
              <strong>Aufgabe</strong>
              <small>Intervention planen</small>
            </span>
          </button>
          <button type="button" onClick={() => setActiveView("care-record")}>
            <ClipboardText aria-hidden="true" />
            <span>
              <strong>Pflegeplanung</strong>
              <small>Ziele öffnen</small>
            </span>
          </button>
          <button type="button" onClick={() => openModule(`/c/wundmanagement?resident=${resident.id ?? ""}`)}>
            <Pulse aria-hidden="true" />
            <span>
              <strong>Wunde</strong>
              <small>Status erfassen</small>
            </span>
          </button>
          <button type="button" onClick={() => openModule("/c/ernaehrung/trinkprotokoll")}>
            <User aria-hidden="true" />
            <span>
              <strong>Trinkmenge</strong>
              <small>Flüssigkeit erfassen</small>
            </span>
          </button>
          <button type="button" onClick={() => openModule("/c/einschaetzungen")}>
            <Stethoscope aria-hidden="true" />
            <span>
              <strong>Einschätzung</strong>
              <small>Assessment starten</small>
            </span>
          </button>
        </div>
      </section>

      <div className="resident-overview-layout">
        <section className="record-card body-map-card" aria-labelledby="body-map-title">
          <div className="record-card-heading">
            <div>
              <span className="record-section-label">Körperstatus</span>
              <h3 id="body-map-title">Körperübersicht</h3>
            </div>
            <button
              type="button"
              className={placingBodyPoint ? "active" : ""}
              aria-pressed={placingBodyPoint}
              onClick={() => {
                setPlacingBodyPoint(!placingBodyPoint);
                setActiveBodyObservationId(null);
              }}
            >
              {placingBodyPoint ? (
                "Abbrechen"
              ) : (
                <>
                  <Plus aria-hidden="true" /> Befund hinzufügen
                </>
              )}
            </button>
          </div>
          <div className="body-map-content">
            <div className="body-map-visual">
              <div className="body-map-legend" role="group" aria-label="Befunde nach Art ein- und ausblenden">
                {BODY_KINDS.map(([kind, label]) => {
                  const count = bodyObservations.filter((item) => item.kind === kind).length;
                  const shown = !hiddenKinds.includes(kind);
                  return (
                    <button
                      type="button"
                      key={kind}
                      className={`${kind} ${shown ? "" : "off"}`}
                      aria-pressed={shown}
                      title={shown ? `${label} ausblenden` : `${label} einblenden`}
                      onClick={() =>
                        setHiddenKinds((current) =>
                          current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind],
                        )
                      }
                    >
                      {label}
                      <small>{count}</small>
                    </button>
                  );
                })}
              </div>
              <BodyMap3D
                gender={residentGender}
                observations={mapObservations}
                selectedId={activeBodyObservationId}
                placing={placingBodyPoint}
                quickPlace
                pending={bodyEditor && !bodyEditor.id ? bodyEditor.draft : null}
                onSelect={(id) => {
                  setPlacingBodyPoint(false);
                  setActiveBodyObservationId(id);
                }}
                onPlace={newBodyObservation}
                onCancelPlacing={() => setPlacingBodyPoint(false)}
              />
              <span className="body-model-caption">
                {genderLabel === "Keine Angabe" || genderLabel === "Divers"
                  ? "Anatomisches Referenzmodell"
                  : `${genderLabel}es Körpermodell`}{" "}
                · 360° Ansicht
              </span>
            </div>

            <div className="body-observation-list" aria-label="Erfasste Körperstellen">
              {bodyObservations.length > 0 && (
                <p className="body-observation-summary">
                  <strong>
                    {bodyObservations.length} aktive{bodyObservations.length === 1 ? "r" : ""} Befund
                    {bodyObservations.length === 1 ? "" : "e"}
                  </strong>
                  {visibleObservations.length < bodyObservations.length && (
                    <span>
                      {visibleObservations.length} angezeigt ·{" "}
                      <button type="button" onClick={() => setHiddenKinds([])}>
                        Alle zeigen
                      </button>
                    </span>
                  )}
                </p>
              )}
              {bodyLoading && <p className="body-observation-empty">Körperstatus wird geladen…</p>}
              {!bodyLoading && bodyObservations.length === 0 && (
                <div className="body-observation-empty">
                  <strong>Noch keine Körperbefunde</strong>
                  <p>
                    {placingBodyPoint
                      ? "Körperstelle am Modell anklicken oder unter dem Modell aus der Liste wählen."
                      : "Körperstelle am Modell anklicken, um einen Befund zu erfassen – Wunden, Rötungen und weitere Auffälligkeiten. Die Körperstelle wird dabei automatisch benannt."}
                  </p>
                  {!placingBodyPoint && (
                    <button className="secondary-button" type="button" onClick={() => setPlacingBodyPoint(true)}>
                      Körperstelle auswählen
                    </button>
                  )}
                </div>
              )}
              {bodyError && (
                <p className="body-observation-error" role="alert">
                  {bodyError}
                </p>
              )}
              {visibleObservations.map((observation) => {
                const expanded = activeBodyObservationId === observation.id;
                return (
                  <section className={`body-observation ${expanded ? "expanded" : ""}`} key={observation.id}>
                    <button
                      className="body-observation-toggle"
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={`body-observation-${observation.id}`}
                      onClick={() =>
                        setActiveBodyObservationId((current) => (current === observation.id ? null : observation.id))
                      }
                    >
                      <span className={`body-observation-icon ${observation.kind}`}>
                        <Pulse aria-hidden="true" />
                      </span>
                      <span>
                        <strong>{observation.label}</strong>
                        <small>
                          {BODY_KIND_LABELS[observation.kind]} · {observation.location} · {observation.status}
                        </small>
                      </span>
                      <CaretDown aria-hidden="true" />
                    </button>
                    {expanded && (
                      <div className="body-observation-detail" id={`body-observation-${observation.id}`}>
                        <p>{observation.notes || "Keine ergänzenden Hinweise erfasst."}</p>
                        <dl>
                          <div>
                            <dt>Erfasst</dt>
                            <dd>{new Date(observation.created_at).toLocaleString("de-CH")}</dd>
                          </div>
                          <div>
                            <dt>Verantwortlich</dt>
                            <dd>{observation.author}</dd>
                          </div>
                        </dl>
                        <div className="body-observation-links">
                          {observation.wound_id ? (
                            <Link href={`/wundmanagement?wound=${observation.wound_id}`}>
                              <FirstAidKit aria-hidden="true" /> Wundakte öffnen
                            </Link>
                          ) : (
                            (observation.kind === "wound" || observation.kind === "redness") &&
                            resident.id && (
                              <Link href={`/wundmanagement?resident=${resident.id}&observation=${observation.id}`}>
                                <FirstAidKit aria-hidden="true" /> Als Wunde erfassen
                              </Link>
                            )
                          )}
                          <button type="button" onClick={() => editBodyObservation(observation)}>
                            <PencilSimple aria-hidden="true" /> Bearbeiten
                          </button>
                          <button type="button" onClick={() => archiveBodyObservation(observation)}>
                            <Trash aria-hidden="true" /> Archivieren
                          </button>
                        </div>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </div>
        </section>

        <aside className="resident-overview-side">
          <section className="record-card record-alert-card">
            <div className="record-card-heading">
              <div>
                <span className="record-section-label">Pflegehinweis</span>
                <h3>Aktuell wichtig</h3>
              </div>
              <span>{resident.lastUpdate}</span>
            </div>
            <div className={`record-clinical-alert ${resident.status}`}>
              <Pulse aria-hidden="true" />
              {resident.note === NO_HINT ? (
                <div>
                  <strong>Keine aktuellen Pflegehinweise</strong>
                  <p>Beobachtungen und Veränderungen bitte in der Dokumentation erfassen.</p>
                </div>
              ) : (
                <div>
                  <strong>{resident.note}</strong>
                  <p>Bitte im laufenden Dienst beachten und Veränderungen zeitnah dokumentieren.</p>
                </div>
              )}
            </div>
          </section>

          <section className="record-card">
            <div className="record-card-heading">
              <div>
                <span className="record-section-label">{t.one}</span>
                <h3>Stammdaten</h3>
              </div>
              <button type="button" onClick={() => setActiveView("master-data")}>
                Alle Stammdaten
              </button>
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
                <dt>Hausarzt</dt>
                <dd>{summary?.master.gpName ?? "Nicht erfasst"}</dd>
              </div>
              <div>
                <dt>Eintritt</dt>
                <dd>{summary?.master.admittedOn ? formatDate(summary.master.admittedOn) : "Nicht erfasst"}</dd>
              </div>
              <div>
                <dt>Aktenstatus</dt>
                <dd>
                  {!summary
                    ? "–"
                    : summary.missing.length
                      ? `${summary.missing.length} Angabe${summary.missing.length === 1 ? "" : "n"} fehlen`
                      : "Vollständig"}
                </dd>
              </div>
            </dl>
          </section>

          <button className="record-document-button" type="button" onClick={() => setActiveView("documents")}>
            <FileText aria-hidden="true" />
            <span>
              <strong>Dokumente und Berichte</strong>
              <small>
                {summary
                  ? `${summary.documentsCount} hinterlegte${summary.documentsCount === 1 ? "s" : ""} Dokument${summary.documentsCount === 1 ? "" : "e"}`
                  : "Wird geladen…"}
              </small>
            </span>
          </button>
        </aside>

        <section className="record-card record-overview-history">
          <div className="record-card-heading">
            <div>
              <span className="record-section-label">Dokumentation</span>
              <h3>Letzte Einträge</h3>
            </div>
            <button type="button" onClick={() => openDocumentation()}>
              Neue Dokumentation
            </button>
          </div>
          <div className="record-history">
            {!live.documentation.loading && entries.length === 0 && (
              <p className="body-observation-empty">Noch keine Einträge in den letzten 30 Tagen.</p>
            )}
            {entries.slice(0, 6).map((entry) => (
              <button
                className="record-history-entry"
                type="button"
                key={entry.id}
                onClick={() => openDocumentation(entry)}
                aria-label={`${entry.title} öffnen`}
              >
                <time>{entry.time}</time>
                <i />
                <span>
                  <strong>{entry.title}</strong>
                  <p>{entry.text}</p>
                  <small>{entry.author}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
