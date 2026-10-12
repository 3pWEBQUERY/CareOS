# To-do-Liste

Abgleich des Projekts mit dem **CareOS PRD v1.0** (Stand 29.09.2026). Die frühere Liste (PR #35–#47) ist
abgeschlossen; Erledigtes steht im README und in den Pull Requests.

Legende: ✅ vorhanden · 🟡 teilweise · ❌ fehlt

## Abgleich je PRD-Bereich

| PRD-Bereich                  | Stand | Befund im Code                                                                                                                                                                       |
| ---------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Home „One Shift. One Screen“ | ✅    | Startseite `/c` mit Widgets, Notizen, Schnellzugriff, Zeitleiste; Tagesliste gefiltert nach Kritisch / Wichtig / Routine.                                                            |
| Bewohner-Kopfbereich         | ✅    | Akte mit Übersicht, Verlauf, Körperstatus, Dokumenten und Reanimationsstatus im Aktenkopf.                                                                                           |
| Resident Timeline            | ✅    | `bewohner/verlauf`, `lib/resident-history.ts`.                                                                                                                                       |
| Plan                         | ✅    | Pflegeplanung mit Zielen, Massnahmen, Evaluation, Einschätzungen. Keine regelbasierten Vorschläge aus Einschätzungen.                                                                |
| Chart / Schnelldoku          | ✅    | Doku, Nachträge, Schnelldokumentation, Abschluss aus Aufgaben mit ✓ △ ✕, Diktieren mit Erkennung auf dem Gerät.                                                                      |
| Handover                     | ✅    | Übergabe, „Seit meinem letzten Dienst“, Lesebestätigung (`carecore_handover_reads`).                                                                                                 |
| Tasks                        | ✅    | Offen, in Bearbeitung, eskaliert, erledigt, teilweise, nicht erledigt, abgebrochen; überfällig berechnet.                                                                            |
| Med                          | ✅    | Runde, Reserve (PRN), BtM, Bestand, Wechselwirkungen aus Hinweisen der Einrichtung; bewusst ohne lizenzierte Datenbank (kein Medizinprodukt, Entscheid 01.10.2026).                  |
| Vitals                       | ✅    | Individuelle Grenzwerte je Bewohner (`carecore_vital_thresholds`).                                                                                                                   |
| Wounds                       | ✅    | Verlauf, Fotos, Körperkarte, Erinnerungen, Verbandsmaterial je Versorgung aus dem Materialkatalog.                                                                                   |
| Nutrition                    | ✅    | Plan, Trinken, Mahlzeiten, Screenings; Trendhinweise Gewicht und Trinkmenge nach Grenzen der Einrichtung.                                                                            |
| Team / Kanäle                | ✅    | Kanäle, Beiträge, Lesebestätigungen (`carecore_post_reads`).                                                                                                                         |
| Chat                         | ✅    | Unterhaltungen, Reaktionen, @Erwähnungen; Benachrichtigung und Push bei Direktnachricht und Erwähnung.                                                                               |
| Schedule                     | ✅    | Dienstplan, Tausch, Wünsche, Zeiterfassung, KI-Planung. Börse für offene Dienste.                                                                                                    |
| Docs                         | ✅    | Versionen, Freigabe, Lesebestätigung (`carecore_document_reads`); neue Version verlangt die Bestätigung erneut.                                                                      |
| Learn                        | ✅    | Schulungen, Pflicht, Gültigkeit, Nachweise, Link, Quiz mit Bestehensgrenze, Übersicht je Team. Videos nur als Link.                                                                  |
| Quality                      | ✅    | Ereignisse mit Massnahmen und Status.                                                                                                                                                |
| KI-Assistenten               | ✅    | Übergabe, Risiken, Dokumentation, Pflegeplanung, freie Frage, Dienstplan-KI, Such-Assistenz in der globalen Suche (pseudonymisiert); Entwürfe mit Prüfung.                           |
| Globale Suche ⌘K             | ✅    | `global-search-dialog.tsx`, Tastenkürzel.                                                                                                                                            |
| Benachrichtigungen           | ✅    | Klassen Kritisch / Handlung / Info / Sozial, Bündelung, Push mit Ruhezeiten.                                                                                                         |
| Mobile                       | ✅    | Untere Navigation, Hauptmenü, Schnellaktions-Knopf (FAB); alle Seiten auf Handybreite ohne Querscrollen geprüft, eigene Auswahllisten, Tippflächen vergrössert.                      |
| Dark Mode                    | ✅    | Persönliche Wahl „Erscheinungsbild: Dunkel“; Standard bleibt hell.                                                                                                                   |
| Barrierefreiheit WCAG 2.2 AA | ✅    | Tastatur, Fokusfalle, Schriftgrösse, Kontrast-Einstellung; grauer Hilfstext (`--muted`) erreicht 4,7:1.                                                                              |
| IAM                          | ✅    | Passwort, Login-Drossel, Sitzungen mit Gerät, automatische Abmeldung, MFA (TOTP), Passkeys, SSO (OpenID Connect).                                                                    |
| Rechte                       | ✅    | Rechte plus Qualifikationen; Medikation getrennt in verabreichen / verwalten; alle sehen alle Bewohnenden (Entscheid); Leitungsrechte erst mit Zwei-Faktor-Anmeldung, wenn verlangt. |
| Audit                        | ✅    | Atomar, pro Bewohner, mit Sitzung und Gerät.                                                                                                                                         |
| Datenschutz                  | ✅    | Eigener Datenexport, Quittungen nach 30 Tagen gelöscht, Lösch- und Aufbewahrungskonzept (`docs/DATENSCHUTZ.md`).                                                                     |
| Sicherheit                   | ✅    | Login-, Passwort- und KI-Drossel, Schreib-Drossel; Zwei-Faktor-Pflicht für Leitung/Administration, Passwort-Richtlinie (Länge, Sperrliste), Sitzungen beenden.                       |
| Backups / Health             | ✅    | Health-Endpunkt `/api/health`; tägliche, wöchentliche und monatliche Backups der Railway-Datenbank eingeschaltet.                                                                    |
| Offline                      | ✅    | Warteschlange und Daten-Zwischenspeicher verschlüsselt (Schlüssel nur im Arbeitsspeicher), Entsperren ohne Verbindung mit dem Passwort, Konfliktanzeige.                             |
| API / FHIR / Webhooks        | ✅    | FHIR R4 (Patient, Observation) mit Schlüsseln, Webhooks mit Signatur (`docs/SCHNITTSTELLE.md`).                                                                                      |
| Mandanten                    | ✅    | Organisation, Standort, Wohnbereich; eigene Rollen je Einrichtung. Eingebaute Rollen gelten für die Installation.                                                                    |
| Domain Events / Echtzeit     | ✅    | Server-Sent Events (`/api/events`), Ereignis-Warteschlange per Trigger für Webhooks.                                                                                                 |
| Admin-Konfiguration          | ✅    | Einstellungen, Terminologie, eigene Ereignisarten, Vitalparameter, Logo, Löschfristen, Schnittstellen.                                                                               |
| Insights / Resident 360      | ✅    | Kennzahlen, Bewohnerübersicht (Resident 360) und persönliches Dashboard „Meine Kennzahlen“.                                                                                          |
| Smart Workflows              | ✅    | Ablaufketten je Ereignisart mit Folgeaufgaben; Schritte legt das Qualitätsmanagement fest.                                                                                           |
| Universal Action System      | ✅    | Ein Aktionsregister für Schnellaktionen und Suche ⌘K, Erfassung direkt aus der Suche.                                                                                                |
| Sprachen / Terminologie      | ✅    | Bewohner / Patient / Klient wählbar. Oberfläche in FR, IT, EN, SQ, HR, SR, HU einrichtbar: KI-Entwurf, Prüfung und Freigabe durch die Administration (`docs/SPRACHEN.md`).           |
| Phase 6 Portale              | ✅    | Portal für Angehörige und Ärztinnen/Ärzte (`/portal`), Freigaben je Person/Wohnbereich und Bereich, Nachrichten, Apothekenportal.                                                    |

## Hoch (klinische Sicherheit und Kernabläufe)

- [x] **Reanimationsstatus im Bewohner-Kopfbereich:** eigenes Feld (REA ja / nein / nicht erfasst, Grundlage, Datum), in Akte,
      Kopfzeile und Überleitungsbogen; mit Audit. Werte kommen aus der Patientenverfügung, keine Voreinstellung.
- [x] **Aufgabenstatus erweitern:** teilweise, übersprungen (Grund Pflicht), eskaliert; „überfällig“ berechnet.
      Der Abschluss bietet ✓ △ ✕; Abweichungen (△ ✕) erzeugen immer einen Doku-Eintrag, ✓ bei Dokumentationspflicht.
- [x] **Wirkungskontrolle nach Reservegabe:** Kontrolle mit Termin und Erinnerung, Ergebnis dokumentiert. Den
      Zeitpunkt legt die Verordnung fest, es gibt kein erfundenes Standardintervall.
- [x] **Chat:** Reaktionen, @Erwähnungen mit Benachrichtigung, Push bei Direktnachricht und Erwähnung.
- [x] **Benachrichtigungsklassen** Kritisch / Handlung / Info / Sozial, mit Bündelung. Kritisches ignoriert die
      Ruhezeiten nur, wenn die Person es erlaubt.

## Mittel

- [x] **Mobile Schnellaktionen (FAB):** Doku, Vitalwert, Trinkmenge, Reservegabe, Wundverlauf, Übergabenotiz für den gewählten Bewohner.
- [x] **Health-Endpunkt** `/api/health` (DB-Verbindung, Migrationsstand, ohne Geheimnisse).
- [x] **Allgemeine API-Drossel** für schreibende Anfragen.
- [x] **Offline-Konflikte:** Wurde eine offline bearbeitete Notiz inzwischen anderswo geändert, meldet der Server
      einen Konflikt; die Anzeige bietet „Meine Fassung übernehmen“ oder „Verwerfen“.
- [x] **Offline-Speicher verschlüsseln:** Schlüssel nur im Arbeitsspeicher (Entscheidung vom 30.09.2026). Vorgemerkte
      Einträge liegen auf dem Gerät nur verschlüsselt (ECDH P-256 + AES-256-GCM, `lib/offline-crypto.ts`). Das
      Schlüsselpaar leitet der Server je Person aus `CARECORE_MFA_KEY` ab; den privaten Teil erhält nur die angemeldete
      Person, er bleibt nicht exportierbar im Arbeitsspeicher. Nach einem Neuladen ohne Verbindung lässt sich weiter
      erfassen (öffentlicher Schlüssel), vorgemerkte Einträge sind aber bis zur Verbindung gesperrt; ältere
      unverschlüsselte Einträge werden beim nächsten Entsperren verschlüsselt.
- [x] **Leitung verabreicht Medikamente immer:** Die Rollenverwaltung hält „Medikation verabreichen“ und „ohne
      Qualifikation“ für die Leitung fest (wie die Rechte der Administration); Migration 0049 gleicht bestehende
      Installationen an.
- [x] **Spracheingabe** nur mit Erkennung auf dem Gerät (Entscheidung vom 30.09.2026): Knopf „Diktieren“ bei
      Dokumentationseintrag und Übergabepunkt, nur wenn der Browser die Erkennung lokal anbietet (Web Speech API mit
      `processLocally`, Sprachpaket de-CH bzw. de-DE auf dem Gerät). Ohne lokale Erkennung erscheint kein Knopf – kein
      Rückgriff auf die Cloud-Erkennung. Eingeschaltet wird sie in den persönlichen Einstellungen („Spracheingabe“,
      Standard aus) – erst dann fragt CareOS den Browser, weil manche Chromium-Builds ohne Sprachmodul bei dieser
      Abfrage die Seite beenden. Ein eigener Erkennungsdienst (z. B. Whisper auf eigenem Server) wäre die Ergänzung
      für Geräte ohne lokale Erkennung.
- [x] **Zwischenspeicher des Service Workers verschlüsselt** (Entscheidung vom 30.09.2026). Daten (`GET /api/…`) liegen
      nur verschlüsselt im Browser-Cache (`public/sw-crypto.js`, gleiches Verfahren wie die Warteschlange); ohne
      Schlüssel speichert der Service Worker nichts. Den privaten Schlüssel hält die geöffnete App im Arbeitsspeicher und
      gibt ihn dem Service Worker auf Anfrage, auch er behält ihn nur im Arbeitsspeicher. Lesen und Bearbeiten bleiben
      damit möglich: mit Verbindung immer, ohne Verbindung solange die App offen ist. Nach einem Neustart ohne
      Verbindung entsperrt die Person Daten und vorgemerkte Einträge mit ihrem Passwort: bei der Anmeldung mit Passwort
      legt die App den privaten Schlüssel mit dem Passwort verschlüsselt ab (PBKDF2-SHA-256, 600 000 Runden); beim
      Abmelden wird er gelöscht. Nach Anmeldung mit Passkey oder SSO gibt es kein Entsperren ohne Verbindung. Seiten
      enthalten keine Personendaten und bleiben als App-Hülle unverschlüsselt.
- [x] **Audit mit Sitzung und Gerät** (Sitzungs-ID, User-Agent).
- [x] **Feinere Medikationsrechte:** verabreichen vs. Verordnung bearbeiten.
- [x] **Lernen:** Quiz mit Bestehensgrenze (von der Einrichtung festgelegt) und Compliance-Übersicht je Team.
- [x] **Dokumente:** Lesebestätigung bei neuer Version erneut anfordern. War bereits so gebaut (jede Version eigene
      Zeile, Benachrichtigung „Standard aktualisiert“), jetzt mit Test; ergänzt: nachträglich verlangte Bestätigung
      benachrichtigt alle, die noch nicht bestätigt haben.
- [x] **Trendhinweise Ernährung:** Hinweis, wenn eine von der Einrichtung gesetzte Grenze für Gewicht oder
      Trinkmenge unterschritten wird. Keine erfundenen Werte. Einstellungen „Hinweis Gewichtsverlust“ (%),
      „Beobachtungszeitraum Gewicht“ (Tage) und „Hinweis Trinkmenge“ (Tage in Folge unter dem persönlichen
      Trinkziel), alle ohne Vorgabewert und ausgeschaltet.
- [x] **Wunden:** Verbandsmaterial je Versorgung aus dem Materialkatalog (Momentaufnahme je Eintrag; keine
      Lagerbuchung – das wäre eine eigene Entscheidung zur Bestandsführung).
- [x] **Dienstplan:** Börse für offene Dienste (fehlende Mindestbesetzung im veröffentlichten Plan; Interesse
      melden, Leitung teilt über die Regelprüfung zu oder lehnt ab).
- [x] **Wechselwirkungsprüfung** eingerichtet, ohne lizenzierte Datenbank (Entscheidung vom 01.10.2026). Die
      Einrichtung erfasst Hinweise (Wirkstoff/Präparat A und B, Schweregrad, Beschreibung, Empfehlung, Pflichtangabe
      Quelle) in Leitung › Konfiguration; wer Verordnungen verwaltet, darf sie pflegen, protokolliert. Trifft ein Hinweis
      auf zwei laufende Verordnungen derselben Person zu, erscheint er im Medikamentenplan und bei den Reserven, mit dem
      Vermerk, dass fehlende Hinweise keine Unbedenklichkeit bedeuten. CareOS enthält keine eigenen Regeln.
- [x] **Dark Mode** als Wahl in den persönlichen Einstellungen. Das Standard-Aussehen bleibt unverändert.

## Niedrig / später

- [x] **MFA (TOTP)** mit Wiederherstellungscodes und Zurücksetzen durch die Administration. Braucht `CARECORE_MFA_KEY`.
- [x] **Passkeys** (WebAuthn): in Einstellungen › Sicherheit hinzufügen und entfernen (protokolliert); Anmeldung
      über den Vorschlag im Feld „Benutzername“ oder „Mit Passkey anmelden“. Bestätigung am Gerät ist Pflicht, deshalb
      ersetzt ein Passkey Passwort und Code. Gespeichert wird nur der öffentliche Schlüssel.
- [x] **SSO** selbst gebaut mit Open-Source-Bausteinen (Entscheidung vom 30.09.2026): OpenID Connect mit
      `openid-client` (MIT), Authorization Code mit PKCE, state und nonce, geprüftes ID-Token. Je Einrichtung in
      Leitung › Konfiguration (Issuer, Client-ID, Secret verschlüsselt, Claim für den Benutzernamen, Bezeichnung).
      Nur bestehende, aktive Konten der Einrichtung; Knopf auf der Anmeldeseite nur, wenn eingeschaltet. Beschreibung in
      `docs/SSO.md`.
- [x] **Smart Workflow Sturz** als erste Ablaufkette mit Folgeaufgaben. Umgesetzt für alle Ereignisarten; die
      Schritte (Titel, Fälligkeit nach dem Ereignis, Priorität) legt das Qualitätsmanagement fest, ohne Vorgaben.
- [x] **Home in Kritisch / Wichtig / Routine** gliedern, ohne das bestehende Aussehen zu verändern. Die Tagesliste
      filtert nach diesen drei Stufen, mit Anzahl je Stufe; Karten und Anordnung bleiben wie bisher.
- [x] **Resident 360** in Insights: „Kennzahlen Bewohner“ zeigt je Bewohner heute Fälliges (kritisch / wichtig /
      Routine), Wunden, Ereignisse der letzten 90 Tage, Ernährungshinweise und die letzte Dokumentation.
- [x] **Personal-Dashboards** in Insights: „Meine Kennzahlen“ – jede Person heftet Kennzahlen aus Pflege, Bewohnern,
      Leitung und Personal an (höchstens 16), gespeichert in den persönlichen Einstellungen.
- [x] **Konfigurierbare Terminologie** (Bewohner / Patient / Klient), danach weitere Sprachen.
  - [x] Grundlage: Wahl in „Leitung › Konfiguration“ (mit Protokoll), feste Wortformen je Bezeichnung
        (`lib/terminology.ts`), gilt in Navigation, Kopfzeile, Handy-Navigation, Suche und Startseite.
  - [x] Bewohner-Modul: Übersicht, Verzeichnis, Aufnahme, Akte mit allen Bereichen, Pflegeakte, Verlauf & Archiv.
  - [x] Medikation, Wunden, Vitalwerte, Ernährung.
  - [x] Planung, Einschätzungen, RAI, Dokumentation, Betrieb (Aufgaben, Übergabe, Kalender), Qualität, Kennzahlen,
        Assistenz, Administration, Einstellungen, Hilfe und Tastaturkürzel.
  - [x] Texte des Servers: Kennzahlen (mit fester ID für „Meine Kennzahlen“), Übersichten, Fehlermeldungen,
        RAI-Export und KI-Aufträge. Seltene Fehlermeldungen ohne Einrichtung sind neutral formuliert („Akte …“).
  - [x] Seitentitel im Browser-Tab („CareOS · Patienten“).
  - [x] Weitere Sprachen (Entscheidung vom 30.09.2026): Französisch, Italienisch, Englisch, Albanisch, Kroatisch,
        Serbisch (lateinisch), Ungarisch für die gesamte App. Textkatalog aus dem Code (`npm run i18n:extract`, in CI
        geprüft), KI-Entwürfe, Prüfung Text für Text und Freigabe je Sprache in Leitung › Administration › Sprachen;
        Mitarbeitende sehen nur Geprüftes, Wahl unter Einstellungen › Sprache, auch im Portal. Beschreibung in
        `docs/SPRACHEN.md`. Offen: die eigentliche Prüfung der Texte durch Administration und Auftraggeber.
- [x] **Admin-Konfiguration:** Ereignistypen, Vitalparameter, Branding.
  - [x] Ereignisarten: eigene Arten der Einrichtung (höchstens 20) neben den eingebauten; beim Melden und in den
        Ablaufketten wählbar, protokolliert. Entfernen nimmt die Ablaufkette mit, gemeldete Ereignisse bleiben.
  - [x] Vitalparameter: die Einrichtung schaltet eingebaute Messwerte aus (Messung, Übersicht, Entwicklung, Grenzwerte);
        neue Messungen ausgeschalteter Werte werden abgelehnt, sie zählen nicht für den Status. Eigene Messwerte mit
        Plausibilitäts- und Grenzwerten bräuchten fachlich festgelegte Werte und sind bewusst nicht Teil davon.
  - [x] Branding: Logo der Einrichtung (JPEG, PNG, WebP; Auswahl bis 20 MB, grosse Bilder verkleinert der Browser auf höchstens 2 MB; Inhalt geprüft, kein SVG) in der Kopfzeile neben
        dem Namen; ohne Logo bleibt das bisherige Symbol.
- [x] **Datenschutz:** Lösch- und Aufbewahrungskonzept für Bewohnerdaten. Fristen legt die Einrichtung fest.
      Konzept in `docs/DATENSCHUTZ.md`; Einstellung „Aufbewahrungsfrist Akten“ (ohne Vorgabe), Karte „Löschfristen“ mit
      Löschung nur auf Bestätigung durch die Administration.
- [x] **Echtzeit** (Server-Sent Events) statt Polling. `/api/events` meldet Änderungen an Benachrichtigungen,
      Nachrichten sowie Aufgaben/Übergaben (Prüfung alle 10 s, Stand als Event-ID fürs Wiederverbinden); Kopfzeile,
      Navigationszähler und Messenger laden sofort nach. Das bisherige Nachladen bleibt als seltene Absicherung.
- [x] **Öffentliche API, Webhooks, FHIR.**
  - [x] Öffentliche Schnittstelle nach HL7 FHIR R4 (nur lesend): Patient und Observation (Vitalwerte, LOINC/UCUM),
        `metadata` ohne Schlüssel. Schlüssel je angebundenem System mit Berechtigungen, erstellt und widerrufen durch die
        Administration (Leitung › Konfiguration), gespeichert nur als Hash; jeder Zugriff protokolliert. Beschreibung in
        `docs/SCHNITTSTELLE.md`.
  - [x] Webhooks: signierte Meldungen (HMAC-SHA256) bei Aufnahme, Änderung der Personendaten und neuen Vitalwerten,
        nur mit Verweis auf die FHIR-Ressource. Vorgemerkt per Trigger, Zustellung mit Wiederholungen, Ziele im
        internen Netz gesperrt (auch nach der Namensauflösung), Geheimnis verschlüsselt, Probemeldung aus der
        Konfiguration.
- [x] **Einrichtbare Übersichtsseiten:** Startseite (alle Bausteine, Kopf- und Hauptbereich, Breite) und die
      Kennzahlen-Seiten (Pflege, Bewohner, Leitung, Personal, Meine Kennzahlen: verschieben, Breite, stapeln,
      ausblenden) je Person; Arbeitsseiten bleiben bewusst einheitlich (Entscheidung vom 01.10.2026).
- [x] **Mistral** (`mistral-small-latest`, offizielles SDK `@mistralai/mistralai`, Entscheidung vom 07.10.2026) für
      CareOS KI, KI-Dienstplanung, KI-Suche, Diktat und Übersetzungsentwürfe, Schlüssel `MISTRAL_API_KEY`, Modell
      wählbar über `MISTRAL_MODEL`; Google Gemini entfernt (vorher seit 30.09.2026).
- [x] **Portale (Phase 6).**
  - [x] Portal für Angehörige und Ärztinnen/Ärzte (Entscheidung vom 30.09.2026): eigene Zugänge mit Einmal-Passwort,
        Freigaben individuell je Person oder Wohnbereich, einzeln gewählte Bereiche (Notfalldaten, Medikation,
        Vitalwerte, Pflegeberichte, Termine, Wunden), Zeitraum und Grundlage mit Vermerk; Widerruf sofort, jeder Abruf
        protokolliert. Beschreibung in `docs/PORTAL.md`.
  - [x] Nachrichten zwischen Portal und Pflege (CareOS One › Portal-Nachrichten), Apothekenportal mit Bestellungen
        aus Medikation › Bestellungen, Hilfe mit Bildschirmfotos im Portal.
- [x] **Mandanten: eigene Rollen je Einrichtung.** Nur die Einrichtung, die eine Rolle anlegt, sieht, vergibt, ändert
      und löscht sie; bestehende eigene Rollen wurden ihrer Einrichtung zugeordnet (Migration 0048). Eingebaute Rollen
      bleiben gemeinsam.
  - [x] **Rollen kopieren:** In der Rollenverwaltung „Rolle kopieren“ bei jeder Rolle (auch Systemrollen): die Kopie
        übernimmt Berechtigungen und Medikationseinstellung als neue eigene Rolle der Einrichtung, Name und Schlüssel
        frei wählbar, protokolliert als „kopiert“ mit der Vorlage. Rollen anderer Einrichtungen sind keine Vorlage.
- [x] **Universal Action System:** ein Aktionsregister (`app/components/actions.ts`) für Schnellaktionen und Suche ⌘K.
      In der Suche z. B. „vital“ (Person aus der Kopfzeile) oder „vital Muster“ (gleich für diese Person); Vitalwerte
      und Trinkmenge öffnen die Erfassung direkt, die Übergabe wählt die Person vor und setzt den Cursor ins Textfeld.
      Die Startseite nutzt dieselbe Suche wie alle anderen Seiten.
- [x] **KI-Planungsassistenz:** Auftrag „Pflegeplanung vorschlagen“ in CareOS KI, nur für eine Person: Probleme,
      Ressourcen, Ziele und Massnahmen mit Datengrundlage aus Einschätzungen, bestehender Planung, zwei Wochen Berichten,
      Vitalwerten und Wunden (pseudonymisiert). Bestehende Ziele werden nicht doppelt vorgeschlagen, keine erfundenen
      Werte; der Vorschlag bleibt ein Entwurf, den die Pflegefachperson prüft und selbst in die Planung überträgt.

- [x] **Dialoge: Aktionen fest unten.** In allen Seitenpanels (Formulare, Notizen, Mitarbeitende, Rollen, Kontakte,
      Passwort, Gruppen) stehen Speichern, Abbrechen und weitere Aktionen fest unten im Footer; langer Inhalt scrollt
      darunter durch. Sidebar-Tooltips zeigen das Tastenkürzel als Taste, „Zeitplan“ steht auf Höhe von „Als Nächstes“.

- [x] **Arbeitsplatz: alle Bereiche einrichtbar.** Auch die Begrüssung (Datum, Begrüssung, Uhrzeit) ist ein Baustein:
      verschieben, Breite wählen, zwischen Kopf- und Hauptbereich wechseln, ausblenden. Die Breitenwahl auf dem
      Arbeitsplatz und den Kennzahlen-Seiten nutzt das CareOS-Dropdown statt der Browser-Auswahl.

- [x] **Verkaufsbereit 1 – Sicherheit:** Next.js 16.3.8 (kritische Lücke geschlossen), Sicherheits-Header (CSP, HSTS,
      Einbettschutz, Permissions-Policy); Klicktests melden jeden CSP-Verstoss.
- [x] **Verkaufsbereit 2 – E-Mail-Versand:** SMTP (`docs/EMAIL.md`), E-Mail-Adresse bei Mitarbeitenden, „Passwort
      vergessen?“, Einladung statt Startpasswort, Link zum Passwort setzen; Links einmalig, gehasht, protokolliert.
- [x] **Verkaufsbereit 3 – Installation je Einrichtung:** Anleitung `docs/INSTALLATION.md`, Skript für die Geheimnisse,
      Name der Einrichtung in der Konfiguration änderbar (Kopfzeile ohne Neuladen), Checkliste „CareOS einrichten“.
- [x] **Verkaufsbereit 4 – Überwachung und Backups:** Serverfehler im Systemstatus, Alarm per E-Mail
      (`ALERT_EMAIL`), Anleitung `docs/BETRIEB.md` (Railway-Backups und PITR, Bucket, Benachrichtigungen,
      Verfügbarkeitstest, Wiederherstellung üben, Ernstfall). Die Backups selbst schaltet der Betreiber in Railway ein.
- [x] **Verkaufsbereit 5 – Datenübernahme:** Bewohner und Mitarbeitende aus CSV mit Vorlage, Prüfung je Zeile,
      Übernahme nur vollständig gültiger Dateien; Mitarbeitende per Einladung oder mit einmaligem Startpasswort.
- [x] **Land der Einrichtung (02.10.2026):** Die Administration wählt unter Leitung › Konfiguration Schweiz,
      Deutschland oder Österreich (bei neuen Installationen `--land`). Danach gelten die Vorgaben des Landes:
      Pflegestufen 1–12 nach KLV Art. 7a (CH), Pflegegrade 1–5 nach SGB XI § 15 (DE) bzw. Pflegegeldstufen 1–7 nach
      BPGG § 4 (AT) in Aufnahme, Pflegeakte und Pflegeplanung (vom Server geprüft); AHV- bzw.
      Sozialversicherungsnummer mit Formatprüfung (AT mit Prüfziffer), Krankenversichertennummer (DE);
      Feiertage zum Übernehmen (je Kanton bzw. Bundesland, siehe unten); übliche Qualifikationen des Landes werden
      ergänzt. Gespeicherte Werte aus einem anderen Land bleiben erhalten. CareOS stuft nicht selbst ein.
- [x] **Feiertage je Kanton und Bundesland (02.10.2026):** In der Karte „Land der Einrichtung“ wählt die
      Administration den Kanton (26) bzw. das Bundesland (DE 16, AT 9); der Dienstplan übernimmt die gesetzlichen
      Feiertage dieser Region (ohne Auswahl die landesweiten). Quelle: Paket `date-holidays` (Daten CC BY 3.0), nur
      Feiertage vom Typ „gesetzlich“; kommunale Feiertage ergänzt die Leitung einzeln.
- [x] **Logo bis 20 MB wählbar (02.10.2026):** Bilder über 2 MB verkleinert der Browser vor dem Hochladen
      (längste Seite 1024 Pixel, Transparenz bleibt); gespeichert werden höchstens 2 MB.
- [x] **Gesamtprüfung (01.10.2026):** Seiten ohne Recht zeigen beim direkten Aufruf „Kein Zugriff“ (Proxy prüft
      dieselben Rechte wie die Navigation); alle `eslint-disable` durch saubere Lösungen ersetzt (gemeinsame Uhr
      `useNow`, Ladeeffekt der Teamleitung, Fotovorschau); ungenutzter Code entfernt; die zwei grössten
      Komponenten (Dienstplan- und persönliche Einstellungen) in Reiter-Dateien aufgeteilt, Optik unverändert.

## Entschieden (30.09.2026)

- **Sprachen:** ganze App in FR, IT, EN, SQ, HR, SR, HU; Prüfung durch die Administration und den Auftraggeber.
- **Portal:** für Ärztinnen/Ärzte und Angehörige, Berechtigungen individuell je Zugang, Person/Wohnbereich und Bereich.
- **Interaktionsprüfung:** nur mit den Hinweisen der Einrichtung; keine lizenzierte Datenbank (siehe Medizinprodukt).
- **Eigene Rollen:** je Einrichtung, kopierbar.
- **Offline-Zwischenspeicher:** verschlüsseln; Lesen und Bearbeiten bleiben möglich (ohne Verbindung mit Passwort).
- **Offline-Verschlüsselung:** Schlüssel nur im Arbeitsspeicher.
- **Leitung:** hat das Recht zur Medikamentenvergabe, immer und ohne Qualifikation.
- **Spracheingabe:** nur mit Erkennung auf dem Gerät bzw. einem eigenen Dienst, keine Übermittlung an Hersteller.
- **SSO:** selbst gebaut mit Open-Source-Bausteinen.

## Entschieden (01.10.2026)

- **Kein Medizinprodukt (MepV):** CareOS ist Software für Pflegedokumentation, Organisation und Kommunikation und
  bleibt ausserhalb der Medizinprodukteverordnung. Daraus folgt für alle Funktionen:
  - CareOS stellt keine Diagnosen, berechnet keine Dosierungen und gibt keine eigenen Therapie- oder
    Behandlungsempfehlungen.
  - Grenzwerte (Vitalwerte, Trinkziel), Hinweise zu Wechselwirkungen und Erinnerungen stammen von der Einrichtung
    (mit Quelle); CareOS enthält dafür keine eigenen Regeln oder Vorgabewerte.
  - Eine lizenzierte Arzneimitteldatenbank wird nicht angebunden, weil eine automatische Wechselwirkungsprüfung die
    Software zum Medizinprodukt machen würde.
  - Assessments (z. B. Braden, interRAI) werden erfasst und nach der veröffentlichten Methode ausgezählt; die
    Beurteilung bleibt bei der Fachperson.
  - CareOS KI erstellt nur Entwürfe, die eine Fachperson prüft und übernimmt; sie stellt keine Diagnosen und
    ordnet keine Medikation an.

## Entschieden (02.10.2026)

- **Rechte:** Alle Mitarbeitenden sehen alle Bewohnenden; keine Einschränkung nach Wohnbereich.
- **Kontrast:** Grauer Hilfstext minimal dunkler (`#5f6f86`, 4,7:1).
- **Sicherheit:** Zwei-Faktor-Pflicht für Leitung und Administration (einschaltbar unter Konfiguration ›
  Sicherheit), Passwort-Richtlinie ab 10 Zeichen, Administration kann alle Sitzungen einer Person beenden.

## Entschieden (06.10.2026)

- [x] **Bewohnergelder (Barbetrag, Taschengeld):** CareOS deckt sie ab. Bewohner › Bewohnergelder: Konto je Person
      in der Kasse der Einrichtung mit Einzahlung, Auszahlung und Ausgabe (Zweck, von bzw. an, Beleg-Nr.), Guthaben
      nie unter null, Storno mit Grund statt Ändern oder Löschen, Kontoauszug je Monat (A4, mit laufendem Saldo und
      Unterschriftsfeldern) und Kassenkontrolle (gezählter Bestand gegen die Summe aller Guthaben, Differenz nur mit
      Erklärung). Eigenes Recht „Bewohnergelder verwalten“, zu Beginn nur für die Administration. Beträge in CHF
      (Schweiz) bzw. EUR (Deutschland, Österreich). Gesetzliche Höchstbeträge oder Abrechnungsfristen gibt CareOS
      nicht vor.

## Erledigt (06.10.2026): Präsentation

- [x] **Folienübergänge:** Gruppe „Übergänge“: Verblassen, Schieben, Wischen oder Überdecken je Folie mit Tempo
      (schnell 0,5 s, mittel 0,75 s, langsam 1 s), Vorschau auf der Folie, „Für alle Folien übernehmen“, Zeichen in
      der Folienübersicht. Die Vorführung spielt den Übergang beim Weiterschalten (wie in PowerPoint nur vorwärts);
      bei „weniger Bewegung“ im System ohne Animation. In PowerPoint-Dateien als `p:transition` gelesen und
      geschrieben; neuere Effekte werden über den Ersatz für ältere Versionen gelesen, unbekannte entfallen.

## Erledigt (06.10.2026): Tabelle

- [x] **Pivot-Tabelle:** Daten › „Pivot-Tabelle einfügen“ fasst einen Bereich mit Überschriften nach einem Zeilenfeld
      und optional einem Spaltenfeld zusammen (Summe, Anzahl, Mittelwert, Minimum, Maximum, mit Gesamtergebnissen) und
      legt sie auf ein eigenes Blatt. Die Zellen der Pivot-Tabelle sind fest; „Pivot-Tabelle aktualisieren“ übernimmt
      geänderte Daten, „bearbeiten“ ändert die Felder. In der Excel-Datei steht die Pivot-Tabelle als Werte (ohne
      Excel-eigene Pivot-Definition); in CareOS bleibt sie aktualisierbar.
- [x] **Blattschutz:** Überprüfen › „Blatt schützen“ sperrt Zellen, Formate und den Aufbau des Blatts; mit
      „Bearbeitbar trotz Blattschutz“ freigegebene Zellen bleiben ausfüllbar (z. B. Vorlagen). Schutz vor versehentlichen
      Änderungen ohne Kennwort: wer die Datei bearbeiten darf, kann den Schutz aufheben. In der Excel-Datei als
      `sheetProtection` und „Gesperrt“ je Zelle (wird auch aus Excel gelesen).

## Analyse vom 03.10.2026: noch zu erstellen

Rundgang über alle 89 Seiten (Desktop und Handy, als Administration): keine Skriptfehler, keine fehlgeschlagenen
Anfragen, kein seitliches Scrollen, keine technischen oder englischen Begriffe; Ladezeit im Median 1,5 s. Die
Protokolle (Administration, Bewohnerakte, Dienstplan, Portalzugriffe) sind deutsch. Alle PRD-Bereiche oben sind
umgesetzt; die folgenden Punkte gehen darüber hinaus. Alles bleibt Dokumentation, Organisation und Kommunikation:
keine Diagnosen, keine Dosierungen, keine eigenen Grenzwerte (Entscheid 01.10.2026). Gesetzliche Grundlagen und
Fristen werden beim Bau an der Quelle geprüft und nicht erfunden; Fristen legt die Einrichtung fest.

### Hoch

- [x] **Freiheitsbeschränkende Massnahmen (FBM):** Reiter „FBM“ (in DE „FEM“) in der Akte: Art, Beschreibung,
      Grund und Zweck, geprüfte mildere Massnahmen, anordnende Person, Haltung und Information der Person,
      Vertretung mit Datum der Information, Genehmigung bzw. Meldung je Land, Beginn, Zeitraum, geplantes Ende.
      Überprüfung mit Ergebnis (weiterführen mit neuem Termin oder beenden) und Begründung; den Termin legt die
      Einrichtung je Massnahme fest. Tagesliste erinnert an fällige Überprüfungen und an die noch nicht informierte
      Vertretung; laufende Massnahmen stehen im Überleitungsbogen; jede Änderung im Änderungsprotokoll. Grundlagen
      geprüft: CH ZGB Art. 383–385, DE § 1831 Abs. 4 BGB, AT HeimAufG §§ 6–7.
- [x] **Vorsorge und Vertretung in den Stammdaten:** Karte „Vorsorge & Vertretung“: Patientenverfügung (liegt vor /
      nicht vor / nicht erfasst, Datum, Aufbewahrungsort) und Vorsorgeauftrag bzw. Vorsorgevollmacht (Datum, wirksam
      seit). Kontaktpersonen erhalten eine Rolle „vertretungsberechtigt als“ mit Bezeichnungen je Land. Aktenkopf zeigt
      „PV: Ja / Nein / nicht erfasst“ und „Vertretung: Name“; Überleitungsbogen enthält beides; das FBM-Formular
      übernimmt die Vertretung. Jede Änderung der Vorsorge mit eigenem Protokolleintrag. CareOS prüft keine
      Wirksamkeit.
- [ ] **Anbindung an das elektronische Patientendossier:** CH: EPD über eine Stammgemeinschaft; DE: Telematikinfrastruktur
      (ePA, KIM); AT: ELGA. Anschlusspflichten und Profile (IHE, FHIR) je Land prüfen. Grösster Integrationsschritt,
      braucht Partner und Zertifizierung.

### Mittel

- [x] **Nationale Qualitätsindikatoren als Auswertung:** Leitung › Qualität & Kennzahlen › Qualitätsindikatoren:
      die medizinischen Qualitätsindikatoren der Schweizer Pflegeheime (Mangelernährung, Rumpffixation / Sitzgelegenheit,
      Bettgitter, Polymedikation, Schmerz Selbsteinschätzung, Dekubitus) am Stichtag, je Wohnbereich, mit den gezählten
      Personen und Export als CSV. Jeder Indikator nennt die Definition und wie CareOS zählt; wo die Daten die
      Definition nicht ganz abbilden, steht „Annäherung“. Die offizielle Erhebung bleibt beim Bedarfsabklärungsinstrument.
- [ ] **Qualitätsindikatoren DE (§ 113 SGB XI):** braucht die halbjährliche Ergebniserfassung (Mobilität,
      Selbständigkeit, Integrationsgespräch u. a.) als eigene strukturierte Erhebung; erst danach auswertbar.
- [x] **eMediplan einlesen (CH):** Medikation › eMediplan liest den Inhalt des QR-Codes (CHMED16A, komprimiert oder
      nicht) als Entwurf für die Person in der Kopfzeile: Personenabgleich (Name, Geburtsdatum), Dosierung
      Morgen/Mittag/Abend/Nacht, Reserve, Zeitraum, Grund und Verordnende. Jede Zeile prüft eine Fachperson und übernimmt
      sie einzeln als Verordnung mit den Pflichtangaben des Medikamentenplans; verschiedene Dosen werden zu getrennten
      Verordnungen. GTIN und Pharmacode löst CareOS ohne Arzneimitteldatenbank nicht auf: Das Präparat wird beim ersten
      Mal zugeordnet, die Zuordnung gilt für den nächsten Plan. Komplexe Schemata von Hand. Keine automatische Prüfung
      oder Änderung.
- [x] **eMediplan CHMED23A und Kamera:** CHMED23A wird gelesen, auch auf mehrere QR-Codes verteilt (je Code eine
      Zeile, Reihenfolge egal; fehlende Teile werden genannt). Übernommen werden eindeutig tägliche Dosierungen
      (Morgen/Mittag/Abend/Nacht, Tagesabschnitte, feste Uhrzeiten aus dem Plan); Wochentage, Intervalle, Abfolgen,
      Dosis von–bis und Freitext bleiben von Hand. QR-Code mit der Kamera scannen, wo der Browser QR-Erkennung hat
      (z. B. Chrome, Edge, Android); die Bilder verlassen das Gerät nicht.
- [x] **Visite vorbereiten:** Dokumentation › Visite sammelt die offenen Einträge „Für Visite“ je Hausärztin bzw.
      Hausarzt (aus den Stammdaten), filterbar nach Wohnbereich, mit Visitenliste zum Drucken (A4). Die Rückmeldung
      wird als Eintrag „Arztvisite“ dokumentiert, schliesst die Frage und steht im Protokoll der Akte.
- [x] **Visite im Portal:** neuer Portal-Bereich „Visite“, nur für Zugänge der Art Ärztin / Arzt (auch serverseitig
      geprüft). Das Portal zeigt die offenen Fragen „Für Visite“ der freigegebenen Personen mit Feld für die Rückmeldung
      und die Rückmeldungen der letzten 14 Tage. Die Rückmeldung wird als Eintrag „Arztvisite“ mit „Name (Portal)“
      dokumentiert und schliesst die Frage; korrigierte oder bereits beantwortete Fragen werden abgewiesen. Im Protokoll der
      Akte und im Portal-Protokoll; die Pflege des Wohnbereichs erhält einen Hinweis.
- [x] **Leistungserfassung:** Dokumentation › Leistungen erfasst erbrachte Leistungen mit Zeit für die Person in der
      Kopfzeile, vorbelegt aus erledigten Aufgaben und laufenden Massnahmen der Pflegeplanung. Leistungskatalog der
      Einrichtung unter Administration (eigener Code, Minuten nur als Vorschlag, keine Normzeiten von CareOS).
      Stornieren mit Begründung statt Löschen, alles im Protokoll der Akte. Leistungsauswertung je Person und Bereich
      im Monat mit CSV-Export (Summen und Einzelleistungen). CareOS berechnet weder Pflegestufe noch Rechnung.
- [ ] **Leistungen: Anbindung an Einstufungs- und Abrechnungssysteme:** Export im Format des jeweiligen Systems
      (z. B. BESA, RAI, PLAISIR, Abrechnungssoftware), sobald die Schnittstellen der Kunden bekannt sind.
- [x] **Ausbruchs- und Isolationsübersicht:** Bewohner › Isolation & Ausbruch zeigt laufende Isolationen je
      Wohnbereich (Art, Anlass und Massnahmen gemäss Anordnung, nächste Überprüfung). Überprüfen heisst weiterführen
      oder aufheben, mit Begründung. Den Ausbruch erklärt und beendet die Leitung, mit Massnahmen und Meldung an die
      Behörde. Neue Isolationen gehen an die Leitung, Ausbrüche an die Mitarbeitenden des Bereichs. Die Tagesliste
      zeigt „Isolation beachten/überprüfen“, und der Überleitungsbogen enthält laufende Isolationen. Der Verlauf
      umfasst 90 Tage, alles steht im Protokoll. Ohne Diagnose und ohne eigene Schwellen für einen Ausbruch.
- [x] **Alltagsgestaltung und Aktivierung:** Neues Modul Alltag & Aktivierung. Angebote: Wochenplan mit
      Gruppenangeboten und Einzelbetreuung je Wohnbereich oder für das ganze Haus, auf Wunsch wöchentlich wiederholt (bis
      12 Wochen), Bearbeiten und Absagen mit Grund. Teilnahme ab Beginn je Person (teilgenommen, abgelehnt, nicht
      anwesend) mit Bemerkung. Teilnahme je Person als Monatsübersicht mit Kategorien und CSV-Export. Portal: neuer Bereich
      „Alltag & Aktivitäten“ (wenn freigegeben) mit Teilnahme der letzten 30 Tage und kommenden Angeboten, ohne Bemerkungen
      der Pflege. Keine Vorgabe, wie viel Aktivierung eine Person braucht.
- [x] **Belegung und Eintritt:** Bewohner › Belegung zeigt die Plätze je Wohnbereich (belegt, reserviert, frei) mit
      Zimmern und Betten; Zimmer verwaltet die Administration, Betten nie unter die Belegung. Warteliste mit Kontakt,
      gewünschtem Bereich und Zeitpunkt und dem Bedarf, wie er mitgeteilt wurde; Status wartet, Platz angeboten,
      zurückgezogen (mit Grund). Die Reihenfolge der Vergabe entscheidet die Leitung. Eintritt planen reserviert ein freies
      Bett; der Eintritt wird am Eintrittstag bestätigt, eine Absage mit Grund gibt das Bett frei und der Eintrag wartet
      wieder. Alles im Protokoll.
- [x] **Warteliste: Aufbewahrung:** Einstellung „Aufbewahrungsfrist Warteliste“ (Monate, von der Einrichtung
      festgelegt; ohne Frist wird nichts vorgeschlagen). Die Karte „Löschfristen Warteliste“ unter Konfiguration zeigt
      abgeschlossene Anfragen (zurückgezogen oder Platz vergeben) nach Ablauf der Frist; gelöscht wird einzeln oder
      gesammelt nur auf Bestätigung der Administration. Ein noch geplanter Eintritt bleibt stehen, die Akte einer
      eingetretenen Person bleibt unverändert. Das Protokoll behält die Einträge ohne Inhalte, die Löschung wird ohne Namen
      protokolliert.

### Niedrig / UI/UX

- [x] **QR-Code je Zimmer:** Bewohner › Belegung › „QR-Etiketten“ je Wohnbereich (A4, 3 × 7, aktive Zimmer). Der Code
      enthält nur die Adresse des Zimmers. Nach der Anmeldung öffnet er die Akte der Person im Zimmer; wohnen mehrere
      dort (oder ist jemand verlegt), erscheint eine Auswahl, ein freies Zimmer wird als frei gemeldet.
- [x] **Druckansichten** (`/bewohner/ueberleitung`, `/medikation/btm/buch`, `/mein-dienstplan/team/drucken`, auch
      Dienstplan, Visitenliste und QR-Etiketten): genau eine Hauptüberschrift auch beim Laden, bei Fehlern und ohne Daten
      (für Screenreader, im Druck unsichtbar); mit Klicktest.

## Analyse vom 03.10.2026 (zweiter Rundgang): noch zu erstellen

Automatischer Rundgang über alle 80 Seiten der Navigation, je Desktop (1366 px) und Handy (390 px), als Administration:
keine Skriptfehler, keine fehlgeschlagenen Anfragen, kein seitliches Scrollen, je Seite genau eine Hauptüberschrift,
keine Knöpfe oder Links ohne Namen, keine Eingabefelder ohne Beschriftung, keine Bilder ohne Alternativtext, keine
englischen oder technischen Begriffe; Ladezeit im Median 0,75 s (höchstens 1,3 s). Danach Abgleich mit den Abläufen im
Heimalltag. Es gilt weiter: Dokumentation, Organisation und Kommunikation – keine Diagnosen, keine Dosierungen, keine
eigenen Grenzwerte oder Intervalle; Instrumente nur nach veröffentlichter Methode, Fristen und Intervalle legt die
Einrichtung bzw. die Pflegeplanung fest, gesetzliche Grundlagen werden beim Bau an der Quelle geprüft.

### Hoch

- [x] **Lagerungs- und Bewegungsprotokoll:** Dokumentation › Lagerung: Positionswechsel (Position, Hautbefund nach
      Fingertest, Uhrzeit, Bemerkung) in wenigen Klicks für die Person in der Kopfzeile, auch offline vorgemerkt. Der
      Lagerungsplan hält das Intervall aus der Pflegeplanung fest (optional mit Bezug zur Massnahme; CareOS gibt
      keines vor). Die Tagesliste zeigt „Lagerung fällig“ (letzter Wechsel plus Intervall) bzw. den Wechsel in der
      nächsten Stunde. Verlauf über 24 Stunden, 3 oder 7 Tage; Stornieren mit Grund statt Löschen; Plan ändern oder mit
      Grund beenden; alles im Protokoll der Akte. Bei verletzter Haut Hinweis auf das Wundmanagement.
- [x] **Auskunft und Datenexport je Person:** Akte › Verlauf › „Auskunft & Datenexport“ (nur Administration): mit
      Angabe, wer die Auskunft verlangt, als lesbare Fassung zum Drucken bzw. als PDF (nach Bereichen, deutsche
      Bezeichnungen, Mitarbeitende mit Namen) oder als Datei (JSON, strukturiert und maschinenlesbar). Enthalten sind alle
      Bereiche der Akte samt Änderungsprotokoll und Portal (Freigaben, Nachrichten, Zugriffe); Dateien sind mit ihren
      Angaben aufgeführt und werden auf Wunsch einzeln herausgegeben. Jede Auskunft steht im Protokoll der Akte.
      Grundlagen geprüft: CH DSG Art. 25 (kostenlos, verständlich, in der Regel innert 30 Tagen) und Art. 28; DE/AT
      DSGVO Art. 15 und 20, Frist nach Art. 12 Abs. 3. Tests stellen sicher, dass jede Tabelle mit Personenbezug und jede
      Spalte erfasst ist.

### Mittel

- [x] **Ausscheidungs- und Kontinenzprotokoll:** Dokumentation › Ausscheidung für die Person in der Kopfzeile:
      Stuhlgang mit Form nach der Bristol-Stuhlformen-Skala (deutsche Übersetzung der veröffentlichten Beschreibungen,
      ohne Bewertung), Wasserlassen, Urin- und Stuhlinkontinenz, Wechsel des Inkontinenzmaterials, jeweils mit Menge,
      Uhrzeit und Bemerkung, auch offline vorgemerkt. Anzeige „letzter Stuhlgang heute / vor … Tagen“; Verlauf über 3, 7
      oder 14 Tage; Stornieren mit Grund; alles im Protokoll der Akte und in der Auskunft. Einstellung „Hinweis
      Stuhlgang“ (Tageszahl der Einrichtung, ohne Vorgabewert): erst damit zeigt die Tagesliste „Stuhlgang beobachten“,
      und nur für Personen, für die das Protokoll geführt wird.
- [x] **Schmerzeinschätzung bei eingeschränkter Kommunikation:** Lizenz an der Quelle geprüft: BESD (Deutsche
      Schmerzgesellschaft) ist nur nichtkommerziell frei; kommerzielle Nutzung und elektronische Veröffentlichung
      brauchen die vorherige schriftliche Erlaubnis. Bei PAINAD (Warden et al. 2003) ist das Nutzungsrecht nicht geklärt.
      Darum liefert CareOS keines davon mit. Stattdessen „Eigene Instrumente“ unter Konfiguration (Administration):
      Name, Quelle und Nutzungsrecht (Pflicht), Fragen mit Antworten und Punkten, Bereiche laut Instrument (optional) und
      Intervall – alles von der Einrichtung. Das Instrument erscheint in den Einschätzungen neben dem Katalog (mit
      Quelle), Fälligkeiten nach dem Intervall der Einrichtung. Nach der ersten Einschätzung ergibt eine Änderung eine
      neue Fassung, frühere Ergebnisse bleiben; „nicht mehr anbieten“ statt löschen; alles im Protokoll.
- [x] **Wünsche am Lebensende und Todesfall:** In den Stammdaten neben „Vorsorge & Vertretung“ die Karte „Wünsche
      für die letzte Lebensphase“ (Ort, Begleitung, religiöse oder spirituelle Wünsche, Bestattung, wer informiert
      werden soll, Weiteres; besprochen mit/am). Im Änderungsprotokoll stehen nur die geänderten Abschnitte, nicht der
      Inhalt. Die Punkte der „Checkliste nach einem Todesfall“ legt die Administration unter Leitung · Konfiguration
      selbst fest (keine Vorgabe); beim Erfassen des Todesfalls werden sie für die Person übernommen und in der Karte
      „Ablauf nach dem Todesfall“ mit Zeit, Person und Vermerk abgehakt. Für frühere Todesfälle lässt sich die
      Checkliste nachträglich übernehmen. Beides ist Teil der Auskunft (Datenexport).
- [x] **Evakuierungs- und Notfallliste:** In den Stammdaten die Karte „Brandfall & Evakuation“ mit der Mobilität im
      Notfall (geht selbständig, mit Hilfsmittel oder Begleitung, Rollstuhl, bettlägerig) und Hinweisen wie Sauerstoff;
      Änderungen mit eigenem Protokolleintrag. Unter Belegung & Eintritt je Wohnbereich „Evakuierungsliste“: A4 mit
      Zimmer, Name, Mobilität, Hinweisen (Reanimationsstatus, laufende Isolation, eigene Hinweise), Kästchen zum
      Abhaken, Zählung nach Mobilität und Stand mit Datum und Uhrzeit; extern verlegte Personen als abwesend markiert.

### Niedrig / UI/UX

- [x] **Tippflächen auf dem Handy:** Namenslinks in Dokumentation › Visite und Alltag & Aktivierung › Teilnahme je
      Person (sowie in den Tabellen der Leistungsauswertung) sind auf dem Handy mindestens 24 px hoch (WCAG 2.2,
      2.5.8); Optik unverändert. Klicktest `e2e/touch-targets.spec.ts` misst jede Tippfläche.

## Analyse vom 03.10.2026 (dritter Rundgang): noch zu erstellen

Fachliche Lücken der Akte; was die Einrichtung festlegt, bleibt bei ihr (keine Vorgaben, keine Empfehlungen).

### Hoch

- [x] **Diagnosen je Person:** Karte „Diagnosen“ in den Stammdaten: Bezeichnung wie von Ärztin/Arzt gestellt,
      freiwilliger ICD-10-Code (nur die Form wird geprüft, keine Code-Datenbank), seit, Quelle, Haupt- oder
      Nebendiagnose, aktuell oder abgeschlossen (mit Datum), Bemerkung. Überholte Diagnosen werden abgeschlossen,
      Fehleinträge mit Begründung entfernt; Schutz gegen gleichzeitige Änderungen; alles im Protokoll der Akte. Aktuelle
      Diagnosen stehen im Überleitungsbogen, in Visite und Visitenliste; alle in der Auskunft.

### Mittel

- [x] **Impfungen:** Karte „Impfungen“ in den Stammdaten: Datum, Impfung gegen (frei, bisher verwendete
      Bezeichnungen zur Auswahl), Präparat, Charge, im Haus oder extern, geimpft von, Bemerkung; Fehleinträge mit
      Begründung entfernen, alles im Protokoll der Akte. Unter Isolation & Ausbruch der „Impfstatus“ je Wohnbereich:
      wer gegen die gewählte Impfung geimpft ist, auf Wunsch nur seit einem frei gewählten Datum (kein vorgegebener
      Zeitraum). Letzte Impfung je Art im Überleitungsbogen, alle in der Auskunft. Keine Empfehlungen durch CareOS.
- [x] **Hilfsmittel und persönliche Gegenstände:** Karte „Hilfsmittel & Gegenstände“ in den Stammdaten: Art
      (Hilfsmittel oder persönlicher Gegenstand), Gegenstand (häufige zur Schnellauswahl), Kennzeichnung, Standort,
      Bemerkung; „nicht mehr vorhanden“ mit Grund, bleibt im Verlauf; Schutz gegen gleichzeitige Änderungen; alles im
      Protokoll der Akte. Im Überleitungsbogen alle vorhandenen mit Kästchen „mitgegeben“; in der Auskunft enthalten.

### Niedrig / UI/UX

Automatischer Rundgang über 89 Seiten je Desktop (1440 px) und Handy (390 px): keine Skriptfehler, kein seitliches
Scrollen, je Seite eine Hauptüberschrift, keine unbeschrifteten Felder. Gefunden:

- [x] **Tippflächen unter 24 px (WCAG 2.2, 2.5.8), auch auf dem Desktop:** Textknöpfe der leeren Startseiten-Karten
      (15 px), Übergabe › „Als Übergabepunkt übernehmen“ (15 × 16 px), Teamleitung › Aufgaben › „Archivieren“ (14 px),
      Namenslinks in Visite und Teilnahme (15–21 px). Erledigt: Trefferfläche über Innenabstand und gleich grossen
      negativen Aussenabstand auf mindestens 24 px vergrössert, Optik unverändert; `e2e/touch-targets.spec.ts` misst
      alle diese Stellen auf Handy und Computer.
- [x] **QR-Etiketten auf dem Handy:** Die Vorschau zeigt die Etiketten auf dem Handy untereinander (kein seitliches
      Scrollen mehr); der Druck bleibt A4 mit 3 × 7 Etiketten. Im Klicktest geprüft.

## Neue Funktionen ohne Medizinprodukt (03.10.2026): noch zu erstellen

Nur Dokumentation, Organisation und Kommunikation; Fristen, Grenzen und Listen legt die Einrichtung fest. Zweckbestimmung
als Entwurf in `docs/ZWECKBESTIMMUNG.md`.

### Hoch

- [x] **Einwilligungen & Freigaben je Person:** Themen legt die Administration unter Leitung › Konfiguration fest
      (keine Vorgabe). In der Akte unter Stammdaten die Karte „Einwilligungen & Freigaben“: Stand je Thema (zugestimmt,
      abgelehnt, widerrufen, nicht erfasst), Entscheid mit wer (Person oder Vertretung), Datum und Bemerkung; ein
      neuer Entscheid gilt ab seinem Datum, frühere bleiben im Verlauf; Widerruf mit Datum. Neue Seite Bewohner ›
      Einwilligungen: Stand je Thema und Wohnbereich (abgelehnt und widerrufen zuerst). Protokoll der Akte und Auskunft.
- [x] **Wartung von Geräten und Hilfsmitteln der Einrichtung:** Leitung › Qualität & Kennzahlen › „Geräte &
      Prüfungen“: Gerät mit Kategorie, Inventarnummer, Hersteller, Standort, Prüffrist in Monaten (von Einrichtung bzw.
      Hersteller, keine Vorgabe) und nächster Prüfung; Prüfung mit Datum, Ergebnis (in Ordnung / Mängel mit
      Beschreibung), wer geprüft hat und nächster Prüfung (Vorschlag nach Frist, änderbar); ausser Betrieb mit Grund.
      Kennzahlen (in Betrieb, fällig, Mängel offen), Filter nach Kategorie. Benachrichtigung „Prüfung fällig“ an
      Personen mit Recht „Qualität verwalten“, einmal je Prüfzyklus. Alles im Änderungsprotokoll.
- [x] **Küchenliste je Wohnbereich:** Im Ernährungsplan je Wohnbereich „Küchenliste“: A4 quer mit Zimmer, Name,
      Kostform, Konsistenz, Allergien, Vorlieben, Hilfe beim Essen, Mahlzeitenrhythmus, Trinkmengenbegrenzung und
      Hinweisen aus dem Ernährungsplan; Personen ohne Plan erscheinen als „kein Ernährungsplan“; Stand mit Datum und
      Uhrzeit.

### Mittel

- [x] **Temperaturprotokoll Medikamentenkühlschrank:** Kühlschränke der Einrichtung, Messungen mit Wert und Person;
      Grenzen und Messrhythmus legt die Einrichtung fest; Hinweis bei fehlender Messung bzw. Wert ausserhalb der
      Grenzen der Einrichtung. Umgesetzt unter Medikation › Kühlschrank: Grenzen und Messrhythmus je Kühlschrank (leer =
      kein Hinweis), Messung mit Datum, Uhrzeit, Wert und Person; ausserhalb der Grenzen ist die Massnahme Pflicht;
      Messungen speichern die damals geltenden Grenzen; Erinnerung an die Leitung Medikation bei fälliger Messung und
      bei Wert ausserhalb der Grenzen; Verlauf der letzten 31 Tage.
- [x] **Fahrdienst und externe Termine:** Arzt, Spital, Coiffeur, Fusspflege mit Transport, Begleitung und
      mitzugebenden Unterlagen; Tagesliste für den Empfang. Umgesetzt: Termin im Kalender als „ausser Haus“ markieren
      mit Transport, Abholzeit, Transport-Details, Begleitung und Unterlagen (Kategorien Coiffeur und Fusspflege
      neu); Kalender › Fahrdienst zeigt die Tagesliste (Heute, Morgen oder Datum) mit Vermerk von Abfahrt und
      Rückkehr samt Person (rückgängig möglich, im Protokoll der Akte) und Druck auf A4 quer.
- [x] **Einarbeitung neuer Mitarbeitender:** Checkliste je Rolle (Punkte legt die Einrichtung fest), mit Abzeichnen
      durch die einarbeitende Person. Umgesetzt unter Leitung › Mitarbeitende › Einarbeitung: Checklisten für alle
      Rollen und je Rolle; beim Start werden die Punkte für die Person übernommen (spätere Änderungen betreffen nur
      neue Einarbeitungen); die einarbeitende Person erhält einen Hinweis und zeichnet ab (mit Name und Uhrzeit,
      zurücknehmbar); Abschluss durch die Leitung, wenn alle Punkte abgezeichnet sind; alles im Änderungsprotokoll.
- [x] **Rückmeldungen und Beschwerden:** von Angehörigen und Bewohnenden, mit Bearbeitung, Antwort und Frist der
      Einrichtung; Auswertung für das Qualitätsmanagement. Umgesetzt unter Qualität & Kennzahlen › Rückmeldungen:
      Beschwerde, Anregung oder Lob mit Herkunft, Weg, Person bzw. Wohnbereich und Thema; Zuständigkeit (mit Hinweis),
      Massnahmen, Antwort mit Datum, Abschluss; Antwortfrist in Tagen legt die Einrichtung fest (leer = keine Frist,
      nicht bei Lob), Erinnerung bei abgelaufener Frist; Auswertung je Jahr nach Art, Herkunft, Thema und Monat, Anteil
      in der Frist beantwortet und Median bis zur Antwort; in der Auskunft der Person enthalten.

### Niedrig

- [x] **Wäsche- und Inventarliste beim Eintritt:** Kleidung und Einrichtungsgegenstände der Person mit Kennzeichnung.
      Umgesetzt als Erweiterung von „Hilfsmittel & Gegenstände“ in der Akte: neue Arten Kleidung / Wäsche und
      Einrichtung mit Anzahl und Schnellauswahl; „Inventarliste drucken“ (A4 hoch, je Art gegliedert, mit Zimmer,
      Eintrittsdatum und Unterschriftsfeldern für Person bzw. Vertretung und Mitarbeitende). Im Überleitungsbogen
      erscheinen weiterhin nur Hilfsmittel und persönliche Gegenstände.

### Braucht eine externe Fachperson

- [ ] **Zweckbestimmung prüfen lassen:** `docs/ZWECKBESTIMMUNG.md` und die dort genannten Funktionen nahe an der
      Grenze (Wechselwirkungs-Hinweise, Einschätzungsinstrumente, Vitalwert-Grenzen und Trendhinweise, CareOS KI)
      durch eine Fachperson für Medizinprodukte-Regulierung prüfen lassen.

## Abgleich mit careCoach (06.10.2026): noch zu erstellen

Vergleich mit careCoach (topCare Management AG) nach den öffentlichen Angaben des Herstellers: Leistungskataloge
BESA, RAI-NH, Plaisir und interRAI (LTCF, HC, CMH), Heim und Spitex, Einstufung, Abrechnung, Statistik,
Schnittstellen (RAIsoft.net, BESA, Apotheken und Blister, Administrationssysteme, Rufsystem Ascom), Dokumentation nach
Abweichungen, Diktat mit KI-Umformulierung, offline mobil. CareOS ist in Kommunikation, Office, Portalen, KI,
Dienstplan, Sicherheit und Sprachen weiter; es fehlt vor allem, was die Finanzierung der Pflege betrifft. Es gilt
weiter: keine Diagnosen, keine Dosierungen, keine erfundenen Tarife, Grenzen oder Fristen.

### Hoch (ohne diese Punkte ersetzt CareOS careCoach im Heim nicht)

- [x] **Bedarfsabklärung – eigenes Instrument „CareOS Kompass“** (Entscheid vom 06.10.2026: eigenes Instrument mit
      eigenem Namen statt Lizenz von interRAI oder BESA; kein Medizinprodukt, Zweck siehe `docs/ZWECKBESTIMMUNG.md`).
      Hinweis: Für die Einstufung zur Finanzierung (KVG) bleibt ein vom Kanton anerkanntes Instrument massgebend; der
      Kompass ersetzt es nicht.
  - [x] Schritt A: Instrument mit 13 Bereichen und beschreibenden Antwortstufen (ohne Punkte), Abklärung Schritt für
        Schritt mit Hinweisen aus der Akte, automatisches Speichern, Übernahme früherer Antworten nur auf Knopfdruck,
        Handlungsbedarf je Bereich als Entscheid der Fachperson, Abschluss erst vollständig, Verwerfen mit Grund.
        Fristen (erste Abklärung nach Eintritt, Folgeabklärung) legt die Einrichtung in der Konfiguration fest.
        Ersetzt den bisherigen vereinfachten RAI-Arbeitsplatz; frühere Erfassungen bleiben im Verlauf.
  - [x] Schritt B: Bericht zum Drucken (A4, alle Antworten mit der vorherigen Abklärung daneben, „mehr/weniger als
        zuvor“, Ressourcen, Wünsche, Handlungsbedarf, Gesamtbild, Unterschriften). Karte „Handlungsbedarf“ der
        letzten Abklärung: je Bereich „Als Ziel übernehmen“ – Pflegebereich, Problem und Ressourcen aus dem Kompass,
        Ziel und Überprüfungsdatum von der Fachperson; ohne offenen Pflegeplan wird einer angelegt. Pflegeprozess der
        Akte zeigt den Kompass im Schritt „Einschätzung“; Tagesliste „Kompass fällig/fortsetzen“ für Personen mit
        Berechtigung für den Kompass.
  - [x] Schritt C: Eigene Adresse `/kompass` mit „Abklärung“ (frühere Links unter `/rai` leiten weiter).
        Berichte: „Unterstützung je Bereich“ je Wohnbereich oder ganzes Haus – je Bereich Personen mit Unterstützung
        oder Beobachtung und mit Handlungsbedarf, aufklappbar bis zur Verteilung der Antworten je Frage; nur gezählt,
        Grundlage ist die letzte abgeschlossene Abklärung je Person; Export als CSV. Im Abschluss „Entwurf mit
        CareOS KI“ für das Gesamtbild (mit Berechtigung für die KI): ohne Namen, nur aus den Antworten, Notizen und
        Entscheiden der Fachperson; der Entwurf wird erst auf „Ins Gesamtbild übernehmen“ eingesetzt.
- [ ] **Bewohneradministration und Abrechnung:** Taxen (Pension, Betreuung, Pflege nach Stufe) mit Aufteilung nach
      Kostenträger (Versicherer, Restfinanzierung, Anteil der Person), Abwesenheiten (Spital, Ferien) mit ihrer Wirkung
      auf die Taxen, Monatsrechnung mit QR-Rechnung, elektronische Rechnung an Versicherer (Forum Datenaustausch) und
      Export in die Finanzbuchhaltung. Tarife legt die Einrichtung bzw. der Kanton fest. Setzt die Pflegestufe voraus.
  - [x] Schritt A: Unter „Bewohner › Abrechnung“ (eigenes Recht „Abrechnung verwalten“) erfasst die Einrichtung ihre
        Taxen (Pension, Betreuung, weitere Leistungen) mit Preis je Tag ab einem Datum, Kostenträger, Geltung (alle
        oder nur zugewiesene Personen) und Regel bei Spital bzw. Ferien („n Tage voll, danach p %“), dazu die
        Pflegetarife je Pflegestufe und Kostenträger sowie die Regel zum Austrittstag (ohne Festlegung keine
        Berechnung). Je Person: Pflegestufe mit Verlauf ab Datum, Abwesenheiten (erster und letzter ganzer Tag),
        zusätzliche Taxen; Vorschau des Monats je Kostenträger, jeder Tag einzeln berechnet. Stornieren mit Grund,
        alles im Protokoll. CareOS gibt keine Beträge vor.
  - [x] Schritt B: Rechnungen für den Anteil der Person je abgeschlossenem Monat („Rechnungen“, einzeln oder als
        Lauf für alle bereiten Personen): fortlaufende Nummer ohne Lücken, Positionen beim Erstellen festgehalten,
        Rechnungsadresse je Person (z. B. Angehörige, Beistandschaft), Zahlungsangaben der Einrichtung mit
        Zahlungsfrist. Druck A4 mit Zahlteil als Schweizer QR-Rechnung (Bibliothek swissqrbill nach SIX-Vorgaben;
        QR-Referenz bei QR-IBAN, sonst Creditor Reference); ausserhalb von CH/LI steht die IBAN auf der Rechnung.
        Storno mit Grund, danach neu verrechnen. Krankenversicherung und öffentliche Hand folgen in Schritt C.
  - [x] Schritt C: Zahlungseingang von Hand oder aus der Bankdatei (camt.054/053: Zuordnung über die Referenz,
        verbucht erst nach Bestätigung, nie doppelt und nie über den offenen Betrag), Storno mit Grund, offene Posten
        mit Fälligkeit; CSV-Exporte „Rechnungsjournal“ (Finanzbuchhaltung) und „Kostenträger“ (Anteile von
        Krankenversicherung, öffentlicher Hand und anderen je Person mit Versicherung und Tagen).
  - [ ] Elektronische Rechnung an Versicherer (Forum Datenaustausch, generalInvoice) und Abrechnung der
        Restfinanzierung: Standard und Vorgaben der Kantone an der Quelle prüfen, dann umsetzen.
- [ ] **Statistik der sozialmedizinischen Institutionen (SOMED, BFS):** jährliche Pflichtlieferung der Schweizer
      Heime; Inhalt und Format an der Quelle prüfen, Export aus den vorhandenen Daten.
- [ ] **Datenstandort Schweiz:** Heute Railway, Region Europa. Viele Heime und Kantone erwarten Hosting in der
      Schweiz und Nachweise (z. B. ISO 27001, externer Sicherheitstest). Entschieden am 06.10.2026: ja, nach
      Abschluss der übrigen Punkte.

### Mittel (damit CareOS klar besser ist)

- [x] **Dokumentation nach Abweichungen:** Je Massnahme der Pflegeplanung lassen sich Tageszeiten für den Nachweis
      wählen (Morgen, Mittag, Abend, Nacht wie die Medikamentenrunden; ohne Wahl kein Nachweis je Tageszeit).
      Dokumentation › Nachweis zeigt je Wohnbereich, Tag und Tageszeit die geplanten Massnahmen je Person: „Alle wie
      geplant“ bestätigt mit einem Klick, „Abweichung erfassen“ hält „teilweise“ oder „nicht durchgeführt“ mit Pflichtgrund
      fest und legt dazu einen wichtigen Eintrag in der Pflegedokumentation an. Erst ab Beginn der Tageszeit, frühere Tage
      als Nachtrag; nichts wird ohne Bestätigung als durchgeführt vermerkt. Stornieren mit Grund statt Löschen; alles im
      Protokoll der Akte und in der Auskunft.
- [x] **Diktat mit KI umformulieren:** Rohtext aus der Erkennung auf dem Gerät wird pseudonymisiert zu einem
      Pflegebericht-Entwurf umformuliert, den die Fachperson prüft. Entschieden am 06.10.2026: ja (nur der Text,
      keine Tonaufnahme). Umgesetzt in der Schnelldokumentation und im Dialog „Eintrag“: „Mit CareOS KI
      umformulieren“ (nur mit Berechtigung für die KI und eingerichteter KI). Namen aller Bewohnenden und Mitarbeitenden
      der Einrichtung gehen nur als Platzhalter ([Person 1] …) an die KI und werden im Vorschlag wieder eingesetzt;
      der Vorschlag ersetzt den Text erst mit „Text übernehmen“, gespeichert wird wie bisher mit dem Formular.
- [x] **Vorlagen für die Pflegeplanung:** Standardpläne und Massnahmenkataloge der Einrichtung (keine Vorgaben von
      CareOS), bei einer Person übernehmen und anpassen. Unter Pflegeplanung → Vorlagen (Recht Qualität verwalten)
      legt die Einrichtung Standardpläne (Pflegebereich, Problem, Ressourcen, Ziel, Überprüfung nach Tagen, Massnahmen)
      und einen Massnahmenkatalog an; nicht mehr gebrauchte Vorlagen werden nicht mehr angeboten, bleiben aber
      nachvollziehbar. Beim neuen Ziel füllt „Vorlage“ die Felder vor, die Massnahmen sind einzeln abwählbar und alles
      bleibt vor dem Speichern änderbar; bei einer neuen Massnahme hilft „Aus dem Katalog“. Ziel und Massnahmen werden
      gemeinsam gespeichert und protokolliert.
- [ ] **Rufsystem anbinden:** Rufe (z. B. Ascom, Teletronic) in CareOS anzeigen und dokumentieren, Reaktionszeiten
      für die Qualität. Braucht die Schnittstelle des Herstellers.
- [ ] **Apotheke und Blister elektronisch:** Bestellungen an die Apotheke elektronisch, Rückmeldung von Verblisterung
      und Änderungen; heute nur über das Apothekenportal.
- [x] **Lohn-Export der Zeiterfassung:** Stunden, Zuschläge und Abwesenheiten im Format der Lohnbuchhaltung (z. B.
      Abacus, Sage); Lohnarten legt die Einrichtung fest. Unter Dienstplan › Einstellungen › Lohnarten legt die Leitung
      ihre Lohnarten an (Nummer und Bezeichnung aus der Lohnbuchhaltung, dazu der Wert der Monatsauswertung: Ist-,
      Soll-, Saldo-, Nacht-, Wochenend-, Feiertagsstunden oder Abwesenheitstage je Art); die Personalnummer steht im
      Personalprofil. „CSV Lohn“ in der Arbeitszeit liefert je Person und Lohnart eine Zeile (Periode, Personalnummer,
      Person, Lohnart, Bezeichnung, Menge, Einheit), nur Personen mit diesem Stammwohnbereich (keine doppelte
      Abrechnung). Ansätze und Zuschläge in Franken rechnet die Lohnbuchhaltung.
  - [ ] Importformate einzelner Lohnprogramme (z. B. Abacus, Sage) nach deren Schnittstellenbeschreibung, sobald ein
        Kunde sie vorgibt.

### Niedrig (weitere Märkte und Wechsel)

- [ ] **Spitex und betreutes Wohnen:** Klientenverwaltung, ärztliche Verordnung bzw. Bedarfsmeldung, Einsatz- und
      Tourenplanung, Leistungserfassung unterwegs mit Zeitstempel, Leistungsarten nach KLV, Abrechnung.
- [ ] **Datenübernahme aus careCoach:** neben Bewohnern und Mitarbeitenden (CSV, vorhanden) auch der Verlauf der
      Pflegedokumentation, Pflegeplanung und Medikation, sobald ein Exportformat vorliegt.

## Braucht eine Entscheidung oder externe Quelle

- **Backups / Disaster Recovery:** Für diese Installation in Railway eingeschaltet; bei weiteren Installationen je
  Installation einschalten (`docs/BETRIEB.md`). Ziele für RPO und RTO legt der Betreiber mit der Einrichtung fest.

## Bekannte Grenzen

- Rollen-Schlüssel sind installationsweit eindeutig: zwei Einrichtungen können nicht denselben Schlüssel verwenden.
- Das Löschen von Mitarbeitenden entfernt das Konto endgültig; für ausgeschiedene Personen besser „Sperren & archivieren“.
