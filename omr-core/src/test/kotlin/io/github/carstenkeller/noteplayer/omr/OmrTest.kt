package io.github.carstenkeller.noteplayer.omr

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class OmrTest {

    private val q = Score.TPQ

    /** G A B C | D(h) B(h) | E F (beamed eighths) G A(h) | F# G C(h) */
    private fun melody(s: SyntheticScore, top: Double): Double {
        val b = s.staff(top)
        val t = top
        s.trebleClef(90.0, b)
        var x = 170.0
        fun adv(dx: Double = 75.0) { x += dx }
        s.note(x, b, 2); adv()
        s.note(x, b, 3); adv()
        s.note(x, b, 4); adv()
        s.note(x, b, 5); adv()
        s.barline(x, t, b); adv(50.0)
        s.note(x, b, 6, hollow = true); adv(110.0)
        s.note(x, b, 4, hollow = true); adv(110.0)
        s.barline(x, t, b); adv(50.0)
        val e1 = s.note(x, b, 0); adv(60.0)
        val e2 = s.note(x, b, 1); adv()
        s.beam(e1, e2)
        s.note(x, b, 2); adv()
        s.note(x, b, 3, hollow = true); adv(110.0)
        s.barline(x, t, b); adv(80.0)
        s.sharp(x, b, 1)
        s.note(x, b, 1); adv()
        s.note(x, b, 2); adv()
        s.note(x, b, 5, hollow = true); adv(110.0)
        s.barline(x, t, b)
        return b
    }

    private val expectedPitches = listOf(67, 69, 71, 72, 74, 71, 64, 65, 67, 69, 66, 67, 72)
    private val expectedDurations = listOf(q, q, q, q, 2 * q, 2 * q, q / 2, q / 2, q, 2 * q, q, q, 2 * q)

    private fun check(result: RecognitionResult) {
        val notes = result.score.events.filter { !it.isRest }
        assertEquals(expectedPitches, notes.map { it.pitches.single() }, "pitches")
        assertEquals(expectedDurations, notes.map { it.durationTicks }, "durations")
        // strictly sequential timing
        var t = 0
        for (n in notes) { assertEquals(t, n.startTick); t += n.durationTicks }
    }

    @Test
    fun cleanMelody() {
        val s = SyntheticScore()
        melody(s, 200.0)
        val r = Omr.recognize(s.toGray())
        assertEquals(1, r.score.staves.size)
        check(r)
    }

    @Test
    fun photographedMelody() {
        val s = SyntheticScore()
        melody(s, 200.0)
        melody(s, 550.0)
        val r = Omr.recognize(s.toGray(rotationDeg = 2.0, noise = 25, gradient = true))
        assertEquals(2, r.score.staves.size)
        assertEquals(2, r.score.systems.size, "unconnected staves are separate systems")
        assertTrue(kotlin.math.abs(r.skewDegrees - 2.0) < 0.3, "skew ${r.skewDegrees}")
        val notes = r.score.events.filter { !it.isRest }
        assertEquals(expectedPitches + expectedPitches, notes.map { it.pitches.single() })
    }

    @Test
    fun grandStaffPlaysInParallel() {
        val s = SyntheticScore()
        val b1 = s.staff(200.0)
        val b2 = s.staff(340.0)
        s.barline(60.0, 200.0, b2) // system bracket line
        s.trebleClef(90.0, b1)
        s.bassClef(80.0, b2)
        // upper: four quarters, lower: one whole note (dotted rhythm check through barline sync)
        var x = 160.0
        for (st in listOf(2, 3, 4, 5)) { s.note(x, b1, st); x += 80 }
        s.note(160.0, b2, 2, hollow = true, stem = false)
        s.barline(x, 200.0, b2)
        s.note(x + 60, b1, 2, hollow = true)
        s.note(x + 60, b2, 4, hollow = true)
        val r = Omr.recognize(s.toGray())
        assertEquals(2, r.score.staves.size)
        assertEquals(1, r.score.systems.size)
        val upper = r.score.events.filter { it.staffIndex == 0 }
        val lower = r.score.events.filter { it.staffIndex == 1 }
        assertEquals(listOf(0, q, 2 * q, 3 * q, 4 * q), upper.map { it.startTick })
        assertEquals(listOf(0, 4 * q), lower.map { it.startTick })
        assertEquals(4 * q, lower[0].durationTicks)
        assertEquals(listOf(Clef.TREBLE, Clef.BASS), r.score.staves.map { it.clef })
        assertEquals(listOf(67, 69, 71, 72, 67), upper.map { it.pitches.single() })
        assertEquals(listOf(47, 50), lower.map { it.pitches.single() }) // B2, D3
    }

    @Test
    fun dottedNoteAndWholeRest() {
        val s = SyntheticScore()
        val b = s.staff(200.0)
        s.trebleClef(90.0, b)
        s.note(160.0, b, 2)
        s.dot(160.0, b, 2)
        s.note(260.0, b, 3, up = true)
        s.barline(400.0, 200.0, b)
        s.wholeRest(480.0, b)
        s.barline(600.0, 200.0, b)
        val r = Omr.recognize(s.toGray())
        val ev = r.score.events
        assertEquals(q * 3 / 2, ev[0].durationTicks)
        val rest = ev.single { it.isRest }
        assertEquals(1, rest.measureIndex)
    }

    @Test
    fun midiFileIsWellFormed() {
        val score = Score(q, listOf(
            MusicEvent(0, q, listOf(60), Box(0f, 0f, 1f, 1f), 0, 0, 0),
            MusicEvent(q, q, listOf(64, 67), Box(0f, 0f, 1f, 1f), 0, 0, 0),
        ), emptyList(), emptyList())
        val bytes = MidiWriter.write(score, 120)
        assertEquals("MThd", String(bytes, 0, 4, Charsets.US_ASCII))
        assertEquals("MTrk", String(bytes, 14, 4, Charsets.US_ASCII))
        val len = ((bytes[18].toInt() and 0xFF) shl 24) or ((bytes[19].toInt() and 0xFF) shl 16) or
            ((bytes[20].toInt() and 0xFF) shl 8) or (bytes[21].toInt() and 0xFF)
        assertEquals(bytes.size - 22, len)
        assertEquals(500L, MidiWriter.ticksToMillis(q, 120, q))
    }
}
