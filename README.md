# Notenspieler

Android-App, die ein Notenblatt aus einem Foto oder Bild erkennt, das Stück vorspielt und
während des Abspielens anzeigt, wo man sich gerade befindet.

## Funktionen

- **Notenblatt fotografieren** (Kamera-App des Geräts) oder **Bild auswählen** (Galerie / Dateien).
  Bilder können auch über „Teilen“ aus einer anderen App an den Notenspieler geschickt werden.
- **Notenerkennung direkt auf dem Gerät**: offline, kein Server, kein Konto.
- **Wiedergabe** über den eingebauten MIDI-Synthesizer von Android (Klavierklang).
  Das Tempo lässt sich einstellen (30–200 Schläge pro Minute).
- **Positionsanzeige** beim Abspielen:
  - Die gerade klingenden Noten werden orange hervorgehoben.
  - Ein senkrechter Cursor läuft durch die aktuelle Notenzeile.
  - Die Ansicht scrollt automatisch zur aktuellen Zeile.
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
- Ganze, halbe, Viertel- und Achtelpausen
- Taktstriche
- Klaviersysteme: zwei durch eine Linie verbundene Systeme werden gleichzeitig gespielt
  und an den Taktstrichen synchronisiert

**Nicht** unterstützt werden u. a.:

- Handschrift
- Taktart (wird überlesen; eine Ganztaktpause zählt als 4 Viertel, wenn sonst nichts im Takt steht)
- Triolen
- Haltebögen (gebundene Noten werden neu angeschlagen)
- Wiederholungen, Volta-Klammern, D.C./D.S.
- Mehrere Stimmen in einem System
- Schlüssel- oder Tonartwechsel mitten in der Zeile
- Vorschlagsnoten, Verzierungen, Dynamik
- Mehrseitige Stücke (ein Bild pro Durchgang)

### Wie gut funktioniert das?

Geprüft habe ich das nur mit Notensatz, der mit [Verovio](https://www.verovio.org) (Schriftart
Bravura) gerendert wurde, teils zusätzlich „wie ein Handyfoto“ verzerrt: Perspektive,
Drehung, Unschärfe, ungleichmäßiges Licht, Rauschen, JPEG. Diese Bilder liegen als
Regressionstests in `omr-core/src/test/resources`.

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
| `omr-core` | Reines Kotlin/JVM ohne Android-Abhängigkeiten: Binarisierung (Sauvola), Schräglagenkorrektur, Notenlinienerkennung und -entfernung, Symbolerkennung, Zeitberechnung, MIDI-Export. Mit Unit-Tests. |
| `app` | Android-App (Jetpack Compose): Kamera/Galerie, Anzeige mit Markierung, Wiedergabe über `MediaPlayer` (MIDI). |

Ablauf der Erkennung (`Omr.recognize`):

1. Graustufenbild, verkleinert auf maximal 2400 px Kantenlänge
2. Binarisierung mit lokalem Schwellwert (robust gegen Schatten)
3. Schätzung von Linienstärke und Linienabstand aus Lauflängen; Schräglagenkorrektur
4. Suche nach Fünfergruppen von Notenlinien; jede Linie wird über die Breite verfolgt
   (gewölbte Seiten)
5. Entfernen der Notenlinien und Hilfslinien
6. Volle Notenköpfe per Erosion, leere Notenköpfe (Halbe/Ganze) über ihr eingeschlossenes Loch
7. Hälse, Balken bzw. Fähnchen, Punkte, Vorzeichen, Pausen, Taktstriche, Schlüssel, Tonart
8. Tonhöhen und Zeitpunkte (480 Ticks pro Viertel); die Systeme eines Klaviersystems
   werden an den Taktstrichen synchronisiert

## Bauen

Voraussetzungen: JDK 17 und das Android SDK (z. B. über Android Studio).

```bash
./gradlew :omr-core:test        # Tests der Notenerkennung
./gradlew :app:assembleDebug    # APK: app/build/outputs/apk/debug/app-debug.apk
```

Bei jedem Push baut GitHub Actions die APK (`.github/workflows/android.yml`) und
veröffentlicht sie als Release `build-<Nummer>` mit eindeutigem Dateinamen
`notenspieler-0.1.<Nummer>-<Commit>.apk`. Die neueste Version steht unter
[Releases](https://github.com/CarstenKeller/note-player/releases). Zum Installieren auf dem
Handy muss „Installation aus unbekannten Quellen“ erlaubt sein. Alle Builds sind mit demselben
Schlüssel (`app/debug.keystore`, öffentlicher Debug-Schlüssel – nicht für den Play Store)
signiert, daher lässt sich jede neue Version direkt über die alte installieren.

Mindestversion: Android 8.0 (API 26).
