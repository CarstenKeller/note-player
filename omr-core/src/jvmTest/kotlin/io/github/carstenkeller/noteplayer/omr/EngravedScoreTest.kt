package io.github.carstenkeller.noteplayer.omr

import javax.imageio.ImageIO
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Regression tests on scores engraved with Verovio (Bravura font). freude_hr_photo.jpg is the
 * same kind of rendering, distorted like a phone photo (perspective, rotation, blur, uneven
 * light, noise, JPEG).
 */
class EngravedScoreTest {

    private fun recognize(name: String): Score = recognizeFull(name).score

    private fun recognizeFull(name: String): RecognitionResult {
        val img = ImageIO.read(javaClass.getResourceAsStream("/$name")!!)
        val px = IntArray(img.width * img.height)
        for (y in 0 until img.height) for (x in 0 until img.width) {
            val c = img.getRGB(x, y)
            px[y * img.width + x] = (((c shr 16) and 255) * 299 + ((c shr 8) and 255) * 587 + (c and 255) * 114) / 1000
        }
        return Omr.recognize(GrayImage(img.width, img.height, px))
    }

    private val names = listOf("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
    private fun name(p: Int) = names[p % 12] + (p / 12 - 1)
    private fun describe(s: Score) = s.events.joinToString(" ") { e ->
        (if (e.isRest) "R" else e.pitches.joinToString("+") { name(it) }) + "/" + e.durationTicks
    }

    @Test
    fun alleMeineEntchen() {
        assertEquals(
            "C4/480 D4/480 E4/480 F4/480 G4/960 G4/960 A4/480 A4/480 A4/480 A4/480 G4/1920 " +
                "A4/480 A4/480 A4/480 A4/480 G4/1920 F4/480 F4/480 F4/480 F4/480 E4/960 E4/960 " +
                "D4/480 D4/480 D4/480 D4/480 C4/1920",
            describe(recognize("entchen.png")),
        )
    }

    @Test
    fun pianoGrandStaff() {
        val s = recognize("piano.png")
        assertEquals(listOf(Clef.TREBLE, Clef.BASS), s.staves.map { it.clef })
        assertEquals(listOf(-1, -1), s.staves.map { it.keyFifths })
        assertEquals(1, s.systems.size)
        val upper = s.events.filter { it.staffIndex == 0 }.joinToString(" ") { e -> e.pitches.joinToString("+") { name(it) } + "@" + e.startTick }
        val lower = s.events.filter { it.staffIndex == 1 }.joinToString(" ") { e -> e.pitches.joinToString("+") { name(it) } + "@" + e.startTick }
        assertEquals("C5@0 D5@480 E5@960 F5@1440 G5@1920 C5+E5@2880 F5@3840 G5@4080 A5@4320 Bb5@4560 C6@4800 A3+C4+F4@5760", upper)
        assertEquals("F3@0 C3@1920 C4@2880 F3@3840 A3@4800 F2@5760", lower)
    }

    @Test
    fun photographedOdeToJoy() {
        val s = recognize("freude_hr_photo.jpg")
        assertEquals(listOf(2, 2, 2), s.staves.map { it.keyFifths })
        val line = "F#4/480 F#4/480 G4/480 A4/480 A4/480 G4/480 F#4/480 E4/480 D4/480 D4/480 E4/480 F#4/480"
        assertEquals(
            "$line F#4/720 E4/240 E4/960 $line E4/720 D4/240 D4/960 " +
                "E4/480 E4/480 F#4/480 D4/480 E4/480 F#4/240 G4/240 F#4/480 D4/480 " +
                "E4/480 F#4/240 G4/240 F#4/480 E4/480 D4/480 E4/480 A3/960 " +
                "$line E4/720 D4/240 D4/960",
            describe(s),
        )
    }

    /** Voice with lyrics above a piano grand staff: chords of half/whole notes, rests, dots. */
    @Test
    fun vocalWithPiano() {
        val r = recognizeFull("vocal_piano.png")
        val s = r.score
        assertEquals(listOf(true, false, false), s.staves.map { it.isVocal })
        assertEquals(setOf(1, 2), r.withoutVocals.events.map { it.staffIndex }.toSet())
        assertEquals(1, s.systems.size)
        assertEquals(listOf(Clef.TREBLE, Clef.TREBLE, Clef.BASS), s.staves.map { it.clef })
        fun staff(i: Int) = s.events.filter { it.staffIndex == i }.joinToString(" ") { e ->
            (if (e.isRest) "R" else e.pitches.joinToString("+") { name(it) }) + "@" + e.startTick + "/" + e.durationTicks
        }
        assertEquals(
            "B4@0/720 C5@720/240 D5@960/960 R@1920/960 E5@2880/480 D5@3360/240 D5@3600/240 " +
                "B4@3840/480 A4@4320/480 G4@4800/480 F#4@5280/480 A4@5760/960 R@6720/960 G4@7680/1920",
            staff(0),
        )
        assertEquals(
            "E4+G4+B4@0/720 C5@720/240 E4+G4+D5@960/960 C4+E4+G4@1920/1920 D4+G4+B4@3840/1440 R@5280/480 " +
                "C4+E4+A4@5760/1920 B3+D4+G4@7680/1920",
            staff(1),
        )
        assertEquals("A2+A3@0/1920 E3+B3@1920/1920 C3+G3@3840/1920 D3@5760/960 F#3@6720/960 G2+G3@7680/1920", staff(2))
    }

    /** Same music on two systems; the second system has little lyrics text. */
    @Test
    fun vocalLineInEverySystem() {
        val r = recognizeFull("vocal_piano_two_systems.png")
        assertEquals(listOf(true, false, false, true, false, false), r.score.staves.map { it.isVocal })
        assertEquals(listOf(1, 1, 1, 1, 1, 1), r.score.staves.map { it.keyFifths })
        val piano = r.withoutVocals
        assertEquals(setOf(1, 2, 4, 5), piano.events.map { it.staffIndex }.toSet())
        // the second line follows the first without a gap: 3 measures of 4/4
        assertEquals(listOf(0, 5760), piano.systems.map { it.startTick })
        assertEquals(5760, piano.events.filter { it.systemIndex == 1 }.minOf { it.startTick })
    }

    /**
     * Voice + piano over three systems with an intro (rests in the voice), sixteenth notes with
     * double beams and chords of whole notes right at the start of lines.
     */
    @Test
    fun songWithIntro() {
        val r = recognizeFull("song_vocal_piano.png")
        val s = r.score
        assertEquals(listOf(true, false, false, true, false, false, true, false, false), s.staves.map { it.isVocal })
        assertEquals(listOf(Clef.TREBLE, Clef.TREBLE, Clef.BASS), s.staves.take(3).map { it.clef })
        fun line(staff: Int) = s.events.filter { it.staffIndex == staff && !it.isRest }
            .joinToString(" ") { e -> e.pitches.joinToString("+") { name(it) } }
        // sixteenths of the intro (the first one, E3 below two ledger lines, is not found yet)
        assertEquals(true, line(1).contains("B3 E4 G4 B4 D5 E5 G5 B5 D5 E5 G5 B5 D4+G4"), line(1))
        // whole-note chords at the start of the second and third system
        assertEquals(true, line(5).startsWith("A2+A3 "), line(5))
        assertEquals(true, line(8).startsWith("G2+G3 "), line(8))
    }

    /** Ties within a measure, over a barline, on a chord; repeated notes without a tie stay struck. */
    @Test
    fun ties() {
        val s = recognize("ties.png")
        val described = s.events.joinToString(" ") { e ->
            e.pitches.joinToString("+") { name(it) } + (if (e.holds.isEmpty()) "" else "~" + e.holds.sorted().joinToString("+") { name(it) })
        }
        assertEquals("C5 C5~C5 D5 E5 E5 E5 E5~E5 D5 C4+E4 C4+E4~C4+E4 G4 A4 A4 A4 A4~A4 G4", described)
    }

    /** A tie on one note of a chord holds the whole chord; the same chord without a tie is struck again. */
    @Test
    fun tiedChords() {
        val s = recognize("chord_ties.png")
        val described = s.events.joinToString(" ") { e ->
            e.pitches.joinToString("+") { name(it) } + (if (e.holds.isEmpty()) "" else "~" + e.holds.sorted().joinToString("+") { name(it) })
        }
        assertEquals(
            "A3+C4+E4 A3+C4+E4~A3+C4+E4 E5 B3+C4+E4 B3+C4+E4~B3+C4+E4 C5 A3+C4+E4 A3+C4+E4 A4",
            described,
        )
    }

    /** The flag of an eighth note before a half note of the same pitch is no tie. */
    @Test
    fun flagIsNoTie() {
        assertEquals(0, recognize("freude_hr_photo.jpg").events.count { it.holds.isNotEmpty() })
    }

    /**
     * Sixteenths with flags, dotted rhythms, eighth rests; an eighth note's flag must not count
     * as a hollow head.
     */
    @Test
    fun rhythms() {
        assertEquals(
            "R/240 B4/240 B4/240 B4/240 D5/480 R/480 " +
                "F#5/240 F#5/240 F#5/120 D5/240 F#5/120 F#5/480 D5/240 D5/240 " +
                "E5/120 D5/360 A4/240 D5/240 D5/480 R/480 " +
                "R/360 B4/120 E5/240 E5/120 E5/120 E5/480 R/360 A4/120",
            describe(recognize("rhythm.png")),
        )
    }

    /**
     * Two voices in one staff: a melody above a held whole-note chord. Each voice keeps its own
     * length, the melody goes on at its own pace.
     */
    @Test
    fun twoVoicesInOneStaff() {
        val s = recognize("voices.png")
        // start/length per event; pitches of the stacked whole notes are not checked here
        assertEquals(
            "0/720 0/1920 720/240 960/960 1920/480 1920/1920 2400/480 2880/480 3360/480 3840/1920",
            s.events.joinToString(" ") { "${it.startTick}/${it.durationTicks}" },
        )
        assertEquals(listOf("B4", "C5", "C5", "E5", "D5", "C5", "B4"), s.events.filter { it.durationTicks < 1920 }.map { name(it.pitches.first()) })
    }

    /**
     * Quarter triplets under a bracket with the "3": three notes in the time of two. The second
     * bracket is slanted. (Image rendered with Verovio.)
     */
    @Test
    fun tripletBrackets() {
        val s = recognize("triplets.png")
        assertEquals(
            "0/480 480/480 960/320 1280/320 1600/320 1920/320 2240/320 2560/320 2880/960 3840/480 4320/480 4800/960",
            s.events.joinToString(" ") { "${it.startTick}/${it.durationTicks}" },
        )
    }

    /**
     * Guitar music: a staff with the notes above a tablature staff (six lines with fret numbers)
     * and chord names, engraved with LilyPond (C time signature). The tablature is not read as a
     * staff; its numbers are no notes. The C time signature is no key signature.
     */
    @Test
    fun notesAboveTablature() {
        val r = recognizeFull("notes_tab.png")
        assertEquals(1, r.score.staves.size)
        assertEquals(1, r.tabs.size)
        assertEquals(0, r.score.staves[0].keyFifths)
        // written pitches (the guitar sounds an octave lower)
        assertEquals(
            "E5/480 G5/480 C6/480 G5/480 A5/960 E5/480 C5/480 F5/480 A5/480 C6/480 A5/480 G5/960 B4/960 " +
                "C5/480 E5/480 G5/480 E5/480 E5/240 G5/240 B5/240 G5/240 E5/960 D5/480 F5/480 A5/480 F5/480 G5/1920",
            describe(r.score),
        )
    }

    /**
     * Two voices in one staff (melody with stems up, bass with stems down, ties) above a
     * tablature, key of two flats, "C" time signature (LilyPond). Each voice keeps its own time:
     * the long bass notes do not hold up the melody. The flat cut in two by the line removal and
     * the "C" cut in two are read as key and time signature.
     */
    @Test
    fun twoVoicesAboveTablature() {
        val r = recognizeFull("two_voices_tab.png")
        assertEquals(-2, r.score.staves.single().keyFifths)
        val measures = r.score.events.groupBy { it.measureIndex }.values.map { ev -> ev.maxOf { it.endTick } - ev.minOf { it.startTick } }
        assertEquals(listOf(1920, 1920, 1920, 1920, 1920, 1920), measures)
        // bass and melody begin together
        val first = r.score.events.filter { it.measureIndex == 0 && !it.isRest }.sortedBy { it.startTick }
        assertEquals(0, first.first { it.pitches.first() < 60 }.startTick)
    }
}
