# Notenspieler

App, die ein Notenblatt aus einem Foto, einem Bild, einem PDF oder (nur Android) einem Video mit
durchlaufenden Noten erkennt, das Stück vorspielt und während des Abspielens anzeigt, wo man
sich gerade befindet. Es gibt sie als **Android-App** und als **Web-App** (z. B. für das iPad);
beide verwenden dieselbe Notenerkennung.

## Web-App (iPad, Browser)

**Adresse: https://carstenkeller.github.io/note-player/**

Am iPad in Safari öffnen und über „Teilen“ → „Zum Home-Bildschirm“ hinzufügen. Dann startet
sie wie eine App, funktioniert auch offline, und Safari löscht die gespeicherten Stücke nicht
(bei einer normalen Website kann Safari die Daten nach einigen Wochen ohne Besuch löschen).

- **Notenblatt fotografieren**, **Bilder** oder **PDFs** öffnen. Jede PDF-Seite wird ein Blatt;
  mehrere Dateien werden in der gewählten Reihenfolge zu einem Stück.
- Die Erkennung läuft **im Browser auf dem Gerät** (kein Server, nichts wird hochgeladen).
  Ein großes Foto braucht einige Sekunden; das Ergebnis wird gespeichert, beim nächsten Öffnen
  ist das Stück sofort da. Nach einer verbesserten Erkennung (neue Version) werden die Blätter
  beim Öffnen einmal neu erkannt.
- **Bibliothek**: Alle Stücke werden lokal im Browser gespeichert (IndexedDB). Jedes Stück
  hat einen Namen, optional einen **Interpreten** und kann in beliebig viele **Rubriken**
  einsortiert werden (z. B. „Pop“, „Klassik“, „Übung“). Suche nach Name, Interpret und Rubrik,
  Filter nach Rubrik und Interpret, Sortierung nach Name, Interpret oder zuletzt geöffnet.
  Bearbeiten über „⋯“ in der Liste oder durch Tippen auf den Namen im Stück.
- **Sicherung**: „Sicherung speichern“ legt alle Stücke (Originalbilder, Namen, Rubriken,
  Tempo) in einer ZIP-Datei ab, „Sicherung laden“ übernimmt sie wieder – auch auf einem
  anderen Gerät. Stücke, die schon da sind, bleiben unverändert.
- **Abspielen** wie in der Android-App: Klang (Flügel, E-Piano, Orgel, Harfe), Tempo in Prozent,
  Grundtempo je Stück, Gesangsstimme zuschaltbar, klingende Noten werden markiert, die Ansicht
  folgt der Musik. Der Klang wird gleich nach der Erkennung im Hintergrund vorbereitet, damit
  beim Start nichts Rechenintensives mehr läuft; gestartet werden kann erst, wenn alle Blätter
  erkannt sind.
- **Startstelle**: Eine Note antippen – sie wird blau markiert, unten steht „ab Takt n ✕“,
  und ▶ spielt ab dort. „✕“ setzt wieder auf den Anfang. Während des Abspielens springt
  Antippen sofort an die Stelle.
- **Erkannte Noten umrahmen** (unter „⚙“, standardmäßig an): zeigt, was gelesen wurde – auch
  in der Gesangsstimme, wenn sie nicht mitgespielt wird.
- **Seitenränder ausblenden** (unter „⚙“, standardmäßig an): Kopf- und Fußzeilen, Seitenzahlen
  und leere Ränder zwischen den Seiten werden weggelassen (nur der Bereich der Notenzeilen mit
  etwas Platz darüber und darunter); die erste Seite behält ihren Titel. So laufen die Seiten
  beim Scrollen ohne Unterbrechung ineinander.
- **Scrollmodus** zum eigenen Spielen: Die Noten laufen gleichmäßig nach oben, ohne Ton. Die
  Geschwindigkeit wird als Tempo (♩ = …) eingestellt: Bei dem eingestellten Tempo ist das
  Stück zu Ende gescrollt, wenn es zu Ende gespielt wäre (berechnet aus den erkannten Noten).
  Antippen der Noten hält an bzw. setzt fort; mit dem Finger lässt sich jederzeit
  nachschieben, das Scrollen macht dort weiter. Der Bildschirm bleibt dabei an (sofern der
  Browser es erlaubt).
- **Blätter** eines Stücks: weitere anhängen, Reihenfolge ändern, ersetzen, entfernen,
  Original speichern.
- **Zoom** mit zwei Fingern oder unter „⚙“ → „Ansicht“.

Noch nicht in der Web-App (nur Android): Videos mit scrollenden Noten, Umrahmen aller
erkannten Noten, Cursor in der Zeile.

## Funktionen

- **Notenblatt fotografieren** (Kamera-App des Geräts) oder **Bilder auswählen** (Galerie / Dateien).
  Bilder können auch über „Teilen“ aus einer anderen App an den Notenspieler geschickt werden.
- **Mehrere Blätter**: ein Foto pro Blatt. Dafür mehrere Bilder in der Reihenfolge des Stücks
  auswählen (oder mehrere auf einmal teilen), oder nach dem ersten Blatt über „Blätter“ weitere
  Blätter fotografieren oder auswählen. Jedes Blatt wird für sich erkannt (eigene Größe und
  Schräglage). Danach werden die Blätter untereinander angezeigt und nacheinander gespielt.
  Ein Haltebogen über das Blattende hinaus wird nicht erkannt.
- **Video mit scrollenden Noten**: Aus einem Video, in dem die Noten nach oben oder zur Seite
  über den Bildschirm laufen (z. B. eine Bildschirmaufnahme), wird ein Notenblatt
  zusammengesetzt:
  - Nur der Bereich, der sich bewegt, zählt als Noten. Feste Bedienelemente und eine Titelzeile,
    die beim Scrollen stehen bleibt, werden weggelassen.
  - Jedes Bild wird im bisher zusammengesetzten Blatt gesucht und dort eingefügt. Passt es
    nirgends (Seitenwechsel), wird es unten angehängt.
  - Farbige Markierungen (Cursor, hervorgehobene Noten) werden herausgerechnet, wenn dieselbe
    Stelle in anderen Bildern ohne Markierung zu sehen ist.
  - Grenzen: Markierungen, die in jedem Bild über den Noten liegen (z. B. die Rahmen von
    „Erkannte Noten umrahmen“ in einer Aufnahme dieser App), verdecken die Noten dauerhaft.
    Zoomen während der Aufnahme wird nicht unterstützt. Die Noten müssen groß genug sein
    (Linienabstand mindestens etwa 8 Pixel). Gedacht ist das für Bildschirmaufnahmen; ein mit
    der Kamera abgefilmter Bildschirm (bewegtes, schräges, unscharfes Bild) wird nicht
    unterstützt.
- **Gespeicherte Stücke**: Jedes geöffnete Stück wird automatisch gespeichert (Kopien der Bilder
  bzw. Videos in der App, dazu das Grundtempo) und steht auf dem Startbildschirm zum erneuten
  Abspielen bereit; umbenennen und löschen über „⋮“. Beim Öffnen werden die Noten neu erkannt.
- **Blätter verwalten** (Menü „Blätter“ im Notenbildschirm): weitere Blätter fotografieren oder
  auswählen, ein schlecht erkanntes Blatt neu fotografieren oder durch ein anderes Bild ersetzen,
  ein Blatt entfernen, ein Blatt in der Galerie speichern (Album „Notenspieler“, ab Android 10)
  oder teilen (das gespeicherte Foto an eine andere App geben), das Stück umbenennen.
- **Kompakte Bedienleiste**: Abspielen, Stopp und Tempo in einer Zeile; die übrigen Einstellungen
  (Tempo-Regler, Grundtempo, Klang, Anzeige) klappen mit „⚙“ auf und wieder zu.
- **Notenerkennung direkt auf dem Gerät**: offline, kein Server, kein Konto.
- **Wiedergabe** mit wählbarem Klang: Flügel (Aufnahmen eines echten Klaviers, Standard),
  E-Piano, Orgel, Harfe. Das Stück wird vor dem Abspielen einmal in eine Audiodatei
  umgerechnet (kurz „Klang lädt …“).
  Das Tempo wird in Prozent eingestellt (25–200 %). Tempoangaben auf dem Blatt werden nicht
  gelesen; 100 % entsprechen 120 Vierteln pro Minute, dem üblichen Standard von Notensatzprogrammen.
- **Gesangsstimme**: Eine Notenzeile mit Liedtext darunter, zu der es eine Begleitung gibt
  (z. B. Klavier), gilt als Gesangsstimme. Sie wird standardmäßig weder abgespielt noch markiert
  und lässt sich mit „Gesangsstimme (mit Liedtext) abspielen“ dazuschalten.
- **Zoomen**: mit zwei Fingern auseinander- bzw. zusammenziehen, mit einem Finger verschieben,
  Doppeltippen zoomt hinein bzw. wieder ganz heraus.
- **Positionsanzeige** beim Abspielen:
  - Die gerade klingenden Noten werden orange hervorgehoben.
  - Ein senkrechter Cursor läuft durch die aktuelle Notenzeile.
  - Die Ansicht folgt automatisch der aktuellen Stelle, auch gezoomt. Nach dem Verschieben
    von Hand pausiert das Mitlaufen für ein paar Sekunden.
  - Oben steht „Zeile x von y · Takt n“.
- **Startpunkt wählen**: Wer auf eine Note tippt, setzt dort den Startpunkt. Läuft die
  Wiedergabe gerade, springt sie dorthin.
- Optional werden alle erkannten Noten umrahmt. So sieht man sofort, was die App gelesen hat
  und was nicht.

## Was die Erkennung kann – und was nicht

Die Notenerkennung (Optical Music Recognition) ist ein eigener, regelbasierter Ansatz
(`omr-core`). Sie ist für **gedruckte, eher einfache Noten** gedacht.

Erkannt werden:

- Notenlinien, auch leicht schief oder gewölbt fotografiert; Schräglage wird ausgeglichen
- Violin-, Bass- und Altschlüssel
- Tonart-Vorzeichen (♯/♭) sowie Vorzeichen vor einzelnen Noten (♯, ♭, ♮), gültig bis zum Taktstrich
- Ganze, Halbe, Viertel, Achtel, Sechzehntel (Fähnchen und Balken) und Punktierungen
- Akkorde
- Haltebögen zwischen zwei gleich hohen Noten (auch über Taktstrich und Zeilenumbruch): Die
  zweite Note wird nicht neu angeschlagen, sondern der Ton klingt weiter. Wird bei einem Akkord
  ein Bogen erkannt, gelten alle gemeinsamen Töne der beiden Akkorde als gebunden.
- Ganze, halbe, Viertel- und Achtelpausen
- Triolen mit Klammer und „3“ (auch schräge oder in blassen Fotos unterbrochene Klammern)
- Taktstriche
- Systeme aus mehreren Notenzeilen (z. B. Gesang + Klavier), die links durch eine Linie
  verbunden sind: Noten, die übereinander stehen, erklingen gleichzeitig. Leichte perspektivische
  Verschiebungen zwischen den Zeilen werden über die Taktstriche ausgeglichen.
- Noten ober- und unterhalb der Notenlinien nur mit Hilfslinien. Dadurch werden Buchstaben im
  Liedtext oder Punkte in Akkorddiagrammen nicht als Noten gelesen.

**Nicht** unterstützt werden u. a.:

- Handschrift
- Taktart (wird überlesen; eine Ganztaktpause zählt als 4 Viertel, wenn sonst nichts im Takt steht)
- Triolen ohne Klammer (nur die „3“ über einem Balken) und andere N-tolen
- Bindebögen (Legato) werden ignoriert; zwischen zwei gleich hohen Noten sind sie von
  Haltebögen nicht zu unterscheiden und werden dort wie Haltebögen behandelt
- Wiederholungen, Volta-Klammern, D.C./D.S.
- Mehrere Stimmen in einer Notenzeile nur teilweise: Stimmen mit Hals nach oben und nach unten
  sowie ganze Noten unter einer Melodie klingen jeweils in ihrer eigenen Länge; übereinander
  stehende hohle Köpfe werden dabei manchmal einen Ton daneben gelesen
- Schlüssel- oder Tonartwechsel mitten in der Zeile
- Vorschlagsnoten, Verzierungen, Dynamik

### Wie gut funktioniert das?

Geprüft habe ich das nur mit Notensatz, der mit [Verovio](https://www.verovio.org) (Schriftart
Bravura) gerendert wurde, teils zusätzlich „wie ein Handyfoto“ verzerrt: Perspektive,
Drehung, Unschärfe, ungleichmäßiges Licht, Rauschen, JPEG. Diese Bilder liegen als
Regressionstests in `omr-core/src/jvmTest/resources`.

- Bei ausreichender Auflösung (Abstand der Notenlinien ≈ 18 px oder mehr) wurden die
  Teststücke vollständig richtig erkannt.
- Bei kleinen, unscharfen Abbildungen (Linienabstand ≈ 14 px) traten vereinzelt Fehler auf:
  ein Achtel als Sechzehntel, ein halber Akkord als Viertelnote, ein übersehenes ♭.

**Mit echten Kamerafotos und Noten anderer Verlage bzw. Notensatzprogramme ist die App noch
nicht getestet.** Dort ist mit mehr Fehlern zu rechnen. Die Option „Erkannte Noten umrahmen“
hilft, solche Fehler zu sehen.

Tipps:

- Möglichst senkrecht von oben fotografieren, das Blatt flach und gleichmäßig beleuchtet.
- Lieber nur einen Teil der Seite formatfüllend und scharf aufnehmen als die ganze Seite klein.

## Projektaufbau

| Modul | Inhalt |
|---|---|
| `omr-core` | Kotlin Multiplatform (JVM und JavaScript) ohne Android-Abhängigkeiten: Binarisierung (Sauvola), Schräglagenkorrektur, Notenlinienerkennung und -entfernung, Symbolerkennung, Haltebögen, Triolen, Zeitberechnung, Zusammensetzen von Videobildern (`VideoStitcher`), MIDI-Export, Klangerzeugung (`audio/Renderer`). `jsMain/WebApi.kt` ist die Schnittstelle für die Web-App. Unit-Tests in `jvmTest`. |
| `app` | Android-App (Jetpack Compose): Kamera/Galerie/Video (`MediaCodec`), Anzeige mit Markierung, Dekodieren der Klavier-Samples und Wiedergabe über `MediaPlayer`. |
| `web` | Web-App (TypeScript, Preact, Vite): Bibliothek mit Rubriken in IndexedDB, PDF-Import (pdf.js), Erkennung und Klangerzeugung in einem Web Worker (Kotlin-Kern als JavaScript), Wiedergabe mit Web Audio, Scrollmodus, Offline-Betrieb (Service Worker). |

Ablauf der Erkennung (`Omr.recognize`):

1. Graustufenbild, verkleinert auf maximal 2400 px Kantenlänge
2. Binarisierung mit lokalem Schwellwert (robust gegen Schatten)
3. Schätzung von Linienstärke und Linienabstand aus Lauflängen; Schräglagenkorrektur
4. Suche nach Fünfergruppen von Notenlinien; jede Linie wird über die Breite verfolgt
   (gewölbte Seiten)
5. Entfernen der Notenlinien und Hilfslinien
6. Volle Notenköpfe per Erosion, leere Notenköpfe (Halbe/Ganze) über ihr eingeschlossenes Loch
7. Hälse, Balken bzw. Fähnchen, Punkte, Vorzeichen, Pausen, Taktstriche, Schlüssel, Tonart
8. Tonhöhen und Zeitpunkte (480 Ticks pro Viertel): Alle Zeichen eines Systems werden nach
   ihrer waagrechten Position zu Spalten gruppiert. Eine Spalte beginnt, sobald in jeder ihrer
   Notenzeilen die vorige Spalte abgelaufen ist. Eine übersehene Note verschiebt so nicht den
   ganzen Rest des Stücks.

## Bauen

Voraussetzungen: JDK 17 und das Android SDK (z. B. über Android Studio).

```bash
./gradlew :omr-core:jvmTest     # Tests der Notenerkennung
./gradlew :app:assembleDebug    # APK: app/build/outputs/apk/debug/app-debug.apk

# Web-App (zusätzlich Node.js 22)
./gradlew :omr-core:jsBrowserProductionLibraryDistribution   # Erkennung als JavaScript
cd web && npm ci && npm run dev                               # Entwicklung
cd web && npm run build                                       # fertige Dateien in web/dist
```

Die Web-App wird bei jedem Push auf den Branch `gh-pages` gelegt und von GitHub Pages
ausgeliefert (einmalig in den Repository-Einstellungen unter „Pages“ die Quelle „Deploy from a
branch“, Branch `gh-pages`, Ordner `/ (root)` wählen).

Bei jedem Push baut GitHub Actions die APK (`.github/workflows/android.yml`) und
veröffentlicht sie als Release `build-<Nummer>` mit eindeutigem Dateinamen
`notenspieler-0.1.<Nummer>-<Commit>.apk`. Die neueste Version steht unter
[Releases](https://github.com/CarstenKeller/note-player/releases). Zum Installieren auf dem
Handy muss „Installation aus unbekannten Quellen“ erlaubt sein. Alle Builds sind mit demselben
Schlüssel (`app/debug.keystore`, öffentlicher Debug-Schlüssel – nicht für den Play Store)
signiert, daher lässt sich jede neue Version direkt über die alte installieren.

Mindestversion: Android 8.0 (API 26).

## Lizenzen

Die Klavier-Samples in `app/src/main/assets/piano` sind das **Salamander Grand Piano V3**
von Alexander Holm (https://archive.org/details/SalamanderGrandPianoV3), Lizenz **CC BY 3.0**,
bezogen über das npm-Paket `@audio-samples/piano-velocity8`. Sie wurden ausgewählt, gekürzt und
neu kodiert; Details in `app/src/main/assets/piano/QUELLE.txt` (für die Web-App als MP3 in
`web/public/piano`).

Die Web-App verwendet pdf.js (Apache 2.0), Preact (MIT) und fflate (MIT).
