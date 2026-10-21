package io.github.carstenkeller.noteplayer.omr

import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Evens out measure lengths. A piece almost always has measures of equal length, while a
 * single misread note (an eighth read as a quarter, a missing beam) makes its measure longer
 * and shows up as a hesitation or a pause, e.g. at the end of a line. Measures that are clearly
 * longer than the typical measure of the piece are compressed to the typical length.
 */
object Timing {

    fun normalizeMeasures(events: List<MusicEvent>, systems: List<SystemInfo>): Pair<List<MusicEvent>, List<SystemInfo>> {
        if (events.isEmpty()) return events to systems
        // start of every measure = its earliest event; measures in playing order
        val starts = events.groupBy { it.systemIndex to it.measureIndex }
            .mapValues { (_, list) -> list.minOf { it.startTick } }
            .entries.sortedWith(compareBy({ it.key.first }, { it.key.second }))
        // the measure numbers must run forward in time, otherwise barlines were missed and
        // the measure boundaries are not trustworthy
        for (i in 1 until starts.size) if (starts[i].value <= starts[i - 1].value) return events to systems
        val end = events.maxOf { it.endTick }
        val bounds = starts.map { it.value } + end
        val lengths = (0 until starts.size).map { bounds[it + 1] - bounds[it] }
        if (lengths.size < 3) return events to systems
        val median = lengths.sorted()[lengths.size / 2]
        if (median <= 0) return events to systems
        // time signatures are not read; when misread notes make most measures a bit too long,
        // the median is still close to a common measure length (2/4, 3/4 or 6/8, 4/4, 6/4)
        val tpq = Score.TPQ
        val common = intArrayOf(2 * tpq, 3 * tpq, 4 * tpq, 6 * tpq)
        val typical = common.firstOrNull { abs(median - it) <= 0.15 * it } ?: median

        // a missed barline makes two measures look like one long measure; such a "measure" is
        // also about twice as wide on the page, so the allowed length follows the width
        val byMeasure = events.groupBy { it.systemIndex to it.measureIndex }
        val widths = starts.map { (key, _) -> byMeasure.getValue(key).let { l -> l.maxOf { it.box.right } - l.minOf { it.box.left } } }
        val typicalWidth = widths.sorted()[widths.size / 2].coerceAtLeast(1f)
        val allowed = lengths.indices.map { k -> typical * maxOf(1, (widths[k] / typicalWidth).roundToInt()) }
        if (lengths.indices.none { lengths[it] > allowed[it] * 1.2 }) return events to systems

        // all distinct onsets in playing order; within an overlong measure the longest gaps are
        // shortened first (a misread long note makes one gap too long, the rest is fine)
        val onsets = (events.map { it.startTick } + end).distinct().sorted()
        val newOnset = HashMap<Int, Int>()
        var shift = 0
        for (k in lengths.indices) {
            val inMeasure = onsets.filter { it >= bounds[k] && it <= bounds[k + 1] }.ifEmpty { listOf(bounds[k], bounds[k + 1]) }
            val pts = (listOf(bounds[k]) + inMeasure + bounds[k + 1]).distinct().sorted()
            val gaps = DoubleArray(pts.size - 1) { (pts[it + 1] - pts[it]).toDouble() }
            var excess = (lengths[k] - allowed[k]).toDouble()
            if (lengths[k] > allowed[k] * 1.2) {
                while (excess > 0.5) {
                    val max = gaps.max()
                    val second = gaps.filter { it < max }.maxOrNull() ?: 0.0
                    val count = gaps.count { it == max }
                    val cut = minOf(max - second, excess / count)
                    for (i in gaps.indices) if (gaps[i] == max) gaps[i] -= cut
                    excess -= cut * count
                }
            }
            var t = (bounds[k] + shift).toDouble()
            newOnset.putIfAbsent(pts[0], t.roundToInt())
            for (i in gaps.indices) {
                t += gaps[i]
                if (pts[i + 1] != bounds[k + 1] || k == lengths.size - 1) newOnset[pts[i + 1]] = t.roundToInt()
            }
            shift = t.roundToInt() - bounds[k + 1]
            newOnset[bounds[k + 1]] = t.roundToInt()
        }
        fun map(t: Int): Int = newOnset[t] ?: run {
            // between onsets: interpolate
            val i = onsets.binarySearch(t).let { if (it < 0) -it - 2 else it }.coerceIn(0, onsets.size - 2)
            val a = onsets[i]
            val b = onsets[i + 1]
            val na = newOnset.getValue(a)
            val nb = newOnset.getValue(b)
            na + ((t - a).toDouble() * (nb - na) / maxOf(1, b - a)).roundToInt()
        }

        val newEvents = events.map { e ->
            val s = map(e.startTick)
            // a note keeps its length unless that would run past the (shortened) next onsets
            val newEnd = map(minOf(e.endTick, end))
            e.copy(startTick = s, durationTicks = maxOf(1, minOf(e.durationTicks, newEnd - s)))
        }.sortedWith(compareBy<MusicEvent>({ it.startTick }, { it.staffIndex }))
        val newSystems = systems.map { s -> s.copy(startTick = map(s.startTick), endTick = map(minOf(s.endTick, end))) }
        return newEvents to newSystems
    }
}
