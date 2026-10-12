// Lesbare Darstellung der Protokolleinträge einer Bewohnerakte (Server und Browser).
import { PARTICIPATION_STATUS, type ParticipationStatus } from "@/lib/activities-shared";
import { auditTitle } from "./audit-labels";
import { RESUSCITATION_STATUSES, type ResuscitationStatus } from "./resident-record-shared";
import { termsFor, type Terms } from "./terminology";

export type ResidentAuditEntry = {
  id: string;
  createdAt: string;
  actor: string;
  // Gerät, mit dem die Änderung erfasst wurde (z. B. „Safari · iPhone“); ältere Einträge ohne Angabe.
  device?: string | null;
  entityType: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

const ENTITY_LABELS: Record<string, string> = {
  resident: "Stammdaten",
  resident_contact: "Kontaktperson",
  resident_biography: "Biografie",
  resident_photo: "Bewohnerbild",
  body_observation: "Körperbefund",
  resident_supply: "Pflegebedarf",
  resident_document: "Dokument",
  documentation_entry: "Pflegedokumentation",
  care_plan: "Pflegeplan",
  care_goal: "Pflegeziel",
  intervention: "Massnahme",
  wound: "Wunde",
  wound_entry: "Wunddokumentation",
  wound_photo: "Wundfoto",
  vital_measurements: "Vitalwerte",
  vital_threshold: "Vitalwert-Grenzwert",
  medication_order: "Verordnung",
  medication_administration: "Medikamentengabe",
  assessment_record: "Einschätzung",
  rai_assessment: "Abklärung (Kompass)",
  fluid_entry: "Trinkprotokoll",
  meal_entry: "Ernährung",
  nutrition_plan: "Ernährungsplan",
  resident_stay: "Aufenthalt",
  service_record: "Pflegeleistung",
  isolation_measure: "Isolation",
  repositioning_plan: "Lagerungsplan",
  repositioning_entry: "Positionswechsel",
  intervention_proof: "Durchführungsnachweis",
  elimination_entry: "Ausscheidung",
  resident_diagnosis: "Diagnose",
  vaccination: "Impfung",
  resident_belonging: "Hilfsmittel bzw. Gegenstand",
  fund_entry: "Buchung Bewohnergelder",
  care_level: "Pflegestufe",
  resident_absence: "Abwesenheit",
  resident_rate: "Zusätzliche Taxe",
  billing_address: "Rechnungsadresse",
  invoice: "Rechnung",
  invoice_payment: "Zahlung",
  resident_consent: "Einwilligung",
  resident_appointment: "Termin ausser Haus",
  end_of_life_wishes: "Wünsche für die letzte Lebensphase",
  death_checklist: "Ablauf nach dem Todesfall",
  activity_participation: "Teilnahme an Angebot",
};

const ACTION_LABELS: Record<string, string> = {
  created: "angelegt",
  updated: "geändert",
  deleted: "entfernt",
  archived: "archiviert",
  uploaded: "hochgeladen",
  hidden: "ausgeblendet",
  recorded: "erfasst",
  documented: "dokumentiert",
  completed: "abgeschlossen",
  started: "begonnen",
  discarded: "verworfen",
  cancelled: "beendet",
  saved: "gespeichert",
  removed: "entfernt",
  issued: "gebucht",
  admitted: "aufgenommen",
  master_data_updated: "geändert",
  resuscitation_updated: "Reanimationsstatus geändert",
  gender_updated: "Geschlecht geändert",
  medication_allergies_updated: "Allergien geändert",
  prn_administered: "Reservegabe erfasst",
  effect_checked: "Wirkungskontrolle erfasst",
  replaced: "ersetzt",
  evaluated: "evaluiert",
  status_review: "zur Überprüfung markiert",
  status_paused: "pausiert",
  status_completed: "abgeschlossen",
  status_cancelled: "abgebrochen",
  status_active: "wieder eröffnet",
  status_healing: "als heilend markiert",
  status_closed: "abgeschlossen",
};

// Aktionen, die als ganzer Satz lesbarer sind als „<Bereich> <Aktion>“.
const TITLES: Record<string, string> = {
  "medication_administration:prn_administered": "Reservegabe erfasst",
  "medication_administration:effect_checked": "Wirkungskontrolle erfasst",
  "resident:medication_allergies_updated": "Allergien geändert",
  "resident:resuscitation_updated": "Reanimationsstatus geändert",
  "resident:evacuation_updated": "Angaben für den Notfall geändert",
  "resident:advance_care_updated": "Vorsorge geändert",
  "documentation_entry:visit_answered": "Rückmeldung zur Visite erfasst",
  "service_record:created": "Pflegeleistung erfasst",
  "service_record:cancelled": "Pflegeleistung storniert",
  "isolation_measure:created": "Isolation erfasst",
  "isolation_measure:reviewed": "Isolation überprüft",
  "isolation_measure:ended": "Isolation aufgehoben",
  "repositioning_plan:created": "Lagerungsplan festgelegt",
  "repositioning_plan:updated": "Lagerungsplan geändert",
  "repositioning_plan:ended": "Lagerungsplan beendet",
  "repositioning_entry:created": "Positionswechsel erfasst",
  "repositioning_entry:cancelled": "Positionswechsel storniert",
  "intervention_proof:created": "Massnahme wie geplant nachgewiesen",
  "rai_assessment:need_adopted": "Handlungsbedarf aus dem Kompass als Ziel übernommen",
  "intervention_proof:deviation": "Abweichung bei Massnahme dokumentiert",
  "intervention_proof:cancelled": "Nachweis storniert",
  "elimination_entry:created": "Ausscheidung erfasst",
  "elimination_entry:cancelled": "Ausscheidung storniert",
  "resident_consent:recorded": "Einwilligung bzw. Ablehnung erfasst",
  "resident_appointment:departed": "Abfahrt zu einem Termin ausser Haus vermerkt",
  "resident_appointment:returned": "Rückkehr von einem Termin ausser Haus vermerkt",
  "resident_appointment:departure_undone": "Vermerk der Abfahrt zurückgenommen",
  "resident_appointment:return_undone": "Vermerk der Rückkehr zurückgenommen",
  "resident_consent:revoked": "Einwilligung widerrufen",
  "resident_belonging:created": "Hilfsmittel bzw. Gegenstand erfasst",
  "fund_entry:created": "Buchung der Bewohnergelder erfasst",
  "fund_entry:cancelled": "Buchung der Bewohnergelder storniert",
  "care_level:created": "Pflegestufe erfasst",
  "care_level:cancelled": "Pflegestufe storniert",
  "resident_absence:created": "Abwesenheit erfasst",
  "resident_absence:updated": "Abwesenheit geändert",
  "resident_absence:cancelled": "Abwesenheit storniert",
  "resident_rate:created": "Zusätzliche Taxe zugewiesen",
  "resident_rate:updated": "Zusätzliche Taxe beendet",
  "resident_rate:cancelled": "Zusätzliche Taxe storniert",
  "billing_address:updated": "Rechnungsadresse gespeichert",
  "invoice:created": "Rechnung erstellt",
  "invoice:cancelled": "Rechnung storniert",
  "invoice_payment:created": "Zahlung erfasst",
  "invoice_payment:imported": "Zahlung aus der Bankdatei verbucht",
  "invoice_payment:cancelled": "Zahlung storniert",
  "resident_belonging:updated": "Hilfsmittel bzw. Gegenstand geändert",
  "resident_belonging:removed": "Hilfsmittel bzw. Gegenstand nicht mehr vorhanden",
  "vaccination:created": "Impfung erfasst",
  "vaccination:deleted": "Impfung entfernt (Fehleintrag)",
  "resident_diagnosis:created": "Diagnose erfasst",
  "resident_diagnosis:updated": "Diagnose geändert",
  "resident_diagnosis:deleted": "Diagnose entfernt (Fehleintrag)",
  "end_of_life_wishes:created": "Wünsche für die letzte Lebensphase erfasst",
  "end_of_life_wishes:updated": "Wünsche für die letzte Lebensphase geändert",
  "death_checklist:created": "Checkliste nach dem Todesfall übernommen",
  "death_checklist:item_done": "Punkt nach dem Todesfall erledigt",
  "death_checklist:item_reopened": "Punkt nach dem Todesfall wieder geöffnet",
  "activity_participation:recorded": "Teilnahme an Angebot erfasst",
  "resident:admission_planned": "Eintritt geplant",
  "resident:emediplan_read": "eMediplan eingelesen",
  "resident:data_exported": "Auskunft erteilt (Datenexport)",
  "resident:admission_confirmed": "Eintritt bestätigt",
  "resident:admission_cancelled": "Geplanter Eintritt abgesagt",
  "activity_participation:removed": "Teilnahme an Angebot entfernt",
  "resident:gender_updated": "Geschlecht geändert",
  "wound_entry:documented": "Wundverlauf dokumentiert",
};

const FIELD_LABELS: Record<string, string> = {
  fullName: "Name",
  relationship: "Beziehung",
  phone: "Telefon",
  email: "E-Mail",
  isPrimary: "Hauptkontakt",
  isEmergencyContact: "Notfallkontakt",
  kind: "Art",
  label: "Bezeichnung",
  location: "Körperstelle",
  status: "Status",
  notes: "Hinweis",
  itemName: "Artikel",
  category: "Kategorie",
  unit: "Einheit",
  currentQuantity: "Bestand",
  targetQuantity: "Sollbestand",
  gender: "Geschlecht",
  firstName: "Vorname",
  lastName: "Nachname",
  primaryNurseId: "Bezugspflege",
  gpName: "Hausarzt",
  lifeStory: "Lebensgeschichte",
  importantPeople: "Wichtige Menschen",
  dailyRoutines: "Gewohnheiten",
  preferences: "Vorlieben",
  strengths: "Stärken",
  sensitiveTopics: "Sensible Themen",
  place: "Ort",
  companionship: "Begleitung",
  spiritual: "Religiöse oder spirituelle Wünsche",
  funeral: "Bestattung",
  notify: "Wer informiert werden soll",
  otherWishes: "Weitere Wünsche",
  discussedWith: "Besprochen mit",
  discussedOn: "Besprochen am",
  title: "Bezeichnung",
  bodyLocation: "Lokalisation",
  woundType: "Wundart",
  diagnosis: "Diagnose",
  origin: "Entstehung",
  careIntervalDays: "Versorgungsintervall",
  treatmentPlan: "Behandlungsplan",
  responsibleId: "Verantwortlich",
  bodyObservationId: "Körpermarkierung",
  focus: "Pflegefokus",
  careLevel: "Einstufung",
  startsOn: "Beginn",
  reviewOn: "Überprüfung",
  ownerId: "Verantwortlich",
  problem: "Pflegeproblem",
  resources: "Ressourcen",
  statement: "Ziel",
  targetDate: "Überprüfungsdatum",
  instructions: "Anleitung",
  frequency: "Häufigkeit",
  responsibleRole: "Zuständigkeit",
  representativeRole: "Vertretung",
  advanceDirective: "Patientenverfügung",
  advanceDirectiveOn: "Datum der Patientenverfügung",
  advanceDirectiveLocation: "Aufbewahrungsort",
  careMandate: "Vorsorgeauftrag / -vollmacht",
  careMandateOn: "Errichtet am",
  careMandateEffectiveOn: "Wirksam seit",
  icdCode: "ICD-10-Code",
  marking: "Kennzeichnung",
  topic: "Thema",
  decision: "Entscheid",
  decidedBy: "Entschieden von",
  decidedOn: "Datum des Entscheids",
  revokedOn: "Widerrufen am",
  storedAt: "Standort",
  givenOn: "Geimpft am",
  against: "Impfung gegen",
  vaccine: "Präparat",
  lot: "Charge",
  givenBy: "Geimpft von",
  sinceOn: "Seit",
  source: "Quelle",
  resolvedOn: "Abgeschlossen am",
  evacuationMobility: "Mobilität im Notfall",
  evacuationNote: "Hinweise für den Notfall",
};

const NAME_KEYS = ["fullName", "label", "itemName", "title", "name", "metric", "medication", "file"];

function nameOf(data: Record<string, unknown> | null) {
  for (const key of NAME_KEYS) if (typeof data?.[key] === "string" && data[key]) return String(data[key]);
  return "";
}

// Leere Texte und fehlende Werte gelten als gleich (Formulare senden "", die Datenbank speichert NULL).
const normalize = (value: unknown) => (value === "" || value === undefined ? null : value);
const same = (a: unknown, b: unknown) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));

export function describeAudit(entry: ResidentAuditEntry, terms: Terms = termsFor("resident")) {
  const entity = ENTITY_LABELS[entry.entityType];
  const action = ACTION_LABELS[entry.action];
  // Bereiche ausserhalb der Akte (Aufgaben, Übergaben, Portal …) und seltene Aktionen: gemeinsame Bezeichnungen des
  // Änderungsprotokolls, nie technische Schlüssel.
  const title =
    TITLES[`${entry.entityType}:${entry.action}`] ??
    (entity && action ? `${entity} ${action}` : auditTitle(entry.entityType, entry.action, terms));
  const name = nameOf(entry.after) || nameOf(entry.before);
  const details: string[] = [];
  const sections = entry.after?.changedSections;
  if (Array.isArray(sections))
    details.push(
      sections.length
        ? `Abschnitte: ${sections.map((key) => FIELD_LABELS[String(key)] ?? String(key)).join(", ")}`
        : "keine inhaltliche Änderung",
    );
  else if (entry.action === "resuscitation_updated") {
    const status = entry.after?.status as ResuscitationStatus | null | undefined;
    details.push(status && status in RESUSCITATION_STATUSES ? RESUSCITATION_STATUSES[status].label : "nicht erfasst");
    if (entry.after?.source) details.push(`Grundlage: ${String(entry.after.source)}`);
  } else if (entry.before && entry.after) {
    const changed = Object.keys(entry.after).filter(
      // Nur Felder, die vorher ebenfalls festgehalten wurden (ältere Einträge enthalten nicht alle Felder).
      (key) =>
        key !== "residentId" &&
        key in FIELD_LABELS &&
        entry.before !== null &&
        key in entry.before &&
        !same(entry.before[key], entry.after?.[key]),
    );
    if (changed.length) details.push(`Geändert: ${changed.map((key) => FIELD_LABELS[key]).join(", ")}`);
  }
  if (entry.entityType === "activity_participation") {
    const status = entry.after?.status as ParticipationStatus | null | undefined;
    if (status && status in PARTICIPATION_STATUS) details.push(PARTICIPATION_STATUS[status]);
  }
  if (entry.entityType === "resident_supply" && entry.action === "issued" && entry.after?.quantity)
    details.push(`${entry.after.quantity} ${entry.after.unit ?? ""}`.trim());
  return { title, name, detail: details.join(" · ") };
}
