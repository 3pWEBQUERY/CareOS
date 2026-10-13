# CareOS – Bedienkonzept

CareOS (früher CareCore) wird wie das Betriebssystem eines Tablets bedient: Jeder Bereich ist eine **App** mit eigenem
Namen, eigenem Symbol und eigener Farbe. Wer eine App einmal gesehen hat, findet sie überall wieder.

**Warum:** In der Pflege arbeiten viele Menschen, die Deutsch nicht als Muttersprache sprechen oder selten mit Computern
arbeiten. Sie sollen CareOS ohne Schulung verstehen: sofort sehen, wo was ist, und es sich leicht merken.

## 1. Analyse der bisherigen Bedienung

Grundlage: alle Seiten der Navigation am Computer (1440 px) und auf dem Handy (390 px), angemeldet als Administration
mit Demodaten.

| #   | Befund                                                                                                                                                                                                       | Folge für Pflegende                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| 1   | **Nur Symbole in der Seitenleiste.** 14 Knöpfe ohne Text; die Bedeutung erschien nur beim Darüberfahren mit der Maus (auf Tablet und Handy gar nicht).                                                       | Man muss raten oder ausprobieren. Wer Symbole anders deutet (Kultur, Sprache), findet nichts.             |
| 2   | **Gleiche Symbole für Verschiedenes.** Herz für „Mein Dienst“ und für „Vitalwerte“; Kalender für drei Bereiche; Ordner für „Dokumente“, „Cloud“ und „Hilfe“.                                                 | Symbole helfen nicht beim Unterscheiden.                                                                  |
| 3   | **Drei Ebenen und mehrere Wege.** Leiste → Ausklappmenü des Hauptbereichs → Bereich → Reiter. Dazu Schnellzugriff, Startseiten-Kacheln, Handy-Menü und „+“-Knopf, die teils dieselben Ziele anders benennen. | Kein festes Bild im Kopf („Wo war das nochmal?“). Ausklappmenüs verschwinden, sobald die Maus wegrutscht. |
| 4   | **Fantasie-Namen statt Wörter.** „CareCore Med“, „CareCore Shift“, „CareCore Tasks“, „CareCore Learn“, „CareCore One“, „CareCore Insights“ über den Seiten.                                                  | Englische Kunstwörter sagen nichts darüber, was die Seite tut.                                            |
| 5   | **Viele Reiter mit Fachwörtern.** Bis zu 11 Reiter (Qualität), 8 in der Medikation (BtM-Kontrolle, eMediplan, Bestände …), kleine Schrift (11 px).                                                           | Schwer zu lesen, besonders auf dem Tablet und für Menschen mit wenig Deutsch.                             |
| 6   | **Gemischte Bereiche.** „Vitalwerte & Ernährung“, „Planung & Einschätzungen“, „Alltag & Aktivierung“, „Team & Wissen“ – Namen aus zwei Begriffen.                                                            | Man sucht „Trinkprotokoll“ nicht unter „Vitalwerte“.                                                      |
| 7   | **Volle Kopfzeile.** Ort, Bewohner, Suche, KI, Tastaturkürzel, Hinweise, Profil – sieben Bedienelemente, drei davon nur als Symbol.                                                                          | Viel Ablenkung oben, wichtige Dinge gehen unter.                                                          |
| 8   | **Kein „Wo bin ich?“.** Die Seite zeigte nicht, in welchem Bereich man ist; nur ein kleiner, blauer Reiter war markiert.                                                                                     | Orientierung geht nach ein paar Klicks verloren.                                                          |
| 9   | **Handy-Menü als lange Liste.** Alle Bereiche untereinander mit allen Reiternamen in kleiner Schrift.                                                                                                        | Langes Scrollen, viel Text.                                                                               |

## 2. Die fünf Regeln von CareOS

1. **Jedes Symbol hat ein Wort.** Kein Knopf erklärt sich nur über ein Bild.
2. **Eine Farbe pro App – überall gleich.** Medikamente sind immer rosa, Dokumentation immer grün, Bewohner immer blau.
   Man erkennt die App an der Farbe, bevor man liest.
3. **Immer am selben Ort.** Die Leiste zeigt immer dieselben Apps in derselben Reihenfolge. „Start“ ist immer oben
   (Computer) bzw. links (Handy).
4. **Nur eine Ebene.** Start → App → Reiter. Keine Ausklappmenüs, keine Untermenüs.
5. **Einfache Wörter.** App-Namen sind Alltagswörter („Medikamente“ statt „Medikation“, „Essen & Trinken“,
   „Nachrichten“, „Dateien“). Jede App hat einen Satz, der sagt, wofür sie da ist.

## 3. So ist CareOS aufgebaut

### Startbildschirm

Wie auf einem Tablet: links gross die Uhr mit Datum und Begrüssung, darunter zwei Widgets – **„Mein Dienst“**
(Dienstzeit und Wohnbereich, eingecheckt oder geplant, Fortschritt der Aufgaben, Zähler für Aufgaben, Übergaben und
Nachrichten) und **„Als Nächstes“** (die nächsten offenen Punkte des Dienstes mit Uhrzeit). Rechts alle Apps, die die
Person nutzen darf, als Symbole mit Namen und ein Suchfeld. Eine rote Zahl an einer App heisst: Hier wartet etwas.
Auf dem Handy stehen Uhr und Apps zuerst, die Widgets darunter.

### Menüleiste (Computer)

Oben über die ganze Breite: links das CareOS-Zeichen (öffnet „Alle Apps“), daneben Symbol und Name der geöffneten App
(„Wo bin ich?“) und ihre Seiten als Menüpunkte – die gewählte Seite ist hinterlegt. Rechts der Status: Wohnbereich,
Bewohner, Suche (⌘ K), KI, Hinweise, Uhr und Profil.

### Dock (Computer) und untere Leiste (Handy)

Am Computer unten das Dock, auf dem Handy die untere Leiste. Immer dieselben Apps in derselben Reihenfolge; das Dock
zeigt beim Darüberfahren den Namen, ein Punkt markiert die geöffnete App.

| Dock (Computer) | Handy (unten) |
| --------------- | ------------- |
| Start           | Start         |
| Mein Dienst     | Bewohner      |
| Bewohner        | Doku          |
| Dokumentation   | Medikamente   |
| Medikamente     | Alle Apps     |
| Aufgaben        |               |
| Nachrichten     |               |
| Alle Apps       |               |
| Einstellungen   |               |

### „Alle Apps“

Öffnet sich aus dem Dock, über das CareOS-Zeichen (oder mit der Taste **L**) als Launchpad im Vollbild: alle Apps als
Symbole, oben ein Suchfeld („btm“ findet die App Medikamente, weil „BtM-Kontrolle“ eine ihrer Seiten ist) und die
zuletzt geöffneten Seiten. Unten: Einstellungen und Hilfe. Ein Klick auf eine freie Stelle oder Esc schliesst.

### App-Symbole

Dunkle Kachel, darauf das Zeichen leuchtend in der Farbe der App (Start, Alle Apps und Einstellungen in Graphit).

### Die Apps

| Gruppe            | App                   | Farbe      | Wofür (Satz in der App-Übersicht)                               |
| ----------------- | --------------------- | ---------- | --------------------------------------------------------------- |
| Mein Dienst       | Mein Dienst           | Orange     | Mein Tag, Übergabe und was seit dem letzten Dienst passiert ist |
|                   | Aufgaben              | Gelb       | Was ich heute erledigen muss                                    |
|                   | Mein Dienstplan       | Blau       | Wann ich arbeite, Wünsche und Zeiten                            |
| Bewohner & Pflege | Bewohner              | Blau       | Alle Bewohner und ihre Pflegeakte                               |
|                   | Dokumentation         | Grün       | Pflegebericht schreiben und nachlesen                           |
|                   | Medikamente           | Rosa       | Medikamente richten, geben und kontrollieren                    |
|                   | Vitalwerte            | Rot        | Blutdruck, Puls, Gewicht und mehr messen                        |
|                   | Essen & Trinken       | Hellgrün   | Trinkmenge und Ernährung festhalten                             |
|                   | Wunden                | Koralle    | Wunden beschreiben, fotografieren, verfolgen                    |
|                   | Pflegeplanung         | Violett    | Ziele, Massnahmen und Einschätzungen                            |
|                   | Aktivitäten           | Magenta    | Angebote im Alltag und wer teilnimmt                            |
| CareOS Kompass    | Kompass               | Türkis     | Pflegebedarf abklären und Berichte                              |
| Team & Wissen     | Neuigkeiten           | Hellblau   | Mitteilungen für das ganze Team                                 |
|                   | Schulungen            | Lila       | Kurse besuchen und Nachweise                                    |
|                   | Dokumente             | Indigo     | Standards, Weisungen und Formulare                              |
| Kommunikation     | Nachrichten           | Petrol     | Mit Kolleginnen, Kollegen und Angehörigen schreiben             |
|                   | Kalender              | Blau       | Termine im Haus und Fahrdienst                                  |
|                   | Dateien               | Himmelblau | Gemeinsame und eigene Dateien                                   |
| Leitung           | Qualität & Kennzahlen | Grün       | Ereignisse, Massnahmen und Zahlen                               |
|                   | Dienstplanung         | Blau       | Dienstplan für das Team erstellen                               |
|                   | Mitarbeitende         | Cyan       | Team, Einarbeitung und Rollen                                   |
|                   | Administration        | Graublau   | Einrichtung, Portal, Sprachen und Daten                         |

Die Gruppe „Leitung“ und einzelne Apps (z. B. Kompass, Dienstplanung, Administration) sieht nur, wer die Berechtigung
hat. Die Bezeichnung der Einrichtung (Bewohner, Patienten, Klienten) gilt in allen Namen.

## 4. Was sich geändert hat

- **Name:** CareCore heisst jetzt **CareOS** (Anmeldung, Titel, Hilfe, E-Mails, Dokumente). Die Unter-Marken
  („CareCore Med“, „CareCore Shift“ …) sind durch die Namen der Apps ersetzt.
- **Leiste:** Menüleiste oben und Dock unten (Handy: untere Leiste) statt Symbolleiste mit Ausklappmenüs.
- **Alle Apps:** neue Übersicht mit Beschreibung, Suche und zuletzt geöffneten Seiten (ersetzt Ausklappmenüs und
  Handy-Menü).
- **Startseite:** „Meine Apps“ statt „Schnellzugriff“; „Startseite anpassen“ statt „Arbeitsplatz bearbeiten“.
- **App-Kopf:** Symbol und Name der App über jeder Seite, grössere Reiter (40 px hoch, 13,5 px Schrift).
- **Neue Aufteilung:** „Vitalwerte & Ernährung“ ist in **Vitalwerte** und **Essen & Trinken** geteilt.
- **Einfachere Namen:** Medikation → Medikamente, Planung & Einschätzungen → Pflegeplanung, Alltag & Aktivierung →
  Aktivitäten, Team → Neuigkeiten, Messenger → Nachrichten, Cloud → Dateien, CareCore One → Kommunikation,
  Dienstplan (Leitung) → Dienstplanung.
- **Eigene Symbole:** „Mein Dienst“ hat ein eigenes Symbol (Sonnenaufgang) statt des Herzens der Vitalwerte.
- **Hilfe:** neue Kurzanleitung „So funktioniert CareOS“.
- **Dunkles Erscheinungsbild:** Die Farben der Apps bleiben gleich.

## 5. Was bewusst gleich bleibt

Damit bestehende Installationen ohne Eingriff weiterlaufen, behalten technische Kennungen den alten Namen:
Datenbanktabellen (`carecore_…`), Umgebungsvariablen (`CARECORE_…`), Adressen (`/c/carecore-one/…`),
Browser-Speicher (`carecore.…`), Kopfzeilen der Webhooks (`X-CareCore-…`), die gespeicherte Kennung der
Kompass-Abklärung und die bereits angewendeten Migrationen. Gespeicherte Startseiten bleiben erhalten („Meine Apps“
übernimmt den Platz des Schnellzugriffs).

**Übersetzungen:** Neue und umbenannte Texte (z. B. „Alle Apps“, „Medikamente“, „Essen & Trinken“) stehen im
Textkatalog und müssen unter Leitung › Administration › Sprachen neu übersetzt und geprüft werden; bis dahin erscheinen
sie auf Deutsch.

## 6. Empfohlene nächste Schritte

1. **Test mit echten Nutzerinnen und Nutzern:** 5 Pflegende, davon mindestens 3 mit wenig Deutsch oder wenig
   Computererfahrung. Aufgaben: „Trinkmenge von Frau Keller eintragen“, „Medikamentenrunde abschliessen“, „Übergabe
   lesen“. Messen: Zeit und Umwege.
2. **Reiter verringern:** Qualität & Kennzahlen (11 Reiter) in „Qualität“ und „Kennzahlen“ teilen; in Medikamente
   selten genutzte Seiten (Bestellungen, eMediplan, Kühlschrank) nur für die Fachverantwortung zeigen.
3. **Fachwörter erklären:** Kurze Erklärung beim ersten Kontakt („BtM = Betäubungsmittel“), Symbole für Reiter.
4. **Kopfzeile ruhiger:** Tastaturkürzel nur in der Hilfe; Symbolknöpfe (KI, Hinweise) mit Text am Computer.
5. **Leichte Sprache in den Apps:** Überschriften und Hilfetexte der Seiten nach denselben Regeln vereinfachen.
6. **Startseite je Rolle:** Für Pflege die Apps des Dienstes zuerst, für die Leitung Kennzahlen und Dienstplanung.
