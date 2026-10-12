import { API_SCOPES } from "@/lib/api-keys-shared";
import { COUNTRIES, COUNTRY_CODES } from "@/lib/country";
import { IMPORTANCE } from "@/lib/documentation-shared";
import { EFFECT_RESULTS } from "@/lib/medication-shared";
import { TRAINING_FORMATS } from "@/lib/learning-shared";
import { INTERACTION_SEVERITIES } from "@/lib/medication-interactions-shared";
import { SERVICES } from "@/lib/organization-shared";
import { PERMISSION_LABELS } from "@/lib/permission-labels";
import { PORTAL_AREAS, PORTAL_BASES, PORTAL_KINDS } from "@/lib/portal-shared";
import { EFFECTIVENESS, SEVERITIES } from "@/lib/quality-shared";
import { RESUSCITATION_STATUSES } from "@/lib/resident-record-shared";
import { ADVANCE_ANSWERS, ADVANCE_CARE_LABELS } from "@/lib/advance-care-shared";
import { SERVICE_SOURCES } from "@/lib/services-shared";
import { ISOLATION_KINDS } from "@/lib/hygiene-shared";
import { POSITIONS, SKIN_FINDINGS } from "@/lib/repositioning-shared";
import { ELIMINATION_AMOUNTS, ELIMINATION_KINDS } from "@/lib/elimination-shared";
import { EVACUATION_MOBILITY, type EvacuationMobility } from "@/lib/evacuation-shared";
import { DEVICE_CHECK_RESULTS, type DeviceCheckResult } from "@/lib/devices-shared";
import {
  FEEDBACK_CHANNELS,
  FEEDBACK_KINDS,
  FEEDBACK_SOURCES,
  FEEDBACK_STATUSES,
  type FeedbackChannel,
  type FeedbackKind,
  type FeedbackSource,
  type FeedbackStatus,
} from "@/lib/feedback-shared";
import { CONSENT_DECISIONS, type ConsentDecision } from "@/lib/consents-shared";
import { BELONGING_KINDS, type BelongingKind } from "@/lib/belongings-shared";
import { FUND_KINDS, type FundKind } from "@/lib/funds-shared";
import { VACCINATION_PLACES, type VaccinationPlace } from "@/lib/vaccinations-shared";
import { DIAGNOSIS_KINDS, DIAGNOSIS_STATUSES, type DiagnosisKind, type DiagnosisStatus } from "@/lib/diagnoses-shared";
import { PARTICIPATION_STATUS } from "@/lib/activities-shared";
import { RESTRAINT_CONSENT, RESTRAINT_KINDS, RESTRAINT_REVIEW_OUTCOMES } from "@/lib/restraints-shared";
import { SETTING_DEFINITIONS, type SettingKey } from "@/lib/settings-shared";
import { TASK_PRIORITIES, TASK_RECURRENCE, TASK_STATUS } from "@/lib/tasks-shared";
import { TERMINOLOGIES, type Terms } from "@/lib/terminology";
import { WEBHOOK_EVENTS } from "@/lib/webhooks-shared";
import { ORIGIN_LABELS } from "@/lib/wounds-shared";

// Änderungsprotokoll der Administration: jeder Eintrag (Bereich, Aktion, geänderte Felder) auf Deutsch.
// Technische Schlüssel erscheinen nie: unbekannte Aktionen heissen „geändert“, unbekannte Felder werden nicht gezeigt.
// tests/audit-labels.test.ts prüft, dass jede Aktion, die der Code protokolliert, hier eine Bezeichnung hat.

export const AUDIT_AREAS: Record<string, { area: string; href: string | null }> = {
  organization: { area: "Einrichtung", href: "/leitung/administration/konfiguration" },
  branding: { area: "Branding", href: "/leitung/administration/konfiguration" },
  site: { area: "Standort", href: "/leitung/administration" },
  care_unit: { area: "Wohnbereich", href: "/leitung/administration" },
  user: { area: "Mitarbeiter", href: "/leitung/administration/mitarbeiter" },
  user_mfa: { area: "Zwei-Faktor-Anmeldung", href: "/leitung/administration/mitarbeiter" },
  user_passkey: { area: "Passkey", href: "/einstellungen/security" },
  role: { area: "Rolle", href: "/leitung/administration/mitarbeiter" },
  setting: { area: "Einstellung", href: "/leitung/administration/konfiguration" },
  sso: { area: "Single Sign-on", href: "/leitung/administration/konfiguration" },
  api_key: { area: "API-Schlüssel", href: "/leitung/administration/konfiguration" },
  webhook: { area: "Webhook", href: "/leitung/administration/konfiguration" },
  language: { area: "Sprache", href: "/leitung/administration/konfiguration" },
  translation: { area: "Übersetzung", href: "/leitung/administration/konfiguration" },
  event_types: { area: "Ereignisarten", href: "/leitung/qualitaet" },
  event_workflow: { area: "Ereignis-Ablauf", href: "/leitung/qualitaet" },
  support_request: { area: "Problemmeldung", href: null },
  care_supply_product: { area: "Pflegeprodukt", href: "/leitung/administration/pflegebedarf" },
  resident: { area: "Bewohner", href: "/bewohner" },
  resident_contact: { area: "Kontaktperson", href: "/bewohner" },
  resident_photo: { area: "Bewohnerbild", href: "/bewohner" },
  resident_biography: { area: "Biografie", href: "/bewohner" },
  resident_document: { area: "Dokument", href: "/bewohner" },
  resident_supply: { area: "Pflegebedarf", href: "/bewohner" },
  resident_transfer: { area: "Überleitungsbogen", href: "/bewohner" },
  resident_retention: { area: "Aufbewahrungsfrist", href: "/leitung/administration/konfiguration" },
  body_observation: { area: "Körperbefund", href: "/bewohner" },
  shared_file: { area: "Ablage", href: "/carecore-one/ablage" },
  shared_folder: { area: "Ablage", href: "/carecore-one/ablage" },
  documentation_entry: { area: "Pflegebericht", href: "/pflegedokumentation" },
  care_plan: { area: "Pflegeplan", href: "/pflegeplanung" },
  care_goal: { area: "Pflegeziel", href: "/pflegeplanung" },
  intervention: { area: "Massnahme", href: "/pflegeplanung" },
  medication: { area: "Medikament", href: "/medikation" },
  medication_order: { area: "Verordnung", href: "/medikation" },
  medication_administration: { area: "Medikamentengabe", href: "/medikation/runde" },
  medication_interaction: { area: "Wechselwirkung", href: "/medikation" },
  btm_count: { area: "BtM-Kontrolle", href: "/medikation" },
  pharmacy_order: { area: "Apothekenbestellung", href: "/medikation" },
  vital_measurements: { area: "Vitalwerte", href: "/vitalwerte/entwicklung" },
  vital_threshold: { area: "Vitalwert-Grenze", href: "/vitalwerte/entwicklung" },
  wound: { area: "Wunde", href: "/wundmanagement" },
  wound_entry: { area: "Wundverlauf", href: "/wundmanagement" },
  wound_photo: { area: "Wundfoto", href: "/wundmanagement" },
  quality_event: { area: "Ereignis", href: "/leitung/qualitaet" },
  quality_action: { area: "Qualitätsmassnahme", href: "/leitung/qualitaet/massnahmen" },
  standard: { area: "Pflegestandard", href: "/leitung/qualitaet" },
  document: { area: "Dokument", href: "/leitung/qualitaet" },
  task: { area: "Aufgabe", href: "/betrieb/aufgaben" },
  handover: { area: "Übergabe", href: "/betrieb/uebergabe" },
  shift: { area: "Dienst", href: "/dienstplan" },
  shift_plan: { area: "Dienstplan", href: "/dienstplan" },
  shift_assignment: { area: "Diensteinteilung", href: "/dienstplan" },
  absence: { area: "Abwesenheit", href: "/dienstplan" },
  training: { area: "Schulung", href: "/personal/schulungen" },
  training_enrollment: { area: "Schulung", href: "/personal/schulungen" },
  training_session: { area: "Schulungstermin", href: "/personal/schulungen" },
  training_evidence: { area: "Schulungsnachweis", href: "/personal/schulungen" },
  team_post: { area: "Teambeitrag", href: "/personal/team" },
  team_channel: { area: "Teamkanal", href: "/personal/team" },
  assessment_record: { area: "Einschätzung", href: "/einschaetzungen" },
  rai_assessment: { area: "Abklärung (Kompass)", href: "/kompass/abklaerung" },
  rai_due: { area: "Kompass-Fälligkeiten", href: "/kompass/faelligkeiten" },
  fluid_entry: { area: "Trinkprotokoll", href: "/ernaehrung/trinkprotokoll" },
  meal_entry: { area: "Mahlzeit", href: "/ernaehrung" },
  nutrition_plan: { area: "Ernährungsplan", href: "/ernaehrung" },
  portal_account: { area: "Portalzugang", href: "/leitung/administration/konfiguration" },
  portal_grant: { area: "Portalfreigabe", href: "/bewohner" },
  portal_thread: { area: "Portalnachricht", href: "/bewohner" },
  ai_draft: { area: "KI-Entwurf", href: null },
  ai_search: { area: "KI-Suche", href: null },
  restraint_measure: { area: "Freiheitsbeschränkende Massnahme", href: "/bewohner" },
  service_record: { area: "Pflegeleistung", href: "/pflegedokumentation/leistungen" },
  service_catalog: { area: "Leistungskatalog", href: "/leitung/administration/leistungskatalog" },
  isolation_measure: { area: "Isolation", href: "/bewohner/hygiene" },
  repositioning_plan: { area: "Lagerung", href: "/pflegedokumentation/lagerung" },
  repositioning_entry: { area: "Lagerung", href: "/pflegedokumentation/lagerung" },
  intervention_proof: { area: "Durchführungsnachweis", href: "/pflegedokumentation/nachweis" },
  elimination_entry: { area: "Ausscheidung", href: "/pflegedokumentation/ausscheidung" },
  end_of_life_wishes: { area: "Wünsche am Lebensende", href: "/bewohner" },
  resident_diagnosis: { area: "Diagnose", href: "/bewohner" },
  vaccination: { area: "Impfung", href: "/bewohner" },
  resident_belonging: { area: "Hilfsmittel und Gegenstände", href: "/bewohner" },
  fund_entry: { area: "Bewohnergelder", href: "/bewohner/gelder" },
  fund_count: { area: "Kassenkontrolle", href: "/bewohner/gelder" },
  billing_rate: { area: "Taxen", href: "/bewohner/abrechnung" },
  billing_settings: { area: "Regeln der Abrechnung", href: "/bewohner/abrechnung" },
  care_level: { area: "Pflegestufe", href: "/bewohner/abrechnung" },
  resident_absence: { area: "Abwesenheit", href: "/bewohner/abrechnung" },
  resident_rate: { area: "Zusätzliche Taxe", href: "/bewohner/abrechnung" },
  billing_address: { area: "Rechnungsadresse", href: "/bewohner/abrechnung" },
  invoice: { area: "Rechnung", href: "/bewohner/abrechnung" },
  invoice_payment: { area: "Zahlung", href: "/bewohner/abrechnung" },
  care_goal_template: { area: "Vorlage Pflegeplanung", href: "/pflegeplanung/vorlagen" },
  intervention_template: { area: "Massnahmenkatalog", href: "/pflegeplanung/vorlagen" },
  resident_consent: { area: "Einwilligung", href: "/bewohner/einwilligungen" },
  resident_appointment: { area: "Fahrdienst", href: "/carecore-one/kalender/fahrdienst" },
  device: { area: "Gerät", href: "/leitung/qualitaet/geraete" },
  fridge: { area: "Kühlschrank-Temperatur", href: "/medikation/kuehlschrank" },
  onboarding: { area: "Einarbeitung", href: "/leitung/teamleitung/einarbeitung" },
  feedback: { area: "Rückmeldung", href: "/leitung/qualitaet/rueckmeldungen" },
  death_checklist: { area: "Ablauf nach dem Todesfall", href: "/bewohner" },
  assessment_instrument: { area: "Einschätzungsinstrumente", href: "/leitung/administration/konfiguration" },
  outbreak: { area: "Ausbruch", href: "/bewohner/hygiene" },
  activity: { area: "Angebot", href: "/alltag" },
  activity_participation: { area: "Teilnahme an Angebot", href: "/alltag" },
  waitlist_entry: { area: "Warteliste", href: "/bewohner/belegung" },
  room: { area: "Zimmer", href: "/bewohner/belegung" },
};

// Allgemeine Aktionen: „<Bereich> <Verb>“, z. B. „Rolle erstellt“.
const VERBS: Record<string, string> = {
  create: "erstellt",
  created: "erstellt",
  update: "geändert",
  updated: "geändert",
  edited: "bearbeitet",
  amended: "ergänzt",
  corrected: "korrigiert",
  replaced: "ersetzt",
  copied: "kopiert",
  archived: "archiviert",
  cancelled: "abgesagt",
  completed: "abgeschlossen",
  removed: "entfernt",
  deleted: "gelöscht",
  uploaded: "hochgeladen",
  shared: "geteilt",
  reported: "gemeldet",
  recorded: "erfasst",
  documented: "dokumentiert",
  saved: "gespeichert",
  assigned: "zugewiesen",
  confirmed: "bestätigt",
  requested: "beantragt",
  rejected: "abgelehnt",
  withdrawn: "zurückgezogen",
  planned: "geplant",
  verified: "bestätigt",
  enrolled: "angemeldet",
  acknowledged: "gelesen",
  hidden: "ausgeblendet",
  evaluated: "evaluiert",
  published: "veröffentlicht",
  drafted: "als Entwurf gespeichert",
  versioned: "neue Version",
  issued: "gebucht",
  counted: "durchgeführt",
  escalated: "eskaliert",
  partial: "teilweise erledigt",
  skipped: "nicht erledigt",
  reopened: "wieder geöffnet",
  started: "begonnen",
  answered: "beantwortet",
  pinned: "angeheftet",
  unpinned: "nicht mehr angeheftet",
  imported: "importiert",
  admitted: "aufgenommen",
  activated: "aktiviert",
  deactivated: "deaktiviert",
  revoked: "widerrufen",
  registered: "eingerichtet",
  enabled: "eingeschaltet",
  disabled: "ausgeschaltet",
  reset: "zurückgesetzt",
  refreshed: "aktualisiert",
  asked: "Frage gestellt",
  accepted: "übernommen",
  discarded: "verworfen",
  reviewed: "geprüft",
  released: "freigegeben",
  checked_in: "eingestempelt",
  checked_out: "ausgestempelt",
};

// Aktionen, die als ganzer Satz lesbarer sind ({one} = Bezeichnung der betreuten Person).
const TITLES: Record<string, string> = {
  "shared_file:deleted": "Datei in den Papierkorb verschoben",
  "shared_file:restored": "Datei aus dem Papierkorb wiederhergestellt",
  "shared_file:purged": "Datei endgültig gelöscht",
  "shared_file:moved": "Datei verschoben",
  "shared_file:copied": "Datei kopiert",
  "shared_file:versioned": "Neue Version der Datei gespeichert",
  "shared_file:version_restored": "Frühere Version der Datei wiederhergestellt",
  "shared_folder:created": "Ordner angelegt",
  "shared_folder:renamed": "Ordner umbenannt",
  "shared_folder:moved": "Ordner verschoben",
  "shared_folder:deleted": "Ordner in den Papierkorb verschoben",
  "shared_folder:restored": "Ordner aus dem Papierkorb wiederhergestellt",
  "shared_folder:purged": "Ordner endgültig gelöscht",
  "organization:country_updated": "Land und Region der Einrichtung geändert",
  "organization:setup_dismissed": "Checkliste der Ersteinrichtung ausgeblendet",
  "organization:setup_shown": "Checkliste der Ersteinrichtung eingeblendet",
  "branding:logo_updated": "Logo der Einrichtung hochgeladen",
  "branding:logo_removed": "Logo der Einrichtung entfernt",
  "branding:name_updated": "Name der Einrichtung geändert",
  "user:lock": "Mitarbeiter gesperrt und archiviert",
  "user:restore": "Mitarbeiter wieder aktiviert",
  "user:password_changed": "Eigenes Passwort geändert",
  "user:password_link_sent": "Link zum Setzen des Passworts gesendet",
  "user:password_reset_requested": "Neues Passwort angefordert",
  "user:password_set_by_link": "Passwort über Link gesetzt",
  "user:sessions_ended": "Alle Sitzungen beendet",
  "user:sso_login": "Anmeldung über Single Sign-on",
  "user_mfa:enabled": "Zwei-Faktor-Anmeldung eingerichtet",
  "user_mfa:disabled": "Zwei-Faktor-Anmeldung ausgeschaltet",
  "user_mfa:reset": "Zwei-Faktor-Anmeldung zurückgesetzt",
  "user_mfa:recovery_regenerated": "Neue Wiederherstellungscodes erstellt",
  "sso:sso_settings_saved": "Single Sign-on gespeichert",
  "api_key:api_key_created": "API-Schlüssel erstellt",
  "api_key:api_key_revoked": "API-Schlüssel widerrufen",
  "api_key:api_read": "Daten über die API abgerufen",
  "webhook:webhook_created": "Webhook angelegt",
  "webhook:webhook_deleted": "Webhook entfernt",
  "language:ai_drafted": "Sprache von der KI übersetzt",
  "language:reviewed_page": "Übersetzungen einer Seite geprüft",
  "language:released": "Sprache freigegeben",
  "language:withdrawn": "Sprache zurückgezogen",
  "resident:master_data_updated": "Stammdaten geändert",
  "resident:master_data_checked": "Stammdaten geprüft",
  "resident:medication_allergies_updated": "Allergien geändert",
  "resident:resuscitation_updated": "Reanimationsstatus geändert",
  "resident:evacuation_updated": "Angaben für den Notfall geändert",
  "resident:room_changed": "Zimmer gewechselt",
  "resident:advance_care_updated": "Vorsorge geändert",
  "documentation_entry:visit_answered": "Rückmeldung zur Visite erfasst",
  "resident:gender_updated": "Geschlecht geändert",
  "resident:imported": "{one} importiert",
  "resident:admitted": "{one} aufgenommen",
  "resident:admission_planned": "Eintritt geplant",
  "resident:emediplan_read": "eMediplan eingelesen",
  "resident:data_exported": "Auskunft erteilt (Datenexport)",
  "resident:admission_confirmed": "Eintritt bestätigt",
  "resident:admission_cancelled": "Geplanter Eintritt abgesagt",
  "waitlist_entry:created": "Eintrag auf der Warteliste erfasst",
  "waitlist_entry:updated": "Eintrag der Warteliste geändert",
  "waitlist_entry:status_waiting": "Warteliste: wartet wieder",
  "waitlist_entry:status_offered": "Warteliste: Platz angeboten",
  "waitlist_entry:status_withdrawn": "Warteliste: zurückgezogen",
  "waitlist_entry:admitted": "Warteliste: Eintritt geplant",
  "waitlist_entry:deleted": "Anfrage der Warteliste nach Ablauf der Aufbewahrungsfrist gelöscht",
  "room:created": "Zimmer angelegt",
  "room:updated": "Zimmer geändert",
  "resident_retention:deleted": "Akte nach Ablauf der Aufbewahrungsfrist gelöscht",
  "resident_transfer:created": "Überleitungsbogen erstellt",
  "medication:btm_marked": "Als Betäubungsmittel gekennzeichnet",
  "medication:btm_unmarked": "BtM-Kennzeichnung entfernt",
  "medication_administration:prn_administered": "Reservegabe erfasst",
  "medication_administration:effect_checked": "Wirkungskontrolle erfasst",
  "training_enrollment:quiz_passed": "Quiz bestanden",
  "training_enrollment:quiz_failed": "Quiz nicht bestanden",
  "rai_due:refreshed": "Kompass-Fälligkeiten aktualisiert",
  "portal_account:password_reset": "Portal-Passwort zurückgesetzt",
  "portal_thread:started": "Portalnachricht begonnen",
  "ai_search:asked": "Frage an die KI-Suche",
  "support_request:reported": "Problem gemeldet",
  "restraint_measure:created": "Freiheitsbeschränkende Massnahme erfasst",
  "restraint_measure:updated": "Freiheitsbeschränkende Massnahme geändert",
  "restraint_measure:reviewed": "Freiheitsbeschränkende Massnahme überprüft",
  "restraint_measure:ended": "Freiheitsbeschränkende Massnahme beendet",
  "service_record:created": "Pflegeleistung erfasst",
  "service_record:cancelled": "Pflegeleistung storniert",
  "service_catalog:created": "Leistung im Katalog angelegt",
  "service_catalog:updated": "Leistung im Katalog geändert",
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
  "device:created": "Gerät erfasst",
  "device:updated": "Gerät geändert",
  "device:checked": "Prüfung eines Geräts erfasst",
  "device:retired": "Gerät ausser Betrieb genommen",
  "fridge:created": "Kühlschrank erfasst",
  "fridge:updated": "Kühlschrank geändert",
  "fridge:measured": "Temperatur eines Kühlschranks gemessen",
  "fridge:retired": "Kühlschrank ausser Betrieb genommen",
  "onboarding:started": "Einarbeitung gestartet",
  "onboarding:step_signed": "Punkt der Einarbeitung abgezeichnet",
  "onboarding:step_reopened": "Punkt der Einarbeitung zurückgenommen",
  "onboarding:completed": "Einarbeitung abgeschlossen",
  "feedback:recorded": "Rückmeldung erfasst",
  "feedback:updated": "Rückmeldung bearbeitet",
  "feedback:answered": "Antwort auf eine Rückmeldung festgehalten",
  "feedback:closed": "Rückmeldung abgeschlossen",
  "feedback:reopened": "Rückmeldung wieder geöffnet",
  "resident_consent:recorded": "Einwilligung bzw. Ablehnung erfasst",
  "resident_appointment:departed": "Abfahrt zu einem Termin ausser Haus vermerkt",
  "resident_appointment:returned": "Rückkehr von einem Termin ausser Haus vermerkt",
  "resident_appointment:departure_undone": "Vermerk der Abfahrt zurückgenommen",
  "resident_appointment:return_undone": "Vermerk der Rückkehr zurückgenommen",
  "resident_consent:revoked": "Einwilligung widerrufen",
  "resident_belonging:created": "Hilfsmittel bzw. Gegenstand erfasst",
  "fund_entry:created": "Buchung der Bewohnergelder erfasst",
  "fund_entry:cancelled": "Buchung der Bewohnergelder storniert",
  "fund_count:created": "Kassenkontrolle erfasst",
  "billing_rate:created": "Taxe erfasst",
  "billing_rate:updated": "Taxe geändert",
  "billing_rate:price_set": "Preis einer Taxe festgelegt",
  "billing_rate:archived": "Taxe nicht mehr verwendet",
  "billing_settings:updated": "Regel zum Austrittstag festgelegt",
  "billing_settings:payment_details": "Zahlungsangaben der Einrichtung geändert",
  "billing_address:updated": "Rechnungsadresse gespeichert",
  "invoice:created": "Rechnung erstellt",
  "invoice:cancelled": "Rechnung storniert",
  "invoice_payment:created": "Zahlung erfasst",
  "invoice_payment:imported": "Zahlung aus der Bankdatei verbucht",
  "invoice_payment:cancelled": "Zahlung storniert",
  "care_goal_template:created": "Vorlage für die Pflegeplanung erfasst",
  "care_goal_template:updated": "Vorlage für die Pflegeplanung geändert",
  "care_goal_template:archived": "Vorlage für die Pflegeplanung nicht mehr verwendet",
  "intervention_template:created": "Massnahme in den Katalog aufgenommen",
  "intervention_template:updated": "Massnahme im Katalog geändert",
  "intervention_template:archived": "Massnahme aus dem Katalog genommen",
  "care_level:created": "Pflegestufe erfasst",
  "care_level:cancelled": "Pflegestufe storniert",
  "resident_absence:created": "Abwesenheit erfasst",
  "resident_absence:updated": "Abwesenheit geändert",
  "resident_absence:cancelled": "Abwesenheit storniert",
  "resident_rate:created": "Zusätzliche Taxe zugewiesen",
  "resident_rate:updated": "Zusätzliche Taxe beendet",
  "resident_rate:cancelled": "Zusätzliche Taxe storniert",
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
  "assessment_instrument:created": "Eigenes Einschätzungsinstrument angelegt",
  "assessment_instrument:updated": "Eigenes Einschätzungsinstrument geändert",
  "assessment_instrument:versioned": "Neue Fassung eines eigenen Einschätzungsinstruments",
  "assessment_instrument:deactivated": "Eigenes Einschätzungsinstrument nicht mehr angeboten",
  "outbreak:declared": "Ausbruch erfasst",
  "outbreak:updated": "Ausbruch geändert",
  "outbreak:ended": "Ausbruch beendet",
  "activity:created": "Angebot geplant",
  "activity:updated": "Angebot geändert",
  "activity:cancelled": "Angebot abgesagt",
  "activity_participation:recorded": "Teilnahme an Angebot erfasst",
  "activity_participation:removed": "Teilnahme an Angebot entfernt",
  "pharmacy_order:cancelled": "Apothekenbestellung storniert",
  "training_enrollment:enrolled": "Zur Schulung angemeldet",
  "training_enrollment:withdrawn": "Von der Schulung abgemeldet",
  "training_enrollment:verified": "Schulungsteilnahme bestätigt",
  "standard:versioned": "Neue Version des Pflegestandards",
  "document:versioned": "Neue Version des Dokuments",
  "standard:acknowledged": "Pflegestandard als gelesen bestätigt",
  "document:acknowledged": "Dokument als gelesen bestätigt",
};

const STAYS: Record<string, string> = {
  discharged: "Austritt",
  returned: "Rückkehr",
  transferred: "Verlegung",
  deceased: "Todesfall",
  hospital: "Spitalaufenthalt",
  absent: "Abwesenheit",
};

// Statuswechsel als Partizip: „Pflegeplan abgeschlossen“.
const STATUS_VERBS: Record<string, string> = {
  active: "wieder aktiviert",
  open: "wieder geöffnet",
  investigating: "in Prüfung",
  in_progress: "in Bearbeitung",
  planned: "geplant",
  done: "erledigt",
  completed: "abgeschlossen",
  resolved: "Massnahmen umgesetzt",
  closed: "abgeschlossen",
  paused: "pausiert",
  stopped: "abgesetzt",
  cancelled: "abgebrochen",
  healed: "abgeheilt",
  healing: "als heilend markiert",
  review: "zur Überprüfung markiert",
  archived: "archiviert",
  achieved: "erreicht",
  not_achieved: "nicht erreicht",
};

const fill = (text: string, terms: Terms) => text.replaceAll("{one}", terms.one);

export function auditArea(entityType: string, terms: Terms) {
  const area = AUDIT_AREAS[entityType]?.area ?? "Eintrag";
  return area === "Bewohner" ? terms.one : area;
}

// Überschrift eines Eintrags, z. B. „Land und Region der Einrichtung geändert“ oder „Rolle erstellt“.
export function auditTitle(entityType: string, action: string, terms: Terms) {
  const area = auditArea(entityType, terms);
  if (entityType === "setting") return "Einstellung geändert";
  const title = TITLES[`${entityType}:${action}`];
  if (title) return fill(title, terms);
  if (action.startsWith("status_")) return `${area} ${STATUS_VERBS[action.slice(7)] ?? "Status geändert"}`;
  if (action.startsWith("stay_")) return `Aufenthalt: ${STAYS[action.slice(5)] ?? "geändert"}`;
  return `${area} ${VERBS[action] ?? "geändert"}`;
}

// Hat diese Aktion eine eigene deutsche Bezeichnung? (für den Test, der alle protokollierten Aktionen prüft)
export const auditActionKnown = (entityType: string, action: string) =>
  entityType === "setting" ||
  `${entityType}:${action}` in TITLES ||
  (action.startsWith("status_") && action.slice(7) in STATUS_VERBS) ||
  (action.startsWith("stay_") && action.slice(5) in STAYS) ||
  action in VERBS;

const EXTRA_SETTINGS: Record<string, string> = {
  hidden_vitals: "Erfasste Vitalwerte",
  death_checklist: "Checkliste nach einem Todesfall",
  consent_topics: "Themen der Einwilligungen",
  insurers: "Liste der Versicherungen",
  activity_leaders: "Leitung von Angeboten",
  onboarding_checklist: "Checkliste der Einarbeitung",
  feedback_response_days: "Antwortfrist für Rückmeldungen",
  terminology: "Bezeichnung der betreuten Personen",
};

export const auditSettingTitle = (key: string) =>
  SETTING_DEFINITIONS[key as SettingKey]?.title ?? EXTRA_SETTINGS[key] ?? "Einstellung";

// Felder, die das Protokoll zeigt. Alles andere (technische Kennungen, Dateitypen, Zwischenwerte) bleibt verborgen.
const FIELDS: Record<string, string> = {
  folder: "Ordner",
  from: "Vorlage bzw. frühere Version",
  advanceDirective: "Patientenverfügung",
  advanceDirectiveOn: "Patientenverfügung vom",
  evacuationMobility: "Mobilität im Notfall",
  evacuationNote: "Hinweise für den Notfall",
  advanceDirectiveLocation: "Aufbewahrungsort",
  careMandate: "Vorsorgeauftrag / -vollmacht",
  careMandateOn: "Errichtet am",
  careMandateEffectiveOn: "Wirksam seit",
  representativeRole: "Vertretungsberechtigt als",
  alternatives: "Geprüfte mildere Massnahmen",
  orderedBy: "Angeordnet von",
  residentConsent: "Haltung der Person",
  residentInformed: "Person vorab informiert",
  representativeName: "Vertretung",
  representativeInformedOn: "Vertretung informiert am",
  approvalReference: "Genehmigung / Meldung",
  startsAt: "Beginn",
  plannedUntil: "Geplantes Ende",
  schedule: "Zeitraum",
  name: "Bezeichnung",
  title: "Titel",
  code: "Kürzel",
  floor: "Etage",
  capacity: "Kapazität",
  services: "Dienste",
  notes: "Hinweis",
  note: "Notiz",
  reason: "Begründung",
  intervalMinutes: "Intervall (Minuten)",
  requestedBy: "Verlangt von",
  position: "Position",
  skin: "Hautbefund",
  bristol: "Stuhlform (Bristol)",
  volume: "Menge",
  material: "Material",
  description: "Beschreibung",
  active: "Aktiv",
  enabled: "Eingeschaltet",
  value: "Wert",
  hidden: "Ausgeblendet",
  items: "Punkte",
  person: "Person",
  sourceName: "Name",
  contact: "Kontakt",
  channel: "Weg",
  receivedOn: "Eingegangen am",
  response: "Antwort",
  answeredOn: "Beantwortet am",
  days: "Tage",
  mentor: "Einarbeitung durch",
  item: "Punkt",
  label: "Bezeichnung",
  icdCode: "ICD-10-Code",
  marking: "Kennzeichnung",
  inventoryNumber: "Inventarnummer",
  manufacturer: "Hersteller / Modell",
  intervalMonths: "Prüffrist (Monate)",
  minCelsius: "Untere Grenze (°C)",
  maxCelsius: "Obere Grenze (°C)",
  intervalHours: "Messrhythmus (Stunden)",
  celsius: "Temperatur (°C)",
  measuredAt: "Gemessen am",
  outside: "Ausserhalb der Grenzen",
  checkedOn: "Geprüft am",
  findings: "Mängel",
  performedBy: "Geprüft von",
  topic: "Thema",
  topics: "Themen",
  insurers: "Versicherungen",
  leaders: "Leitung",
  insurer: "Versicherung",
  decision: "Entscheid",
  decidedBy: "Entschieden von",
  revokedOn: "Widerrufen am",
  storedAt: "Standort",
  givenOn: "Geimpft am",
  against: "Impfung gegen",
  vaccine: "Präparat",
  lot: "Charge",
  place: "Ort",
  givenBy: "Geimpft von",
  sinceOn: "Seit",
  resolvedOn: "Abgeschlossen am",
  leadId: "Leitung",
  managerId: "Leitung",
  siteType: "Standorttyp",
  country: "Land",
  region: "Kanton / Bundesland",
  addressLine1: "Adresse",
  postalCode: "PLZ",
  city: "Ort",
  status: "Status",
  role: "Rolle",
  roles: "Rollen",
  category: "Kategorie",
  unit: "Einheit",
  stock: "Bestand",
  minStock: "Mindestbestand",
  quantity: "Menge",
  displayName: "Name",
  fullName: "Name",
  firstName: "Vorname",
  lastName: "Nachname",
  username: "Benutzername",
  email: "E-Mail",
  phone: "Telefon",
  jobTitle: "Funktion",
  permissions: "Berechtigungen",
  medicationRequiresQualification: "Medikation nur mit Qualifikation",
  primaryCareUnitId: "Stammwohnbereich",
  careUnitId: "Wohnbereich",
  room: "Zimmer",
  ownerId: "Verantwortlich",
  responsibleId: "Verantwortlich",
  assignedTo: "Zugewiesen an",
  primaryNurseId: "Bezugspflege",
  assessorId: "Erfasst von",
  priority: "Priorität",
  importance: "Wichtigkeit",
  severity: "Schweregrad",
  type: "Art",
  kind: "Art",
  effectiveness: "Wirksamkeit",
  result: "Ergebnis",
  outcome: "Ergebnis",
  resolution: "Lösung",
  origin: "Entstehung",
  woundType: "Wundart",
  bodyLocation: "Lokalisation",
  diagnosis: "Diagnose",
  focus: "Pflegefokus",
  problem: "Pflegeproblem",
  resources: "Ressourcen",
  statement: "Ziel",
  frequency: "Häufigkeit",
  instructions: "Anleitung",
  startsOn: "Beginn",
  startOn: "Beginn",
  endOn: "Ende",
  reviewOn: "Überprüfung",
  reviewDueOn: "Überprüfung fällig",
  dueOn: "Fällig am",
  dueAt: "Fällig am",
  targetDate: "Zieldatum",
  nextDueOn: "Nächste Fälligkeit",
  assessedOn: "Erfasst am",
  decidedOn: "Entschieden am",
  validFrom: "Gültig ab",
  validUntil: "Gültig bis",
  validFor: "Gültigkeit (Monate)",
  instrument: "Instrument",
  score: "Punkte",
  risk: "Risiko",
  progress: "Fortschritt (%)",
  metric: "Vitalwert",
  targetLower: "Zielbereich unten",
  targetUpper: "Zielbereich oben",
  criticalLower: "Kritisch unten",
  criticalUpper: "Kritisch oben",
  amount: "Dosis",
  amountMl: "Menge (ml)",
  route: "Verabreichung",
  times: "Zeiten",
  isPrn: "Reservemedikation",
  indication: "Indikation",
  strength: "Stärke",
  substanceA: "Wirkstoff A",
  substanceB: "Wirkstoff B",
  recommendation: "Empfehlung",
  source: "Quelle",
  version: "Fassung",
  minutes: "Minuten",
  performedAt: "Erbracht am",
  cancelReason: "Grund der Stornierung",
  defaultMinutes: "Vorschlag Minuten",
  precautions: "Hygienemassnahmen",
  measures: "Massnahmen",
  authorityReportedOn: "Meldung an die Behörde",
  authorityNote: "Notiz zur Meldung",
  durationMinutes: "Dauer (Minuten)",
  beds: "Betten",
  desiredFrom: "Gewünschter Eintritt",
  registeredOn: "Angemeldet am",
  admittedOn: "Eintritt",
  location: "Ort",
  leader: "Leitung des Angebots",
  repeatWeeks: "Wöchentlich (Anzahl)",
  witness: "Zeuge",
  amountCents: "Betrag",
  countedCents: "Gezählter Betrag",
  bookedOn: "Gebucht am",
  purpose: "Zweck",
  party: "Von bzw. an",
  receipt: "Beleg-Nr.",
  expected: "Soll",
  counted: "Gezählt",
  difference: "Differenz",
  meal: "Mahlzeit",
  portionPercent: "Portion (%)",
  diet: "Kostform",
  texture: "Konsistenz",
  allergies: "Allergien",
  medication_allergies: "Allergien",
  gender: "Geschlecht",
  language: "Sprache",
  locale: "Sprache",
  areas: "Bereiche",
  basis: "Grundlage",
  basisNote: "Vermerk",
  scopes: "Zugriff",
  events: "Ereignisse",
  url: "Adresse",
  issuer: "Anbieter",
  clientId: "Client-ID",
  buttonLabel: "Beschriftung",
  secretChanged: "Geheimnis geändert",
  sessions: "Beendete Sitzungen",
  bytes: "Grösse",
  sizeBytes: "Grösse",
  file: "Datei",
  count: "Anzahl",
  rows: "Werte",
  residents: "Personen im Bereich",
  questionLength: "Länge der Frage (Zeichen)",
  retentionYears: "Aufbewahrungsfrist (Jahre)",
  exitedOn: "Austritt",
  retentionMonths: "Aufbewahrungsfrist (Monate)",
  closedOn: "Abgeschlossen am",
  sections: "Abschnitte",
  custom: "Eigene Ereignisarten",
  steps: "Schritte",
  publish: "Veröffentlicht",
  versionNo: "Version",
  requiresAck: "Lesebestätigung nötig",
  mandatory: "Pflichtschulung",
  format: "Format",
  duration: "Dauer (Minuten)",
  percent: "Ergebnis (%)",
  passPercent: "Bestehensgrenze (%)",
  correct: "Richtig",
  total: "Fragen",
  recurrence: "Wiederholung",
  remind: "Erinnerung",
  target: "Übersetzung",
};

// Nur diese Felder dürfen Personen- und Bereichs-Kennungen enthalten; sie werden zu Namen aufgelöst.
const REFERENCE_FIELDS = new Set([
  "leadId",
  "managerId",
  "primaryCareUnitId",
  "careUnitId",
  "ownerId",
  "responsibleId",
  "assignedTo",
  "primaryNurseId",
  "assessorId",
]);

const pick = (labels: Record<string, string | { label: string }>) => (value: string) => {
  const label = labels[value];
  return label === undefined ? undefined : typeof label === "string" ? label : label.label;
};
const short = (label: string) => label.replace(/\s*\(.*\)$/, "");

const languageName = (code: string) => {
  try {
    return new Intl.DisplayNames(["de"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
};

const regionNames = new Map(
  COUNTRY_CODES.flatMap((code) => COUNTRIES[code].region.options.map((option) => [option.code, option.name] as const)),
);

const STATUS_VALUES: Record<string, string> = {
  ...TASK_STATUS,
  active: "Aktiv",
  inactive: "Inaktiv",
  open: "Offen",
  planned: "Geplant",
  done: "Erledigt",
  resolved: "Massnahmen umgesetzt",
  investigating: "In Prüfung",
  closed: "Abgeschlossen",
  paused: "Pausiert",
  stopped: "Abgesetzt",
  healing: "Heilend",
  review: "Zur Überprüfung",
  archived: "Archiviert",
  achieved: "Erreicht",
  not_achieved: "Nicht erreicht",
  draft: "Entwurf",
  accept: "Übernommen",
  administered: "Verabreicht",
  refused: "Verweigert",
  missed: "Ausgelassen",
  held: "Pausiert",
  ...PARTICIPATION_STATUS,
  waiting: "Wartet",
  offered: "Platz angeboten",
  withdrawn: "Zurückgezogen",
};

const VALUE_LABELS: Record<string, (value: string) => string | undefined> = {
  status: pick(STATUS_VALUES),
  severity: (value) =>
    pick(SEVERITIES)(value) ??
    pick(INTERACTION_SEVERITIES)(value) ??
    ({ high: "Hoch", low: "Gering", medium: "Mittel" } as Record<string, string>)[value],
  risk: pick({ high: "Hoch", medium: "Mittel", low: "Gering", none: "Kein Risiko" }),
  priority: pick(TASK_PRIORITIES),
  importance: pick(IMPORTANCE),
  effectiveness: pick(EFFECTIVENESS),
  result: pick(EFFECT_RESULTS),
  outcome: pick({
    ...EFFECTIVENESS,
    achieved: "Erreicht",
    not_achieved: "Nicht erreicht",
    ongoing: "Weiter verfolgen",
    ...RESTRAINT_REVIEW_OUTCOMES,
  }),
  residentConsent: pick(RESTRAINT_CONSENT),
  advanceDirective: pick(ADVANCE_ANSWERS),
  careMandate: pick(ADVANCE_ANSWERS),
  evacuationMobility: (value) => EVACUATION_MOBILITY[value as EvacuationMobility]?.label,
  representativeRole: pick(ADVANCE_CARE_LABELS.CH.roles),
  origin: pick(ORIGIN_LABELS),
  kind: pick({
    ...PORTAL_KINDS,
    ...RESTRAINT_KINDS,
    ...ISOLATION_KINDS,
    ...ELIMINATION_KINDS,
    document: "Dokument",
    standard: "Pflegestandard",
  }),
  basis: pick(PORTAL_BASES),
  position: pick(POSITIONS),
  skin: pick(SKIN_FINDINGS),
  volume: pick(ELIMINATION_AMOUNTS),
  areas: (value) => {
    const label = pick(PORTAL_AREAS)(value);
    return label === undefined ? undefined : short(label);
  },
  permissions: pick(PERMISSION_LABELS),
  scopes: (value) => {
    const label = pick(API_SCOPES)(value);
    return label === undefined ? undefined : short(label);
  },
  events: (value) => {
    const label = pick(WEBHOOK_EVENTS)(value);
    return label === undefined ? undefined : short(label);
  },
  services: pick(SERVICES),
  recurrence: pick(TASK_RECURRENCE),
  source: pick(SERVICE_SOURCES),
  country: (value) => COUNTRIES[value as keyof typeof COUNTRIES]?.name,
  region: (value) => regionNames.get(value),
  gender: pick({ female: "weiblich", male: "männlich", diverse: "divers", unspecified: "nicht angegeben" }),
  language: languageName,
  locale: languageName,
  format: pick(TRAINING_FORMATS),
};

const RESUSCITATION = pick(RESUSCITATION_STATUSES);
const TERMINOLOGY = pick(TERMINOLOGIES);
const DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function date(value: string) {
  const at = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(at.getTime())) return value;
  const day = at.toLocaleDateString("de-CH", { timeZone: value.length === 10 ? "UTC" : "Europe/Zurich" });
  const midnight = value.length === 10 || /T00:00:00(\.000)?Z$/.test(value);
  if (midnight) return at.toLocaleDateString("de-CH", { timeZone: "UTC" });
  return `${day}, ${at.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" })}`;
}

const size = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

// Lesbarer Wert eines Feldes; null heisst: nicht anzeigen (z. B. verschachtelte Daten).
function show(field: string, value: unknown, context: { entityType: string; action: string }): string | null {
  if (value === null || value === undefined || value === "") return "–";
  if (field === "enabled" && typeof value === "boolean") return value ? "eingeschaltet" : "ausgeschaltet";
  if (typeof value === "boolean") return value ? "ja" : "nein";
  if ((field === "bytes" || field === "sizeBytes") && typeof value === "number") return size(value);
  // Beträge der Bewohnergelder in Rappen bzw. Cent gespeichert.
  if (field.endsWith("Cents") && typeof value === "number")
    return (value / 100).toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (typeof value === "number") return value.toLocaleString("de-CH");
  if (Array.isArray(value)) {
    if (value.some((item) => item !== null && typeof item === "object")) return null;
    const items = value.map((item) => show(field, item, context));
    return items.every((item) => item !== null) ? items.join(", ") || "–" : null;
  }
  if (typeof value === "object") return null;
  const text = String(value);
  if (context.entityType === "resident" && context.action === "resuscitation_updated" && field === "status")
    return RESUSCITATION(text) ?? "nicht erfasst";
  if (context.entityType === "feedback" && field === "kind") return FEEDBACK_KINDS[text as FeedbackKind] ?? text;
  if (context.entityType === "feedback" && field === "source") return FEEDBACK_SOURCES[text as FeedbackSource] ?? text;
  if (context.entityType === "feedback" && field === "channel")
    return FEEDBACK_CHANNELS[text as FeedbackChannel] ?? text;
  if (context.entityType === "feedback" && field === "status") return FEEDBACK_STATUSES[text as FeedbackStatus] ?? text;
  if (context.entityType === "fund_entry" && field === "kind") return FUND_KINDS[text as FundKind] ?? text;
  if (context.entityType === "device" && field === "result")
    return DEVICE_CHECK_RESULTS[text as DeviceCheckResult] ?? text;
  if (context.entityType === "resident_consent" && field === "decision")
    return CONSENT_DECISIONS[text as ConsentDecision] ?? text;
  if (context.entityType === "resident_belonging" && field === "kind")
    return BELONGING_KINDS[text as BelongingKind] ?? text;
  if (context.entityType === "vaccination" && field === "place")
    return VACCINATION_PLACES[text as VaccinationPlace] ?? text;
  if (context.entityType === "resident_diagnosis" && field === "status")
    return DIAGNOSIS_STATUSES[text as DiagnosisStatus] ?? text;
  if (context.entityType === "resident_diagnosis" && field === "kind")
    return DIAGNOSIS_KINDS[text as DiagnosisKind] ?? text;
  if (context.entityType === "setting" && context.action === "terminology" && field === "value")
    return TERMINOLOGY(text) ?? text;
  const label = VALUE_LABELS[field]?.(text);
  if (label !== undefined) return label;
  if (DATE.test(text)) return date(text);
  return text.slice(0, 80);
}

const SKIP_ALWAYS = new Set(["id", "organization_id", "created_at", "updated_at", "created_by", "updated_by"]);

// Normalisiert snake_case und camelCase, damit vorher (Zeile) und nachher (Eingabe) vergleichbar sind.
const norm = (key: string) => key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

export type AuditChange = { field: string; before: string; after: string };

// Deutsche Bezeichnung eines Feldes (Auskunft, Protokoll); null, wenn keine hinterlegt ist.
export function fieldLabel(key: string) {
  return FIELDS[key] ?? FIELDS[norm(key)] ?? null;
}

// Wert eines Feldes in lesbarer Form (Auswahlwerte, Datum, ja/nein); null bei verschachtelten Angaben.
export function fieldValue(key: string, value: unknown) {
  return show(FIELDS[key] ? key : norm(key), value, { entityType: "", action: "" });
}

export function auditChanges(entityType: string, action: string, before: unknown, after: unknown): AuditChange[] {
  const b = before && typeof before === "object" ? (before as Record<string, unknown>) : null;
  const a = after && typeof after === "object" ? (after as Record<string, unknown>) : null;
  const source = a ?? b;
  if (!source) return [];
  const previous = new Map(Object.entries(b ?? {}).map(([key, value]) => [norm(key), value]));
  const context = { entityType, action };
  const result: AuditChange[] = [];
  for (const [rawKey, value] of Object.entries(source)) {
    const key = FIELDS[rawKey] ? rawKey : norm(rawKey);
    const label = FIELDS[key];
    if (!label || SKIP_ALWAYS.has(rawKey)) continue;
    if (UUID.test(String(value ?? "")) && !REFERENCE_FIELDS.has(key)) continue;
    const now = a ? show(key, value, context) : "–";
    const was = a ? (b ? show(key, previous.get(norm(rawKey)), context) : "–") : show(key, value, context);
    if (now === null || was === null) continue;
    if (a && b && now === was) continue;
    if (!(a && b) && now === "–" && was === "–") continue;
    result.push({ field: label, before: was, after: a ? now : "–" });
    if (result.length === 8) break;
  }
  return result;
}
