# Sprachen der Oberfläche

CareOS ist in Deutsch geschrieben. Diese Sprachen lassen sich einrichten:

- Französisch
- Italienisch
- Englisch
- Albanisch
- Kroatisch
- Serbisch (lateinische Schrift)
- Ungarisch

## Ablauf

1. **Texte sammeln:** `npm run i18n:extract` liest alle Texte der Oberfläche aus dem Code und schreibt sie nach
   `locales/catalog.json`: Beschriftungen, Knöpfe und Meldungen des Servers, dazu Vorlagen mit wechselndem Inhalt als
   Muster mit `{0}`, `{1}`. Die CI prüft, dass der Katalog aktuell ist.
2. **Entwürfe:** In **Leitung › Administration › Sprachen** erstellt „KI-Entwürfe für fehlende Texte“ Übersetzungen
   für je bis zu 200 fehlende Texte. Dafür werden nur Texte der Oberfläche an Mistral (`mistral-small-latest`,
   Schlüssel `MISTRAL_API_KEY`) übermittelt, keine Personendaten. Entwürfe lassen sich auch von Hand erfassen.
3. **Prüfen:** Die Administration prüft jeden Text. „Speichern und als geprüft markieren“ gilt für einen Text;
   „Angezeigte Entwürfe als geprüft markieren“ gilt für die angezeigte Seite (höchstens 50 Texte). Platzhalter wie
   `{0}` müssen erhalten bleiben. „App in dieser Sprache ansehen“ zeigt die App mit Entwürfen, um sie im
   Zusammenhang zu prüfen; das sieht nur die Administration.
4. **Freigeben:** Erst eine freigegebene Sprache können Mitarbeitende wählen (Einstellungen › Darstellung ›
   Sprache). Im Portal erscheint dann eine Sprachwahl. Die Freigabe lässt sich zurückziehen; die Personen sehen dann
   wieder Deutsch.

Mitarbeitende sehen **nur geprüfte** Übersetzungen. Was fehlt oder nur als Entwurf vorliegt, erscheint auf Deutsch.
Alle Änderungen werden protokolliert.

## Wie übersetzt wird

`app/components/translator.tsx` übersetzt im Browser angezeigte Texte und die Attribute `placeholder`, `title`,
`aria-label` und `alt`, ohne das Aussehen zu verändern. Übersetzt werden nur **ganze Texte, die im Katalog stehen**;
erfasste Inhalte (Berichte, Namen, Notizen) bleiben so, wie sie erfasst wurden. Bereiche mit `translate="no"` bleiben
unberührt. Die Seite ist bis zur Übersetzung kurz verborgen (höchstens 1,5 Sekunden). Das Wörterbuch wird auf dem
Gerät zwischengespeichert, damit die Sprache auch ohne Verbindung gilt.

## Grenzen

- Datums- und Zahlenformate folgen weiterhin der Schweizer Schreibweise (de-CH).
- Texte, die im Code aus mehreren Teilen zusammengesetzt sind, werden teils nur stückweise übersetzt. Sie erscheinen
  im Katalog als einzelne Teile oder Muster.
- Ausdrucke (z. B. Dienstplan, BtM-Buch) werden wie die Seite übersetzt, auf der sie erzeugt werden.
