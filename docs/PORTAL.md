# Portal für Angehörige und Ärztinnen/Ärzte

Das Portal (`/portal`) zeigt Angehörigen, Ärztinnen/Ärzten und Apotheken nur das, was die Einrichtung ausdrücklich
freigibt. Daten der Personen sind im Portal nur lesbar; schreiben lassen sich Nachrichten an die Pflege und, für
Apotheken, der Stand von Bestellungen.

## Zugänge

- Die Administration legt Zugänge an: **Leitung › Administration › Portal**.
  - Art: Angehörige, Ärztin / Arzt oder Apotheke.
  - Name, Benutzername, E-Mail und Telefon.
- Portal-Zugänge sind keine Konten der Mitarbeitenden. Eine Portal-Sitzung (Cookie `carecore_portal`, 12 Stunden)
  öffnet keine Schnittstelle der Pflege-App und umgekehrt.
- Beim Anlegen erscheint ein **Einmal-Passwort**, und zwar nur einmal. Bei der ersten Anmeldung muss es durch ein
  eigenes Passwort ersetzt werden (mindestens 12 Zeichen, Buchstaben und Ziffern). Vorher liefert das Portal keine
  Daten.
- Die Anmeldung wird gedrosselt wie bei den Mitarbeitenden.
- Ein neues Einmal-Passwort oder das Sperren beendet laufende Sitzungen sofort.

## Freigaben

Jede Freigabe legt fest:

- **für wen:** eine Person oder einen Wohnbereich. Ein Wohnbereich gilt für alle, die dort aktuell wohnen, zum
  Beispiel für eine Heimärztin.
- **welche Bereiche:**
  - Notfalldaten (Reanimationsstatus, Allergien)
  - Medikation (laufende Verordnungen)
  - Vitalwerte (30 Tage)
  - Pflegeberichte (14 Tage)
  - Termine (kommende)
  - Wunden (offene)
  - Nachrichten mit der Pflege

  Grunddaten (Name, Geburtsdatum, Wohnbereich, Zimmer) gehören zu jeder Freigabe.

- **Zeitraum:** optional ab und bis.
- **Grundlage:** Einwilligung der Person, vertretungsberechtigte Person oder Behandlungsverhältnis, mit einem Vermerk
  (z. B. „schriftliche Einwilligung vom …“). Welche Grundlage im Einzelfall nötig ist, entscheidet die Einrichtung.

Freigaben lassen sich ändern und widerrufen; ein Widerruf wirkt sofort. Anlegen, Ändern und Widerrufen wird
protokolliert. Hat ein Zugang mehrere Freigaben für dieselbe Person, gelten die Bereiche zusammen.

## Nachrichten

- Im Portal unter **Nachrichten**: neue Nachricht mit Betreff, zu einer freigegebenen Person oder (nur Apotheken)
  allgemein an die Einrichtung. Zu einer Person geht das nur, wenn die Freigabe den Bereich „Nachrichten mit der
  Pflege“ enthält.
- In CareOS unter **CareOS One › Portal-Nachrichten**: alle Unterhaltungen, ungelesene markiert. Antworten darf,
  wer die Person bearbeiten darf (`residents.write`); Unterhaltungen mit Apotheken beantwortet, wer Verordnungen
  verwaltet oder administriert, allgemeine die Administration. Von dort lassen sich auch neue Unterhaltungen
  beginnen.
- Eine neue Nachricht aus dem Portal meldet CareOS den Mitarbeitenden des Wohnbereichs, die antworten dürfen.

## Apothekenportal

- Bestellungen legt an, wer Verordnungen verwaltet: **Medikation › Bestellungen** (Apotheke, Person oder
  Wohnbereich, bis 30 Positionen mit Präparat, Menge und Einheit, Hinweis). Offene oder bestätigte Bestellungen
  lassen sich stornieren.
- Die Apotheke sieht im Portal unter **Bestellungen** alle Bestellungen an sie und setzt den Stand: bestätigt (mit
  voraussichtlichem Liefertag), geliefert oder abgelehnt (nur mit Grund). Jede Änderung wird den Mitarbeitenden
  gemeldet, die Verordnungen verwalten.
- Medikationspläne sieht die Apotheke über eine Freigabe mit dem Bereich Medikation, wie alle anderen Zugänge.
- Präparate werden als Text erfasst; eine lizenzierte Arzneimitteldatenbank wird nicht angebunden (CareOS ist kein
  Medizinprodukt).

## Hilfe

Im Portal erklärt der Reiter **Hilfe** (auch vor der Anmeldung erreichbar) die Anmeldung, die Personen, Nachrichten
und Bestellungen mit Bildschirmfotos (`public/portal-hilfe/`). Neu erzeugt werden sie mit
`node scripts/portal-help-screenshots.mjs` gegen eine laufende Testumgebung.

## Protokoll

Jeder Abruf von Daten einer Person wird mit Zeitpunkt, Person und freigegebenen Bereichen festgehalten, ebenso ein
Passwortwechsel und jede gesendete Nachricht. Die Administration sieht die letzten 100 Zugriffe beim Zugang.

## Technik

- Tabellen: `carecore_portal_accounts`, `carecore_portal_sessions`, `carecore_portal_grants` und
  `carecore_portal_access_log` (Migration 0052), `carecore_portal_threads`, `carecore_portal_messages`,
  `carecore_pharmacy_orders` und `carecore_pharmacy_order_items` (Migration 0055).
- Code: `lib/portal.ts` (Portal-Seite), `lib/portal-admin.ts` (Verwaltung), `lib/portal-messages.ts` und
  `lib/pharmacy.ts`.
- Der Service Worker speichert keine Portal-Daten auf dem Gerät.
