package io.github.carstenkeller.noteplayer.omr

import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Several pages of one piece (e.g. one photo per sheet), each recognized on its own, joined into
 * one result: the pages below each other, the music one after the other.
 */
object Pages {

    /** Width of the joined page; pages are scaled to it (larger pages are not kept larger). */
    private const val MAX_WIDTH = 1800

    fun join(parts: List<RecognitionResult>): RecognitionResult {
        require(parts.isNotEmpty())
        if (parts.size == 1) return parts[0]
        val width = min(MAX_WIDTH, parts.maxOf { it.page.width })
        val scales = parts.map { width.toDouble() / it.page.width }
        val gap = max(20, (parts.map { it.staffSpace }.average() * 4).roundToInt())
        val heights = parts.mapIndexed { i, p -> max(1, (p.page.height * scales[i]).roundToInt()) }
        val offsets = heights.runningFold(0) { y, h -> y + h + gap }
        val page = GrayImage(width, offsets.last() - gap)
        for ((i, p) in parts.withIndex()) draw(page, p.page, offsets[i], scales[i], heights[i])

        fun place(b: Box, i: Int): Box {
            val s = scales[i].toFloat()
            val y = offsets[i].toFloat()
            return Box(b.left * s, b.top * s + y, b.right * s, b.bottom * s + y)
        }

        fun joinScores(scores: List<Score>): Score {
            val events = ArrayList<MusicEvent>()
            val staves = ArrayList<StaffInfo>()
            val systems = ArrayList<SystemInfo>()
            var tick = 0
            for ((i, s) in scores.withIndex()) {
                val staffOffset = staves.size
                val systemOffset = systems.size
                for (st in s.staves) staves += st.copy(index = st.index + staffOffset, systemIndex = st.systemIndex + systemOffset, box = place(st.box, i))
                for (sy in s.systems) systems += sy.copy(index = sy.index + systemOffset, box = place(sy.box, i), startTick = sy.startTick + tick, endTick = sy.endTick + tick)
                for (e in s.events) {
                    // a tie does not reach from one page to the next (the page break is not
                    // seen as a line break)
                    events += e.copy(
                        startTick = e.startTick + tick,
                        box = place(e.box, i),
                        staffIndex = e.staffIndex + staffOffset,
                        systemIndex = e.systemIndex + systemOffset,
                        holds = if (e.startTick == 0) emptyList() else e.holds,
                    )
                }
                tick += s.totalTicks
            }
            return Score(Score.TPQ, events, staves, systems)
        }

        val warnings = parts.flatMapIndexed { i, p -> p.warnings.map { "Blatt ${i + 1}: $it" } }
        val staffSpace = parts.mapIndexed { i, p -> p.staffSpace * scales[i] }.sorted()[parts.size / 2]
        return RecognitionResult(
            page,
            joinScores(parts.map { it.score }),
            joinScores(parts.map { it.withoutVocals }),
            staffSpace,
            0.0,
            warnings,
        )
    }

    /** Draws [src] scaled by [scale] into [dst] at row [top] (area averaging when shrinking). */
    private fun draw(dst: GrayImage, src: GrayImage, top: Int, scale: Double, height: Int) {
        val w = dst.width
        for (y in 0 until height) {
            val sy0 = (y / scale).toInt()
            val sy1 = min(src.height, max(sy0 + 1, ((y + 1) / scale).toInt()))
            for (x in 0 until w) {
                val sx0 = (x / scale).toInt()
                val sx1 = min(src.width, max(sx0 + 1, ((x + 1) / scale).toInt()))
                var sum = 0
                var n = 0
                for (sy in sy0 until sy1) for (sx in sx0 until sx1) { sum += src[min(sx, src.width - 1), min(sy, src.height - 1)]; n++ }
                dst.pixels[(top + y) * w + x] = if (n == 0) 255 else sum / n
            }
        }
    }
}
