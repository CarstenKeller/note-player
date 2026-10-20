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
) {
    val isRest get() = pitches.isEmpty()
    val endTick get() = startTick + durationTicks
}

data class SystemInfo(val index: Int, val box: Box, val startTick: Int, val endTick: Int)

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

/** Result of the recognition: the normalized (deskewed) page and the score in its coordinates. */
class RecognitionResult(
    val page: GrayImage,
    val score: Score,
    val staffSpace: Double,
    val skewDegrees: Double,
    val warnings: List<String>,
)
