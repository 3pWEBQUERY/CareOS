"use client";

import { useCountry, useTerms } from "@/app/components/care-context";
import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Printer, X } from "@phosphor-icons/react";
import { formatDate, formatDateTime, useApiData } from "@/app/components/workspace-ui";
import { ADVANCE_CARE_LABELS } from "@/lib/advance-care-shared";
import { diagnosisText } from "@/lib/diagnoses-shared";
import { LANGUAGES, RESUSCITATION_STATUSES } from "@/lib/resident-record-shared";
import { ageOn, scheduleLabel, type TransferSheet } from "@/lib/resident-transfer-shared";

const GENDERS: Record<string, string> = {
  female: "weiblich",
  male: "männlich",
  diverse: "divers",
  unspecified: "keine Angabe",
};
const KINDS: Record<string, string> = { wound: "Wunde", redness: "Rötung", fracture: "Fraktur", other: "Sonstiges" };
const WOUND_STATUS: Record<string, string> = { active: "aktiv", healing: "heilend" };

const or = (value: string | null | undefined, fallback = "–") => (value && value.trim() ? value : fallback);

// Überleitungsbogen (A4 hoch) für Spitaleinweisung oder Verlegung; PDF über den Druckdialog.
export default function TransferSheetPage() {
  const t = useTerms();
  const country = useCountry();
  const params = useSearchParams();
  const residentId = params.get("resident");
  const valid = /^[0-9a-f-]{36}$/i.test(residentId ?? "");
  const { data, error } = useApiData<TransferSheet>(valid ? `/api/residents/${residentId}/transfer` : null);
  const printed = useRef(false);
  useEffect(() => {
    if (!data || printed.current || params.get("dialog") === "0") return;
    printed.current = true;
    const timer = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(timer);
  }, [data, params]);

  const name = data ? `${data.master.firstName} ${data.master.lastName}` : "";
  const age = data ? ageOn(data.master.dateOfBirth, new Date(data.createdAt)) : null;
  const scheduled = data?.medication.filter((item) => !item.prn) ?? [];
  const reserve = data?.medication.filter((item) => item.prn) ?? [];

  return (
    <main className="transfer-print">
      <style>{"@page { size: A4 portrait; margin: 12mm; }"}</style>
      <div className="roster-print-bar">
        <strong>Überleitungsbogen</strong>
        <span>A4 hoch · im Druckdialog „Als PDF speichern“ wählen</span>
        <button className="primary-button" type="button" disabled={!data} onClick={() => window.print()}>
          <Printer className="button-icon" /> Drucken / PDF
        </button>
        <button className="secondary-button" type="button" onClick={() => window.close()}>
          <X className="button-icon" /> Schliessen
        </button>
      </div>
      {!(valid && !error && data) && <h1 className="print-hidden-heading">Überleitungsbogen</h1>}
      {!valid ? (
        <p className="roster-print-message" role="alert">
          Keine {t.prefix}akte gewählt.
        </p>
      ) : error ? (
        <p className="roster-print-message" role="alert">
          Der Überleitungsbogen konnte nicht erstellt werden: {error}
        </p>
      ) : !data ? (
        <p className="roster-print-message">Überleitungsbogen wird erstellt …</p>
      ) : (
        <article className="transfer-sheet">
          <header className="transfer-head">
            <div>
              <p>Überleitungsbogen · Pflege</p>
              <h1>{name}</h1>
              <span>
                {data.master.dateOfBirth
                  ? `geb. ${formatDate(data.master.dateOfBirth)}${age !== null ? ` (${age} Jahre)` : ""}`
                  : "Geburtsdatum nicht erfasst"}
                {" · "}
                {GENDERS[data.master.gender] ?? "keine Angabe"}
              </span>
            </div>
            <div className="transfer-facility">
              <strong>{data.facility.site ?? data.facility.organization}</strong>
              {data.facility.site && data.facility.site !== data.facility.organization && (
                <span>{data.facility.organization}</span>
              )}
              {data.facility.address && <span>{data.facility.address}</span>}
              {data.facility.phone && <span>Tel. {data.facility.phone}</span>}
              <span>
                {[data.facility.unit, data.facility.floor, data.facility.room].filter(Boolean).join(" · ") ||
                  "Wohnbereich nicht erfasst"}
              </span>
            </div>
          </header>

          <section
            className={`transfer-allergies transfer-resuscitation ${data.master.resuscitationStatus === "dnr" ? "known" : ""}`}
          >
            <strong>Reanimationsstatus</strong>
            <span>
              {data.master.resuscitationStatus
                ? [
                    RESUSCITATION_STATUSES[data.master.resuscitationStatus].label,
                    data.master.resuscitationSource && `Grundlage: ${data.master.resuscitationSource}`,
                    data.master.resuscitationDecidedOn && `vom ${formatDate(data.master.resuscitationDecidedOn)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "Nicht erfasst"}
            </span>
          </section>

          <section className="transfer-allergies transfer-advance-care">
            <strong>Vorsorge &amp; Vertretung</strong>
            <span>
              {[
                data.master.advanceDirective === "yes"
                  ? `Patientenverfügung liegt vor${data.master.advanceDirectiveOn ? ` (${formatDate(data.master.advanceDirectiveOn)})` : ""}${data.master.advanceDirectiveLocation ? `, ${data.master.advanceDirectiveLocation}` : ""}`
                  : data.master.advanceDirective === "no"
                    ? "Keine Patientenverfügung"
                    : "Patientenverfügung nicht erfasst",
                data.master.careMandate === "yes"
                  ? `${ADVANCE_CARE_LABELS[data.country].careMandate} liegt vor`
                  : data.master.careMandate === "no"
                    ? `${ADVANCE_CARE_LABELS[data.country].careMandate} liegt nicht vor`
                    : null,
                data.representative
                  ? `Vertretung: ${data.representative.name} (${ADVANCE_CARE_LABELS[data.country].roles[data.representative.role]}${data.representative.phone ? `, ${data.representative.phone}` : ""})`
                  : "Vertretungsberechtigte Person nicht erfasst",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </section>

          <section className={`transfer-allergies ${data.allergies.length ? "known" : ""}`}>
            <strong>Allergien / Unverträglichkeiten</strong>
            <span>{data.allergies.length ? data.allergies.join(" · ") : "Keine Allergien erfasst"}</span>
          </section>

          <section className="transfer-allergies transfer-diagnoses">
            <strong>Diagnosen</strong>
            {data.diagnoses.length ? (
              <span>
                {data.diagnoses
                  .map(
                    (item) =>
                      `${item.kind === "main" ? "Hauptdiagnose: " : ""}${diagnosisText(item)}${item.sinceOn ? `, seit ${formatDate(item.sinceOn)}` : ""}`,
                  )
                  .join(" · ")}
              </span>
            ) : (
              <span>Keine Diagnosen erfasst</span>
            )}
          </section>

          {data.vaccinations.length > 0 && (
            <section className="transfer-allergies transfer-vaccinations">
              <strong>Impfungen (zuletzt)</strong>
              <span>{data.vaccinations.map((item) => `${item.target}: ${formatDate(item.givenOn)}`).join(" · ")}</span>
            </section>
          )}

          <div className="transfer-columns">
            <section>
              <h2>Person</h2>
              <dl>
                <dt>Sprache</dt>
                <dd>{LANGUAGES[data.master.language] ?? data.master.language}</dd>
                <dt>Zivilstand</dt>
                <dd>{or(data.master.maritalStatus)}</dd>
                <dt>Konfession</dt>
                <dd>{or(data.master.religion)}</dd>
                <dt>{country.socialNumber.label}</dt>
                <dd>{or(data.master.socialSecurityNumber)}</dd>
                <dt>{country.insurance.insurerLabel}</dt>
                <dd>
                  {or(data.master.insurer)}
                  {data.master.insuranceNumber ? ` · Nr. ${data.master.insuranceNumber}` : ""}
                </dd>
              </dl>
            </section>
            <section>
              <h2>Aufenthalt &amp; Betreuung</h2>
              <dl>
                <dt>Eintritt</dt>
                <dd>{data.master.admittedOn ? formatDate(data.master.admittedOn) : "–"}</dd>
                <dt>Pflegebedarf</dt>
                <dd>{or(data.careLevel)}</dd>
                <dt>Bezugspflege</dt>
                <dd>{or(data.primaryNurse)}</dd>
                <dt>Hausarzt</dt>
                <dd>
                  {or(data.master.gpName)}
                  {data.master.gpPractice ? `, ${data.master.gpPractice}` : ""}
                  {data.master.gpPhone ? ` · Tel. ${data.master.gpPhone}` : ""}
                </dd>
                <dt>Apotheke</dt>
                <dd>{or(data.master.pharmacy)}</dd>
              </dl>
            </section>
          </div>

          <section>
            <h2>Kontaktpersonen</h2>
            {data.contacts.length ? (
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Beziehung</th>
                    <th>Telefon</th>
                    <th>E-Mail</th>
                  </tr>
                </thead>
                <tbody>
                  {data.contacts.map((contact) => (
                    <tr key={`${contact.name}-${contact.phone}`}>
                      <td>
                        {contact.name}
                        {(contact.primary || contact.emergency) && (
                          <small>
                            {[contact.primary && "Hauptkontakt", contact.emergency && "Notfall"]
                              .filter(Boolean)
                              .join(" · ")}
                          </small>
                        )}
                      </td>
                      <td>{or(contact.relationship)}</td>
                      <td>{or(contact.phone)}</td>
                      <td>{or(contact.email)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="transfer-empty">Keine Kontaktpersonen erfasst.</p>
            )}
          </section>

          <section>
            <h2>Risiken &amp; aktuelle Hinweise</h2>
            {data.flags.length || data.isolations.length || data.restraints.length || data.carePlan?.focus ? (
              <ul className="transfer-list">
                {data.isolations.map((isolation) => (
                  <li key={`${isolation.label}-${isolation.since}`} className="critical">
                    <strong>{isolation.label}</strong> – {isolation.reason}
                    {isolation.precautions && ` · ${isolation.precautions}`} (seit {formatDate(isolation.since)})
                  </li>
                ))}
                {data.flags.map((flag) => (
                  <li key={flag.label} className={flag.severity}>
                    <strong>{flag.label}</strong>
                    {flag.details && ` – ${flag.details}`}
                  </li>
                ))}
                {data.restraints.map((measure) => (
                  <li key={`${measure.label}-${measure.since}`} className="attention">
                    <strong>Freiheitsbeschränkende Massnahme: {measure.label}</strong>
                    {measure.schedule && ` – ${measure.schedule}`} (seit {formatDate(measure.since)})
                  </li>
                ))}
                {data.carePlan?.focus && (
                  <li>
                    <strong>Pflegefokus:</strong> {data.carePlan.focus}
                  </li>
                )}
              </ul>
            ) : (
              <p className="transfer-empty">Keine aktiven Risiken erfasst.</p>
            )}
          </section>

          <section>
            <h2>Medikation (Stand {formatDateTime(data.createdAt)})</h2>
            {scheduled.length ? (
              <table>
                <thead>
                  <tr>
                    <th>Präparat</th>
                    <th>Dosis</th>
                    <th>Einnahme</th>
                    <th>Applikation</th>
                    <th>Indikation</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduled.map((item, index) => (
                    <tr key={`${item.name}-${index}`}>
                      <td>
                        {item.name}
                        {item.controlled && <small className="transfer-paused">Betäubungsmittel (BtM)</small>}
                        {item.form && <small>{item.form}</small>}
                        {item.paused && <small className="transfer-paused">pausiert</small>}
                      </td>
                      <td>{or(item.amount)}</td>
                      <td>{or(scheduleLabel(item.times, item.weekdays))}</td>
                      <td>{or(item.route)}</td>
                      <td>{or(item.indication)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="transfer-empty">Keine Dauermedikation verordnet.</p>
            )}
            {reserve.length > 0 && (
              <>
                <h3>Reservemedikation</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Präparat</th>
                      <th>Dosis</th>
                      <th>Anwendung</th>
                      <th>Max. / 24 h</th>
                      <th>Zuletzt gegeben</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reserve.map((item, index) => (
                      <tr key={`${item.name}-${index}`}>
                        <td>
                          {item.name}
                          {item.controlled && <small className="transfer-paused">Betäubungsmittel (BtM)</small>}
                          {item.paused && <small className="transfer-paused">pausiert</small>}
                        </td>
                        <td>{or(item.amount)}</td>
                        <td>{or(item.prnInstructions ?? item.indication)}</td>
                        <td>{item.maxDosesPer24h ?? "–"}</td>
                        <td>{item.lastAdministeredAt ? formatDateTime(item.lastAdministeredAt) : "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>

          <div className="transfer-columns">
            <section>
              <h2>Wunden &amp; Körperbefunde</h2>
              {data.wounds.length || data.bodyFindings.length ? (
                <ul className="transfer-list">
                  {data.wounds.map((wound) => (
                    <li key={`w-${wound.title}-${wound.location}`} className={wound.critical ? "critical" : ""}>
                      <strong>{wound.title}</strong> – {wound.location} ({WOUND_STATUS[wound.status] ?? wound.status})
                    </li>
                  ))}
                  {data.bodyFindings.map((finding) => (
                    <li key={`b-${finding.label}-${finding.location}`}>
                      <strong>{KINDS[finding.kind] ?? finding.kind}:</strong> {finding.label} – {finding.location} (
                      {finding.status})
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="transfer-empty">Keine Wunden oder Befunde erfasst.</p>
              )}
            </section>
            <section>
              <h2>Letzte Vitalwerte (14 Tage)</h2>
              {data.vitals.length ? (
                <ul className="transfer-list">
                  {data.vitals.map((vital) => (
                    <li key={vital.metric} className={vital.status === "normal" ? "" : vital.status}>
                      <strong>{vital.metric}:</strong> {vital.value.toLocaleString("de-CH")}
                      {vital.secondaryValue !== null ? `/${vital.secondaryValue.toLocaleString("de-CH")}` : ""}{" "}
                      {vital.unit}
                      <small>{formatDateTime(vital.measuredAt)}</small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="transfer-empty">Keine Messungen in den letzten 14 Tagen.</p>
              )}
            </section>
          </div>

          <div className="transfer-columns">
            <section>
              <h2>Ernährung</h2>
              {data.nutrition ? (
                <dl>
                  <dt>Kostform</dt>
                  <dd>{or(data.nutrition.diet)}</dd>
                  <dt>Konsistenz</dt>
                  <dd>{or(data.nutrition.texture)}</dd>
                  <dt>Trinkziel</dt>
                  <dd>{data.nutrition.fluidTargetMl ? `${data.nutrition.fluidTargetMl} ml / Tag` : "–"}</dd>
                  <dt>Hinweise</dt>
                  <dd>{or(data.nutrition.instructions)}</dd>
                </dl>
              ) : (
                <p className="transfer-empty">Kein Ernährungsplan erfasst.</p>
              )}
            </section>
            <section>
              <h2>Pflegeziele</h2>
              {data.carePlan?.goals.length ? (
                <ul className="transfer-list">
                  {data.carePlan.goals.map((goal) => (
                    <li key={goal.statement}>
                      <strong>{goal.category}:</strong> {goal.statement}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="transfer-empty">Keine aktiven Pflegeziele.</p>
              )}
            </section>
          </div>

          <section>
            <h2>Pflegeverlauf der letzten 72 Stunden</h2>
            {data.recentNotes.length ? (
              <ul className="transfer-notes">
                {data.recentNotes.map((note) => (
                  <li
                    key={`${note.occurredAt}-${note.body.slice(0, 20)}`}
                    className={note.important ? "important" : ""}
                  >
                    <span>
                      {formatDateTime(note.occurredAt)} · {note.title ?? note.category}
                      {note.author ? ` · ${note.author}` : ""}
                    </span>
                    <p>{note.body}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="transfer-empty">Keine Einträge in den letzten 72 Stunden.</p>
            )}
          </section>

          {data.belongings.length > 0 && (
            <section>
              <h2>Hilfsmittel &amp; persönliche Gegenstände</h2>
              <ul className="transfer-belongings">
                {data.belongings.map((item) => (
                  <li key={`${item.kind}-${item.name}-${item.marking}`}>
                    <span className="transfer-check" aria-hidden="true" />
                    <span>
                      {item.name}
                      {item.marking ? ` (${item.marking})` : ""}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="transfer-empty">Mitgegebenes abhaken.</p>
            </section>
          )}

          <footer className="transfer-foot">
            <div>
              <span>
                Erstellt {formatDateTime(data.createdAt)} von {data.createdBy}
              </span>
              <span>Vertraulich – enthält Gesundheitsdaten. Nur an weiterbehandelnde Stellen weitergeben.</span>
            </div>
            <div className="transfer-signature">
              <span>Übergeben von / Datum</span>
              <span>Unterschrift</span>
            </div>
          </footer>
        </article>
      )}
    </main>
  );
}
