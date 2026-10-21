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
}
