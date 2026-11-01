package io.github.carstenkeller.noteplayer.omr

data class Box(val left: Float, val top: Float, val right: Float, val bottom: Float) {
    val centerX get() = (left + right) / 2
    val centerY get() = (top + bottom) / 2
    fun union(o: Box) = Box(minOf(left, o.left), minOf(top, o.top), maxOf(right, o.right), maxOf(bottom, o.bottom))
}

enum class Clef { TREBLE, BASS, ALTO }

/** One staff (five lines) as found on the page. */
data class StaffInfo(
    val index: Int,
    val systemIndex: Int,
    val box: Box,
    val clef: Clef,
    /** Positive = number of sharps, negative = number of flats. */
    val keyFifths: Int,
    /** A vocal line (lyrics below) with accompaniment in other staves of its system. */
    val isVocal: Boolean = false,
)

/** A chord (one or more pitches) or a rest. Times are in MIDI ticks. */
data class MusicEvent(
    val startTick: Int,
    val durationTicks: Int,
    /** MIDI note numbers; empty for rests. */
    val pitches: List<Int>,
    val box: Box,
    val staffIndex: Int,
    val systemIndex: Int,
    val measureIndex: Int,
    /** Pitches tied over from the previous note: they keep sounding instead of being struck again. */
    val holds: List<Int> = emptyList(),
) {
    val isRest get() = pitches.isEmpty()
    val endTick get() = startTick + durationTicks
}

data class SystemInfo(val index: Int, val box: Box, val startTick: Int, val endTick: Int)

/**
 * A repeat sign: a barline with two dots after it (the repeat starts, [start]) or before it
 * (it ends: play again from the last start). [measure] counts the measures of its line from 0:
 * the first measure of the repeat, or the last one.
 */
data class RepeatMark(
    val start: Boolean,
    val x: Double,
    val staffIndex: Int,
    val systemIndex: Int,
    val measureIndex: Int,
    /** An end: where its first ending ("1." bracket above the staff) begins in its line, if there is one. */
    val firstEndingX: Double? = null,
)

data class Score(
    val ticksPerQuarter: Int,
    val events: List<MusicEvent>,
    val staves: List<StaffInfo>,
    val systems: List<SystemInfo>,
) {
    val totalTicks: Int get() = events.maxOfOrNull { it.endTick } ?: 0
    val noteCount: Int get() = events.count { !it.isRest }

    /** Events sounding at [tick]. */
    fun eventsAt(tick: Int): List<MusicEvent> = events.filter { tick >= it.startTick && tick < it.endTick }

    companion object {
        const val TPQ = 480
    }
}

/** A segno (𝄋, where "D.S." goes back to) or coda sign (𝄌) above a system; [measure] as in [RepeatMark]. */
data class NavigationSign(val coda: Boolean, val x: Double, val y: Double, val systemIndex: Int, val measureIndex: Int)

/** Result of the recognition: the normalized (deskewed) page and the score in its coordinates. */
class RecognitionResult(
    val page: GrayImage,
    /** All staves. */
    val score: Score,
    /** Without vocal lines that have accompaniment (same as [score] if there are none). */
    val withoutVocals: Score,
    val staffSpace: Double,
    val skewDegrees: Double,
    val warnings: List<String>,
    /** Guitar tablature staves (six lines); their numbers are not read as notes. */
    val tabs: List<Box> = emptyList(),
    /** Repeat signs, left to right in each line. */
    val repeats: List<RepeatMark> = emptyList(),
    /** Segno and coda signs. */
    val navigation: List<NavigationSign> = emptyList(),
) {
    val hasVocals: Boolean get() = score.staves.any { it.isVocal }
}
