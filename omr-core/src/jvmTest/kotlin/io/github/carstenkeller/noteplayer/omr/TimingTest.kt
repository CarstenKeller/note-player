package io.github.carstenkeller.noteplayer.omr

import kotlin.test.Test
import kotlin.test.assertEquals

class TimingTest {
    private val q = Score.TPQ
    private val box = Box(0f, 0f, 1f, 1f)
    private fun ev(start: Int, dur: Int, measure: Int, system: Int = 0) =
        MusicEvent(start, dur, listOf(60), box, 0, system, measure)

    @Test
    fun overlongMeasureIsCompressed() {
        // four 4/4 measures; in measure 2 the last note was read as a whole note instead of a quarter
        val events = ArrayList<MusicEvent>()
        var t = 0
        for (m in 0 until 4) for (b in 0 until 4) {
            val dur = if (m == 2 && b == 3) 4 * q else q
            events += ev(t, dur, m)
            t += dur
        }
        val systems = listOf(SystemInfo(0, box, 0, t))
        val (out, sys) = Timing.normalizeMeasures(events, systems)
        assertEquals((0 until 16).map { it * q }, out.map { it.startTick })
        assertEquals(16 * q, sys.single().endTick)
    }

    @Test
    fun pauseAtEndOfLineDisappears() {
        // system 0 ends with a measure that lasts too long (e.g. a misread rest), system 1 follows
        val events = listOf(
            ev(0, 4 * q, 0), ev(4 * q, 4 * q, 1), ev(8 * q, 8 * q, 2),
            ev(16 * q, 4 * q, 0, system = 1), ev(20 * q, 4 * q, 1, system = 1),
        )
        val systems = listOf(SystemInfo(0, box, 0, 16 * q), SystemInfo(1, box, 16 * q, 24 * q))
        val (out, sys) = Timing.normalizeMeasures(events, systems)
        assertEquals(listOf(0, 4 * q, 8 * q, 12 * q, 16 * q), out.map { it.startTick })
        assertEquals(listOf(0 to 12 * q, 12 * q to 20 * q), sys.map { it.startTick to it.endTick })
    }

    @Test
    fun regularPieceIsUnchanged() {
        val events = (0 until 12).map { ev(it * q, q, it / 4) }
        val systems = listOf(SystemInfo(0, box, 0, 12 * q))
        assertEquals(events, Timing.normalizeMeasures(events, systems).first)
    }
}
