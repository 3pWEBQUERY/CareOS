# CareOS Sidebar – Design QA

## Prüfgrundlage

- Source of visual truth (Aufbau): `/Users/alexander/Downloads/ChatGPT Image 7. Sept. 2026, 23_17_02.png`
- Source of visual truth (Farbsemantik): `/Users/alexander/Downloads/CareOS – Product Requirements Document (PRD).md`, Kapitel 50–52
- Source of visual truth (Körperkarte): `/Users/alexander/Desktop/Bildschirmfoto 2026-09-09 um 21.26.37.png`
- Implementierung, ausgeklappt: `./qa-sidebar-blue-final.png`
- Implementierung, eingeklappt: `./qa-sidebar-blue-collapsed-final.png`
- Implementierung mit finalem 6-Pixel-Radius: `./qa-radius-6px-final.png`
- Vergrößerter Such-Popover: `./qa-search-popover-large-final.png`
- Vollständig deutsche Webnavigation: `./qa-navigation-german-final.png`
- Bewohnerverzeichnis, Desktop: `./qa-residents-page-final.png`
- Bewohnerverzeichnis, Mobil: `./qa-residents-page-mobile.png`
- Vollflächige Bewohnerakte, Desktop: `./qa-resident-record-fullscreen.png`
- Vollflächige Bewohnerakte, Mobil: `./qa-resident-record-fullscreen-mobile.png`
- Dokumentationsansicht in der Bewohnerakte, Desktop: `./qa-resident-documentation-view.png`
- Dokumentationsansicht in der Bewohnerakte, Mobil: `./qa-resident-documentation-mobile.png`
- Dokumentationskennzeichnungen, Desktop: `./qa-documentation-flags.png`
- Dokumentationskennzeichnungen, Mobil: `./qa-documentation-flags-mobile.png`
- Stammdatenansicht, Desktop: `./qa-resident-master-data.png`
- Stammdatenansicht, Mobil: `./qa-resident-master-data-mobile.png`
- Pflegeaktenansicht, Desktop: `./qa-resident-care-record.png`
- Pflegeaktenansicht, Mobil: `./qa-resident-care-record-mobile.png`
- Körperübersicht, Desktop: `./qa-resident-body-map-desktop.jpg`
- Körperübersicht, Mobil mit geöffnetem Befund: `./qa-resident-body-map-mobile.jpg`
- Körperübersicht im Referenzformat: `./qa-resident-body-map-reference-viewport.jpg`
- Direkter Körperkartenvergleich: `./qa-resident-body-map-comparison.jpg`
- Verlaufsansicht, Desktop: `./qa-resident-history-desktop.jpg`
- Verlaufsansicht, Mobil: `./qa-resident-history-mobile.jpg`
- Dokumentenansicht, Desktop: `./qa-resident-documents-desktop.jpg`
- Dokumentenansicht, Mobil mit aktiver Suche: `./qa-resident-documents-mobile.jpg`
- Wundübersicht, Desktop: `./qa-wound-overview-desktop.jpg`
- Wundübersicht, Mobil: `./qa-wound-overview-mobile.jpg`
- Bereichsweiter Bewohnerverlauf, Desktop: `./qa-resident-overall-history-desktop.jpg`
- Bereichsweiter Bewohnerverlauf, Mobil: `./qa-resident-overall-history-mobile.jpg`
- Wunddokumentation, Desktop: `./qa-wound-documentation-desktop.jpg`
- Wunddokumentation, Mobil: `./qa-wound-documentation-mobile.jpg`
- Hausweiter Bewohnerverlauf und Archiv, Desktop: `./qa-house-resident-history-desktop.jpg`
- Hausweiter Bewohnerverlauf und Archiv, Mobil: `./qa-house-resident-history-mobile.jpg`
- Hausweite Pflegeakten, Desktop: `./qa-care-records-page-desktop.jpg`
- Hausweite Pflegeakten, Mobil: `./qa-care-records-page-mobile.jpg`
- Hausweite Vitalwerte-Übersicht, Desktop: `./qa-vitals-overview-desktop.jpg`
- Mein Dienst, Desktop: `./qa-operations-shift-desktop.jpg`
- Einschätzungen, Desktop: `./qa-assessments-desktop.jpg`
- Medikamentenplan, Desktop: `./qa-medication-plan-desktop.jpg`
- Medikamentenplan, Mobil: `./qa-medication-plan-mobile.jpg`
- Medikamentenrunde, Desktop: `./qa-medication-round-desktop.jpg`
- Medikamentenbestände, Desktop: `./qa-medication-stocks-desktop.jpg`
- Reserven und Bestandsjournal, Desktop: `./qa-medication-reserves-desktop.jpg`
- Direkter Vergleich: `./qa-sidebar-blue-comparison-final.png`
- Viewport: 1536 × 1024 CSS-Pixel, Device Pixel Ratio 1
- Source und Implementierung: jeweils 1536 × 1024 Pixel; Vergleich ohne Dichteskalierung
- Zustand: Desktop, Operations geöffnet, Shift aktiv; zusätzlich eingeklappte Navigation
- Körperkartenvergleich: Quelle und Implementierung jeweils 658 × 1356 Pixel bei DPR 1; Bewohnerakte „Hans Müller“, Übersicht, Befund „Rötung“ geöffnet

## Full-view comparison evidence

Der direkte Vergleich bestätigt, dass Aufbau, Breite, dunkle Seitenleiste, Markenbereich, aktive Navigationsfläche, Menügruppen und unterer Servicebereich der Referenz folgen. Die neue CareOS-Fassung verwendet bewusst ein deutlich blaues Navy-Spektrum statt des neutralen Anthrazits der Referenz.

## Focused region comparison evidence

Die Sidebar wurde zusätzlich separat in beiden Zuständen geprüft. Der aktive Menüpunkt verwendet ein klares Informationsblau, der aktive Unterpunkt Hellblau und die eingeklappte Navigation bewahrt alle Module als erkennbare Icon-Buttons. Primäre, sekundäre und leise Aktionen nutzen abgestufte Blauzustände. Für die neue Körperübersicht wurden Quelle und Implementierung bei identischen 658 × 1356 Pixeln in einer gemeinsamen Vergleichsdatei geprüft: Ganzkörperfigur, farbige Marker und klare Stellenlokalisierung entsprechen dem Referenzprinzip; das aufklappbare CareOS-Detail ergänzt die fachlich benötigten Informationen und Verlinkungen.

## Required fidelity surfaces

- Fonts und Typografie: Hierarchie, Gewichte, Zeilenhöhen und Beschriftungen bleiben gegenüber der geprüften vorherigen Fassung unverändert und ohne Überlauf.
- Spacing und Layout: Sidebar-Breite, Abstände, Kartenraster und responsive Zustände bleiben stabil. Alle nicht-avatarbezogenen Rundungsdefinitionen verwenden einheitlich `6px`; Profil- und Bewohneravatare bleiben mit `50%` kreisrund.
- Farben und Tokens: `#2563eb` als Primary, `#1d4ed8` als Primary Dark, `#eaf1ff` als Primary Soft und `#0b1f3a` als Navigation. Grün bleibt ausschliesslich Success, Gelb Attention und Rot Critical entsprechend der PRD.
- Bild- und Iconqualität: Phosphor-Vektoricons bleiben scharf und konsistent. Die neue, wasserzeichenfreie Körperillustration ist eine eigenständige 1024 × 1536 Pixel große RGBA-Grafik mit transparentem Hintergrund und bleibt auf Desktop und Mobil klar lesbar.
- Copy und Inhalt: PRD-Module, Untermenüs und Dashboard-Inhalte wurden unverändert erhalten. Körperstellen werden fachlich aus Bewohnerperspektive als rechte Schulter, linker Unterarm und rechtes Knie bezeichnet.

## Findings

Keine verbleibenden P0-, P1- oder P2-Abweichungen. Die PRD nennt keine festen Hexwerte; die gewählte Blaupalette ist daher eine begründete Design-System-Auslegung der geforderten Informations- und Interaktionsfarbe. Die Körperübersicht übernimmt bewusst das Lokalisierungsprinzip der Referenz, nicht deren englische Beschriftungen oder wasserzeichenbehaftete Anatomiegrafik.

## Vergleichsverlauf

1. Vorherige Fassung: CareOS Primary und mehrere Interaktionszustände waren türkis; die Sidebar wirkte dunkelgrünlich. Das widersprach dem expliziten Wunsch nach Blau.
2. Korrektur: Globale Primary-Tokens, Sidebar-Verlauf, aktive Navigation, Untermenüs, Fokus, Avatare, Filter, Suchzustände, Toast und Button-Schatten wurden auf Blau umgestellt. Semantische Statusfarben wurden bewusst nicht vereinheitlicht.
3. Post-Fix-Evidenz: Ausgeklappte und eingeklappte Desktop-Screenshots bestätigen die konsistente Palette; Browser-Konsole ohne Fehler.
4. Radius-Normalisierung: Karten, Buttons, Dialoge, Badges, Statusmarken und Navigation wurden auf exakt `6px` vereinheitlicht. Profil- und Bewohneravatare wurden anschließend gezielt auf `50%` gesetzt. Der berechnete Browserstil enthält ausschließlich `6px` und die Avatar-Ausnahme `50%`.
5. Such-Popover: Die Desktopfläche wurde auf 860 × 620 Pixel vergrößert. Auf Mobilgeräten passt sie sich bis auf 466 × 620 Pixel an, ohne den Viewport zu verlassen.
6. Lokalisierung: Sämtliche Navigationsbereiche, Module und Untermenüs wurden in deutsche Fachbegriffe übertragen. Der sichtbare Navigationsbaum enthält keine vorherigen englischen Menübezeichnungen mehr.
7. Bewohnerseite: Der Menüpunkt „Bewohner“ verlinkt jetzt direkt auf `/bewohner`. Die neue responsive Übersicht enthält Kennzahlen, Verzeichnissuche, Wohnbereichsfilter, Statuskennzeichnung und eine Detail-Schublade mit Schnellaktionen.
8. Bewohnerakte: Der bisherige schmale Drawer wurde auf der Bewohnerseite durch eine eigenständige, vollflächige Dialog-Komponente ersetzt. Sie fährt von rechts ein, belegt `100vw × 100dvh` und hat einen Außenradius von exakt `0px`. Desktop- und Mobilansicht sowie Schließen per Button und Escape wurden geprüft.
9. Dokumentation: Tab, Schnellaktion und bestehende Dokumentationspunkte wechseln den Inhalt innerhalb derselben Bewohnerakte. Das responsive Formular unterstützt Neuaufnahme und Bearbeitung; ein automatischer Scroll-Reset hält den Ansichtsanfang sichtbar. Die Öffnungsanimation nutzt nur noch eine kurze GPU-beschleunigte Distanz von 42 Pixeln über 180 Millisekunden.
10. Kennzeichnung: Dokumentationseinträge können unabhängig als „Wichtig“, „Wichtig für Visite“, „Beobachtungsphase“ und „Übergaberelevant“ markiert werden. Bestehende Einträge erhalten kontextabhängige Vorbelegungen; Attention bleibt gelb und funktionale Auswahlzustände bleiben blau.
11. Stammdaten: Direkt nach „Übersicht“ steht ein eigener Stammdaten-Tab bereit. Die responsive Ansicht bündelt persönliche Angaben, Aufenthalt, medizinische Kontakte, Notfallkontakt und Versicherung und unterstützt einen klaren Bearbeitungs- und Speicherzustand innerhalb derselben Bewohnerakte.
12. Pflegeakte: Der Tab „Pflegeakte“ zeigt ein vollständiges Pflegeprofil mit sechs interaktiv auswählbaren Pflegebereichen, dynamischen Zielen und Maßnahmen, aktuellen Prioritäten, Assessments und beteiligten Fachpersonen. Der Wechsel bleibt innerhalb desselben vollflächigen Dialogs.
13. Direktzugriff: Die Schnellaktionen stehen nun als eigene, horizontale Leiste unmittelbar unter Bezugspflege, Vitalwerten, Medikation und Termin. Acht Aktionen decken Dokumentation, Vitalwerte, Medikation, Aufgaben, Pflegeplanung, Wunden, Trinkmenge und Einschätzungen ab; das Raster reagiert mit acht, vier oder zwei Spalten auf die verfügbare Breite.
14. Körperübersicht: Unter dem Direktzugriff wurde die Übersicht neu geordnet. Eine responsive Ganzkörperkarte zeigt Rötung, Wunde und Fraktur als interaktive Marker; jeder Marker öffnet exakt einen zugehörigen Detailbereich mit Beschreibung, Zeitpunkt, verantwortlicher Person und Verlinkungen. Ein anfänglicher Exportfehler der Bildoptimierung wurde durch den statisch kompatiblen Bildmodus behoben. Die klinische Seitenangabe wurde anschließend auf die Bewohnerperspektive korrigiert und im erneuten Browservergleich bestätigt.
15. Verlauf und Dokumente: Beide bisher nur beschrifteten Tabs besitzen jetzt eigenständige, responsive Ansichten innerhalb derselben Bewohnerakte. Der Verlauf bietet Kennzahlen, fünf funktionale Fachfilter, Tagesgruppen, Detailaktionen und Fokusinformationen. Die Dokumentenablage bietet Kennzahlen, Volltextsuche mit deutscher Wortstamm-Toleranz, fünf Kategorien, Statusangaben, Leerzustand sowie Ansehen- und Downloadaktionen.
16. Wundübersicht: Der Untermenüpunkt „Wundübersicht“ öffnet jetzt die eigenständige statische Route `/wundmanagement`. Die responsive Seite bündelt Wundkennzahlen, kritische Hinweise, Suche, vier Statusfilter, Heilungsfortschritt, dynamische Fallauswahl und anstehende Versorgungen. Auf Mobil bleibt „Neue Wunde erfassen“ erreichbar und die Kennzahlen werden platzsparend als 2×2-Raster dargestellt.
17. Bereichsverlauf und Wunddokumentation: „Bewohner → Verlauf“ öffnet jetzt `/bewohner/verlauf` mit chronologischen Einträgen, Fachfiltern, Suche, Detailauswahl und offenen Beobachtungen. „Wundmanagement → Dokumentation“ öffnet `/wundmanagement/dokumentation` mit Statusfiltern, Volltextsuche, dynamischer Befund- und Massnahmenansicht sowie Tagesaufgaben. Beide Seiten sind als eigenständige statische Next.js-Routen umgesetzt und zeigen den aktiven Untermenüpunkt korrekt an.
18. Hausweiter Bewohnerverlauf: Die Verlaufsroute wurde zu „Bewohnerverlauf & Archiv“ erweitert. Die Demo zeigt 16 Bewohnerakten aus vier Wohnbereichen mit den Stati Aktiv, Verlegt, Ausgetreten und Verstorben. Volltextsuche, Wohnbereichsauswahl und Statusfilter sind kombinierbar; historische Akten erhalten angepasste Archivaktionen und einen Datenschutzhinweis.
19. Pflegeakten-Arbeitsplatz: „Bewohner → Pflegeakte“ öffnet die eigenständige Route `/bewohner/pflegeakte`. Die responsive Ansicht bietet eine filterbare Bewohnerauswahl, dynamische Aktenkennzahlen, sechs auswählbare Pflegebereiche sowie zugehörige Ziele, Maßnahmen, Risiken, Evaluationen und Fachpersonen. Der Standortkontext ist auf das gesamte Haus gesetzt.
20. Vitalwerte-Übersicht: „Vitalwerte → Übersicht“ ersetzt den bisherigen Untermenüpunkt „Messwerte“ und öffnet die eigenständige Route `/vitalwerte`. Die hausweite Arbeitsfläche zeigt sechs Messwertarten pro Bewohner, Status und Messzeitpunkt sowie eine dynamische Detailansicht mit klinischer Einordnung, 24-Stunden-Verlauf und fälligen Kontrollen. Volltextsuche, Wohnbereichsauswahl und Statusfilter lassen sich kombinieren.
21. Medikationsarbeitsplatz: Der Bereich „Medikation“ verlinkt vier eigenständige statische Routen für Medikamentenplan, Medikamentenrunde, Bestände und den neuen Unterpunkt „Reserven“. Verordnungen lassen sich bewohnerbezogen prüfen, Gaben als gegeben, verweigert oder prüfpflichtig dokumentieren und kritische Lagerbestände nachbestellen. Reserven zeigen ausschließlich ärztlich verordnete Bedarfsmedikation einschließlich Einzeldosis, Maximaldosis, Mindestintervall und Gültigkeit; Ein- und Austräge ändern den Bestand und erzeugen einen Journalposten.
22. Betrieb und Einschätzungen: Alle zehn zuvor nicht freigeschalteten Unterseiten besitzen eigenständige statische Routen und folgen dem bestehenden Arbeitsflächenmuster. „Mein Dienst“ bietet Schichttimeline und Fortschritt, „Schichtverlauf“ vergangene Dienste, Aufgaben- und Übergabeseiten bieten Statusfilter und direkte Aktionen, Dienstplanung zeigt Wochen- bzw. Teambesetzung und Einschätzungen bündeln Assessmentstatus und Fälligkeiten mit Suche und Bearbeitungsaktionen.
23. Sidebar-Gruppenzustand: Der gemeinsame Seitenshell leitet die geöffnete Hauptgruppe jetzt aus dem aktiven Modul ab. Dadurch bleibt auf jeder Unterseite automatisch der passende Bereich (z. B. „Betrieb“ bei Schicht, Aufgaben und Übergaben) geöffnet, während andere Bereiche geschlossen starten.
24. Personal und Leitung: Alle Unterseiten der Sidebar-Bereiche „Personal“ und „Leitung“ sind als eigenständige statische Arbeitsflächen umgesetzt. Team, Schulungen und Dokumente decken Kommunikation, Nachweise und Standards ab; Qualität, Kennzahlen & Analysen und Administration bieten Ereignisse, Auswertungen, Benutzer- und Organisationseinstellungen.
25. Bereichsspezifische Arbeitsflächen: „Betrieb“ nutzt jetzt einen operativen Puls mit Live-Status, Schichtkennzahlen und Tagesaktionen. „Leitung“ verwendet ein eigenständiges Management-Cockpit mit KPI-Kacheln, Entwicklungschart, Führungskreis, Arbeitsliste und Entscheidungsdetail statt des Personal-Layouts.
26. Intelligenz und Einstellungen: „CareOS KI“ bietet Assistenz und KI-Entwürfe mit Prüf- und Datenschutzkontext. „Einstellungen“ ist über die Sidebar erreichbar und enthält Übersicht, Profil, Benachrichtigungen, Sicherheit und Darstellung als separate Routen.
27. Einstellungslesbarkeit: Die zunächst zu kompakte Typografie der Einstellungsseite wurde gezielt angehoben. Navigation nutzt 14px, Bereichstitel 15px, Beschreibungen 12–15px und die Detailansicht 15px bei unverändertem Layout.
28. Darstellungsauswahl: Auf den Einstellungsseiten werden die Arbeitsbereich-Optionen jetzt je Seite als horizontale Karten nebeneinander angeordnet (Übersicht 4, Profil 2, Benachrichtigungen/Sicherheit/Darstellung 3); auf schmalen Viewports bleiben sie in einer horizontal scrollbaren Reihe erreichbar.
29. Einstellungsdetails: Der Bereich „Ausgewählt“ zeigt nun kontextbezogene Inhalte für alle fünf Seiten. Profil, Benachrichtigungen, Sicherheit und Darstellung verwenden jeweils passende Schalter, Auswahlfelder oder Aktionen statt des generischen Aktiv-Schalters.
30. Custom Selects: Alle Auswahlfelder im Bereich „Ausgewählt“ verwenden jetzt ein eigenes CareOS-Dropdown mit blauer Oberfläche, sichtbarer Auswahl, Fokuszustand und Klick-aussen-Schliessen statt der Browser-/Betriebssystem-UI.
31. Dropdown-Platzierung: Das Darstellungsprofil öffnet sein Dropdown bei wenig Platz automatisch nach oben. So bleibt das vollständige Menü sichtbar und wird weder von der Detailkarte noch vom Viewport abgeschnitten.
32. Passwortdialog: „Passwort ändern“ öffnet in der Sicherheitsansicht ein eigenes, responsives CareOS-Popover. Aktuelles Passwort, neues Passwort und Bestätigung werden validiert; Sichtbarkeitsschalter, Escape, Abbrechen und Speichern sind vollständig innerhalb des Dialogs umgesetzt.
33. Benachrichtigungsübersicht: Der Bereich „Benachrichtigungen“ in der Einstellungsübersicht zeigt jetzt alle sieben aktiven Hinweisarten mit Auslöser und Frequenz sowie einen direkten Link zur vollständigen Verwaltung.
34. Profilmenü: Der Kopfbereich öffnet über Avatar und Namen ein CareOS-Dropdown mit Dienstplan, Nachrichten, Einstellungen und Ausloggen. Die Navigation schliesst bei Auswahl, Klick ausserhalb oder Escape.
35. Profilmenü-Bedienbarkeit: Das Menü ist auch in der kompakten mobilen Kopfzeile über den runden Avatar erreichbar; die vier Ziele bleiben dort identisch und funktionieren per Tastatur und Klick.
36. Benachrichtigungsmenü: Die Glocke im globalen Kopfbereich öffnet ein eigenes Dropdown mit vier aktuellen Hinweisen, Prioritätsfarben, Zeitstempeln, ungelesenen Markierungen und einem Link zur vollständigen Benachrichtigungsseite.
37. Benachrichtigungsstatus: Im Dropdown lässt sich der Zähler über „Alle gelesen“ zurücksetzen; der Glockenpunkt und die ungelesenen Markierungen verschwinden konsistent.
38. Eigener Benachrichtigungs-Posteingang: Der Dropdown-Link „Alle Benachrichtigungen“ öffnet `/benachrichtigungen` mit sieben Hinweisen, Kennzahlen, Filtern für Alle/Ungelesen/Kritisch, Einzelaktionen und globalem „Alle gelesen“.
39. Startseiten-Scroll: „Als Nächstes“ sitzt in einem eigenen oberen Dashboard-Grid. Der Sticky-Bereich bleibt auf Desktop auf seine Grid-Zeile begrenzt und endet vor „Meine Bewohner“; auf Mobil ist er vollständig statisch und zeigt alle Aufgaben ohne Überlagerung.
40. Aufgabenkarte „Als Nächstes“: eigene Dashboard-Klassen verhindern Konflikte mit den Aufgabenlisten anderer Module; Aufgabe, Bewohnerhinweis und Uhrzeit bleiben in einer klaren, responsiven Zeile ohne Überlappungen.

## Primäre Interaktionen

- Sidebar ein- und ausgeklappt
- PRD-Module im eingeklappten Zustand geprüft
- Primärer CTA, sekundärer Button und Navigation visuell geprüft
- Such-Popover geöffnet, gefiltert und geschlossen; Desktop- und Mobilgröße geprüft
- Alle fünf deutschen Navigationsbereiche geöffnet und alle 19 Modulbezeichnungen geprüft
- Navigation von der Startseite zur Bewohnerseite, Suche, Wohnbereichsfilter und Bewohnerdetail geprüft
- Bewohnerseite bei 1536 × 1024 und 506 × 890 CSS-Pixel geprüft
- Vollflächige Bewohnerakte und Schnellaktionen bei 1536 × 1024 und 506 × 890 CSS-Pixel geprüft
- Interner Wechsel zur Dokumentationsansicht, Bearbeitung, Speichern und Rückkehr zur Übersicht geprüft; dabei bleibt exakt ein Dialog geöffnet
- Mehrfachauswahl, Vorbelegung und Speichern der vier Dokumentationskennzeichnungen auf Desktop und Mobil geprüft
- Tab-Reihenfolge, vollständige Stammdatenbereiche, Bearbeitungsmodus und Speichern auf Desktop und Mobil geprüft
- Pflegeakten-Tab, sechs Pflegebereiche, dynamischer Detailwechsel und Aktionen auf Desktop und Mobil geprüft
- Horizontaler Direktzugriff mit acht Aktionen auf Desktop und Mobil geprüft; Dokumentation und Pflegeplanung wechseln innerhalb derselben Bewohnerakte
- Körpermarker, drei Befund-Dropdowns und Verlinkungen zu Dokumentation, Pflegeakte und Wundmanagement auf Desktop und Mobil geprüft
- Direkter Körperkartenvergleich bei 658 × 1356 Pixeln geprüft; keine P0-, P1- oder P2-Abweichungen
- Verlaufsfilter, chronologische Tagesgruppen und interne Verlinkung zur Dokumentation auf Desktop und Mobil geprüft
- Dokumentensuche, Kategorien, Leerzustand, Ansehen und Download auf Desktop und Mobil geprüft
- Navigation zur Wundübersicht, Statusfilter, Suche, Fallauswahl, Wundakte und Verlaufserfassung auf Desktop und Mobil geprüft
- Sidebar-Navigation von der Wundübersicht zur Wunddokumentation und von der Bewohnerübersicht zum bereichsweiten Verlauf geprüft
- Wunddokumentationsfilter „Entwurf“, dynamische Fallauswahl und Detailansicht auf Desktop geprüft
- Bereichsweiter Bewohnerverlauf und Wunddokumentation bei 1440 × 1000 sowie 390 × 844 CSS-Pixel geprüft
- Kombinierte Filterung nach „Verstorben“ und „Wohnbereich 3“, Archivdetail für Johanna Suter sowie Volltextsuche nach „Spitex“ geprüft
- Hausweiter Bewohnerverlauf bei Desktopbreite und 390 × 844 CSS-Pixel geprüft; Browserkonsole ohne Fehler
- Sidebar-Navigation zur Pflegeakte, Statusfilter „Entwurf“, Bewohnerwechsel zu Walter Brunner und Pflegebereichswechsel zu „Haut & Wunden“ geprüft
- Pflegeakten-Arbeitsplatz auf Desktop und bei 390 × 844 CSS-Pixel geprüft; Browserkonsole ohne Fehler
- Sidebar-Navigation zu „Vitalwerte → Übersicht“, Statusfilter „Auffällig“, Volltextsuche nach „Walter“, Wohnbereichsfilter „Wohnbereich 1“, Bewohnerauswahl und Messwertwechsel zu „Sauerstoff“ geprüft
- Vitalwerte-Übersicht im Desktopbrowser geprüft; acht Bewohnerzeilen und alle sechs Messwertarten bleiben vollständig sichtbar, Browserprotokoll ohne Fehler
- Sidebar-Navigation zwischen allen vier Medikationsseiten und aktive Untermenümarkierung geprüft
- Medikamentenrunde: Gabe für Hans Müller dokumentiert und Fortschritt von 33 auf 50 Prozent aktualisiert
- Bestände: Filter „Kritisch“ zeigt zwei Artikel; Nachbestellung wechselt sichtbar auf „Bestellt“
- Reserven: Paracetamol-Austrag reduziert den Bestand von 18 auf 17, erzeugt einen Journalposten und lässt sich über einen Eingang wieder ausgleichen
- Medikamentenplan, Runde, Bestände und Reserven im Desktopbrowser sowie der Medikamentenplan in der mobilen Ansicht geprüft; Browserprotokoll ohne Fehler
- Betrieb und Einschätzungen: Sidebar-Verlinkung zu „Schicht“ und „Fälligkeiten“, Aufgabenfilter mit Statuswechsel, Übergabenotiz speichern sowie Fälligkeitenfilter „Überfällig“ geprüft
- Mein Dienst und Einschätzungen im Desktopbrowser geprüft; Browserprotokoll ohne Fehler
- Wechsel zwischen mehreren Unterseiten in „Betrieb“ und „Pflege & Klinik“ geprüft; die jeweils aktive Hauptgruppe bleibt geöffnet und wird nicht durch eine andere Gruppe ersetzt
- Sidebar-Navigation zu allen Personal- und Leitungsmodulen sowie aktive Untermenümarkierung auf Team und Benutzer & Rollen geprüft
- Unterschiedliche Layouts von „Betrieb“ und „Leitung“ sowie operative Kennzahlen- und Management-Cockpit-Interaktionen geprüft
- Intelligenz-Assistenz, KI-Entwürfe und Einstellungen inklusive Unterseiten-Navigation geprüft
- Lesbarkeit der Einstellungsseite per Browserstil geprüft (Navigation 14px, Bereichstitel 15px, Detailtext 15px)
- Arbeitsbereich: horizontale Raster für Übersicht, Profil, Benachrichtigungen, Sicherheit und Darstellung im Browser geprüft
- Einstellungsdetails: Profil-, Benachrichtigungs-, Sicherheits- und Darstellungsoptionen mit passenden Detailsteuerungen geprüft
- Eigene Select-UI auf Darstellung und Profil geöffnet, Option ausgewählt und wieder geschlossen; keine nativen Selectfelder verbleiben
- Darstellungsprofil am unteren Kartenrand geöffnet; Menü öffnet nach oben und bleibt vollständig innerhalb des Viewports sichtbar
- Sicherheitsansicht: „Passwort ändern“ geöffnet, leeres Formular validiert, Passwortsichtbarkeit umgeschaltet und Dialog über „Abbrechen“ geschlossen
- Einstellungsübersicht: „Benachrichtigungen“ ausgewählt; sieben aktive Hinweisarten, Auslöser, Status und Link zur Verwaltung geprüft
- Profilmenü im Kopfbereich geöffnet; vier Menüeinträge und Schliessen per Klick ausserhalb/Escape geprüft
- Profilmenü in der kompakten Kopfzeile geöffnet und „Dienstplan“ erfolgreich zu `/betrieb/dienstplanung` navigiert
- Benachrichtigungsmenü in der kompakten Kopfzeile geöffnet; vier Hinweise, ungelesene Markierungen und Link „Alle Benachrichtigungen“ mit Navigation zu `/einstellungen/notifications` geprüft
- Benachrichtigungszähler „3 neu“ und Aktion „Alle gelesen“ geprüft
- Dropdown-Link „Alle Benachrichtigungen“ öffnet den eigenständigen Posteingang; Kennzahlen, Filter und sieben Einträge auf Desktop/Mobil geprüft
- Startseite: vollständige Aufgabenliste in „Als Nächstes“, separate Position vor „Meine Bewohner“ und statisches Mobilverhalten geprüft
- Dienstplanung: „Woche/Monat“-Umschalter, vollständiges September-Kalenderraster, Tagesauswahl im Monatskalender und Rücksprung auf „Heute“ geprüft
- Personal und Leitung: individuelle Team-, Lern-, Dokument-, Qualitäts-, Kennzahlen-, Organisations-, Benutzer- und Konfigurationslayouts auf Desktop/Mobilstruktur geprüft
- Administration Organisation: „Wohnbereich“ öffnet den vollflächigen Editor mit Stammdaten, Kapazität, Leitung, Diensten und Hinweisfeld; Abbrechen/Erstellen geprüft
- Geplante Dienste: Checkboxen im Bereichseditor überschreiben nicht mehr die Formularbreite; Frühdienst, Spätdienst und Nachtwache bleiben als drei klar lesbare Auswahlkarten sichtbar
- Etage-Auswahl: Der Bereichseditor verwendet ein eigenes CareOS-Dropdown mit Fokuszustand, Auswahlmarkierung, Klick-aussen-Schliessen und Aufwärtsöffnung bei wenig Platz statt der nativen Browserauswahl
- Verantwortliche Leitung: Die Personenauswahl nutzt dieselbe eigene CareOS-Dropdown-UI mit vier Leitungsprofilen statt eines nativen Browser-Selects
- Standortverwaltung: „Bereich hinzufügen“ öffnet einen vollflächigen Standorteditor mit Stammdaten, Standorttyp, Land, Leitung und Status; sämtliche Auswahlfelder verwenden die eigene CareOS-Dropdown-UI
- Startseite-Profil: „Mein Profil“ steht im Profilmenü an erster Stelle und öffnet einen vollflächigen Profilbereich; „Bearbeiten“ schaltet die persönlichen Angaben direkt im selben Bereich in editierbare Felder um
- Einheitlicher Kopfbereich: Startseite und alle Modul-Seiten verwenden dieselbe AppHeader-Komponente mit Standort, Suche, Benachrichtigungen und Profilmenü inklusive „Mein Profil"
- Dienstplanung: „Abwesenheit melden“ öffnet einen vollflächigen Editor mit Zeitraum, Abwesenheitsart, Stellvertretung und Priorität; Auswahlfelder nutzen die eigene CareOS-Dropdown-UI
- Abwesenheitskalender: „Von“ und „Bis“ verwenden einen eigenen CareOS-Monatskalender mit Monatsnavigation, Wochentagen, Auswahlzustand und „Heute“-Aktion statt des nativen Datepickers
- Operations-Aktionen: „Aufgabe erstellen“ und „Dienst starten“ öffnen vollflächige CareOS-Editoren mit Aufgabenfeldern, Schicht-Check-in, Statuszusammenfassung und eigener Auswahl-UI
- Bewohnerverwaltung: „Bewohner aufnehmen“ und „Pflegeakte erstellen“ öffnen vollflächige Aufnahmeeditoren mit Stammdaten, Zuweisung, Pflegefokus, Evaluation und eigener Auswahl-UI
- CareOS RAI: Neuer Sidebar-Bereich mit Übersicht, interRAI-Erfassung, Fälligkeiten und Berichten; Verantwortliche, Bewohnerzuweisung, Bewertungsbereiche, Freigaben und responsive Arbeitskörbe geprüft
- Sidebar-Deep-Links: Untermenüpunkte ohne eigenes Ziel routen über eine zentrale Zuordnung (z. B. Administration → Organisation); Vercel- und Lokalrouting geprüft
- Sidebar-Routing auf Einstiegseiten: Startseite, Bewohner und Wundmanagement verwenden nun dieselbe vollständige Routenzuordnung wie die Modulansicht; Administration, Qualität, Kennzahlen, Personal und Intelligenz öffnen statt Toast direkt ihre Seiten
- Browser-Konsole auf Fehler geprüft
- Lint und Produktions-Build erfolgreich

## Follow-up polish

Kein blockierender Nachlauf. Optional kann später ein zweites, etwas entsättigteres Blau als Enterprise-Branding-Variante angeboten werden.

## Ergebnis

passed

## RAI-Arbeitskorb – Nachprüfung 16.09.2026

- Source of visual truth: `/Users/alexander/Desktop/Bildschirmfoto 2026-09-16 um 21.47.52.png`
- Implementation: `http://localhost:3000/rai` (Desktop, ARBEITSKORB sichtbar)
- Fix: Bewohnerzeilen verwenden feste Grid-Spalten für Fortschrittsbalken (102px) und Status-Badges (122px). Dadurch bleiben alle Prozessanzeigen und Statusmarken unabhängig von Namen oder Statuslänge exakt untereinander ausgerichtet.
- Responsive Verhalten: Unterhalb des bestehenden 1080px-Breakpoints bleibt die kompakte Darstellung unverändert; die Fortschrittsanzeige wird weiterhin ausgeblendet.
- Nachprüfung: Lokaler Browserabgleich zeigt identische Start- und Endkanten der Fortschrittsleisten sowie eine konsistente Statusspalte; `npm run lint` und `npm run build -- --webpack` erfolgreich.

Ergebnis: passed

## Sidebar-Tooltip – Nachprüfung 17.09.2026

- Source of visual truth: `/Users/alexander/Desktop/Bildschirmfoto 2026-09-17 um 08.41.02.png`
- Der Tooltip wird als eigene `SidebarTooltip`-Komponente per Portal in `document.body` gerendert. Dadurch wird er nicht mehr vom scrollenden Sidebar-Container oder dessen Overflow abgeschnitten.
- Position und Sichtbarkeit werden bei Hover, Fokus, Scrollen und Resize aktualisiert; die gestaltete CareOS-Fläche bleibt vollständig rechts neben dem jeweiligen Icon sichtbar.
- `npm run lint` und `npm run build -- --webpack` erfolgreich.

Ergebnis: passed

## Sidebar-Rail – Nachprüfung 17.09.2026

- Source of visual truth: `/Users/alexander/Desktop/Bildschirmfoto 2026-09-17 um 08.48.39.png`
- Implementation: `http://localhost:3000/` und `http://localhost:3000/betrieb/dienstplanung` (Desktop, 1440 × 900 CSS-Pixel)
- Die permanente Navigation entspricht auf Startseite und Modul-Seiten derselben blauen Icon-Rail mit ausschließlich den sechs Hauptkategorien (Pflege & Klinik, Betrieb, Personal, Leitung, Intelligenz und CareOS RAI); Unterseiten sind nicht dauerhaft in der geschlossenen Rail sichtbar.
- Jeder Hauptpunkt besitzt die eigene `SidebarTooltip`-Komponente mit gestalteter CareOS-Fläche bei Hover/Fokus. Ein Klick öffnet rechts neben der Rail das passende Untermenü.
- Das Untermenü schließt beim Verlassen per Maus oder Escape. Aktive Unterseiten bleiben markiert.
- Beim Öffnen verschiebt sich der Inhaltsbereich mit einer kurzen, GPU-freundlichen 180-ms-Animation nach rechts; beim Schließen fährt er sauber zurück.
- Mobile Breakpoints behalten die bestehende Bottom-Navigation bei und blenden die Desktop-Rail aus.
- `npm run lint` und `npm run build -- --webpack` erfolgreich; keine neuen Browserfehler im geprüften Flow.

Ergebnis: passed
