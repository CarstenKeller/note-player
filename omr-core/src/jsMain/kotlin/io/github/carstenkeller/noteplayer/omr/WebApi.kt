@file:OptIn(ExperimentalJsExport::class)

package io.github.carstenkeller.noteplayer.omr

import io.github.carstenkeller.noteplayer.audio.Instrument
import io.github.carstenkeller.noteplayer.audio.Renderer
import io.github.carstenkeller.noteplayer.audio.Sample
import io.github.carstenkeller.noteplayer.audio.SampleSource
import io.github.carstenkeller.noteplayer.audio.TempoMap
import kotlin.math.abs

/** Result of [WebOmr.recognize]: the straightened page as gray pixels and the music as JSON. */
@JsExport
class WebRecognition(
    val width: Int,
    val height: Int,
    /** Gray values 0..255, row by row. */
    val pixels: IntArray,
    /** See [WebOmr.recognize] for the format. */
    val json: String,
)

/** Entry points for the web app (called in a web worker). */
@JsExport
object WebOmr {

    /**
     * Recognizes one sheet. [gray] holds gray values 0..255 row by row; [maxSide] limits the
     * working size as in the Android app.
     *
     * The JSON: {"staffSpace", "skew", "warnings": [..], "score": S, "withoutVocals": S} with
     * S = {"tpq", "staves": [{"index", "system", "box": [l, t, r, b], "clef", "key", "vocal"}],
     * "systems": [{"index", "box", "start", "end"}], "events": [{"start", "duration",
     * "pitches", "holds", "box", "staff", "system", "measure"}]}.
     */
    fun recognize(width: Int, height: Int, gray: IntArray, maxSide: Int): WebRecognition {
        val r = Omr.recognize(GrayImage(width, height, gray), maxSide)
        val json = Json().obj {
            num("staffSpace", r.staffSpace)
            num("skew", r.skewDegrees)
            arr("tabs") { for (b in r.tabs) box(b) }
            arr("warnings") { for (w in r.warnings) str(w) }
            key("score"); score(r.score)
            key("withoutVocals"); score(r.withoutVocals)
        }.toString()
        return WebRecognition(r.page.width, r.page.height, r.page.pixels, json)
    }

    /**
     * Joins the frames of a screen recording of scrolling sheet music into one picture
     * (gray values row by row, width and height in front).
     */
    fun stitchVideo(width: Int, height: Int, frames: Array<IntArray>): IntArray {
        val img = VideoStitcher.stitch(frames.map { VideoFrame.fromArgb(width, height, it) })
        return intArrayOf(img.width, img.height) + img.pixels
    }

    /**
     * Renders the music as sound (mono, [sampleRate] samples per second).
     *
     * [events] lists each sounding event as: start tick, end tick, staff index, strum (0 = all
     * notes together, 1 = guitar downstroke, -1 = upstroke), number of pitches, the pitches,
     * number of held (tied) pitches, the held pitches. [bassStaves]
     * marks staves in the bass clef (played a little softer). [samples] are the piano
     * recordings: [samplePitches] tells the MIDI pitch of each, all at [samplesRate].
     */
    fun render(
        events: IntArray,
        bassStaves: Array<Int>,
        tpq: Int,
        /** Tempo changes: from tick [tempoTicks] on, [tempoBpm] quarter notes per minute. */
        tempoTicks: IntArray,
        tempoBpm: DoubleArray,
        instrument: String,
        samplePitches: Array<Int>,
        samples: Array<FloatArray>,
        samplesRate: Int,
    ): FloatArray {
        val list = ArrayList<MusicEvent>()
        val strums = HashMap<MusicEvent, Int>()
        var i = 0
        val noBox = Box(0f, 0f, 0f, 0f)
        while (i < events.size) {
            val start = events[i]
            val end = events[i + 1]
            val staff = events[i + 2]
            val strum = events[i + 3]
            val n = events[i + 4]
            val pitches = (0 until n).map { events[i + 5 + it] }
            i += 5 + n
            val h = events[i]
            val holds = (0 until h).map { events[i + 1 + it] }
            i += 1 + h
            val e = MusicEvent(start, end - start, pitches, noBox, staff, 0, list.size, holds)
            list += e
            if (strum != 0) strums[e] = strum
        }
        // staff numbers can be large (a marker for the accompaniment): numbered anew from 0
        val used = list.map { it.staffIndex }.distinct().sorted()
        val index = used.withIndex().associate { (k, v) -> v to k }
        val compact = list.map { e -> e.copy(staffIndex = index.getValue(e.staffIndex)).also { c -> strums[e]?.let { strums[c] = it } } }
        val staves = used.mapIndexed { k, s -> StaffInfo(k, 0, noBox, if (s in bassStaves) Clef.BASS else Clef.TREBLE, 0) }
        val bank = samplePitches.indices.map { Sample(samplePitches[it], samples[it], samplesRate) }
        val source = object : SampleSource {
            override fun nearest(pitch: Int) = bank.minBy { abs(it.pitch - pitch) }
        }
        val inst = Instrument.entries.firstOrNull { it.name == instrument } ?: Instrument.GRAND_PIANO
        return Renderer.render(Score(tpq, compact, staves, emptyList()), TempoMap(tempoTicks, tempoBpm, tpq), inst, source) { strums[it] ?: 0 }
    }

    /** The sample rate of [render]. */
    val sampleRate: Int get() = Renderer.RATE

    private fun Json.score(s: Score) = obj {
        num("tpq", s.ticksPerQuarter)
        arr("staves") {
            for (st in s.staves) obj {
                num("index", st.index)
                num("system", st.systemIndex)
                key("box"); box(st.box)
                str("clef", st.clef.name)
                num("key", st.keyFifths)
                bool("vocal", st.isVocal)
            }
        }
        arr("systems") {
            for (sy in s.systems) obj {
                num("index", sy.index)
                key("box"); box(sy.box)
                num("start", sy.startTick)
                num("end", sy.endTick)
            }
        }
        arr("events") {
            for (e in s.events) obj {
                num("start", e.startTick)
                num("duration", e.durationTicks)
                arr("pitches") { for (p in e.pitches) num(p) }
                arr("holds") { for (p in e.holds) num(p) }
                key("box"); box(e.box)
                num("staff", e.staffIndex)
                num("system", e.systemIndex)
                num("measure", e.measureIndex)
            }
        }
    }

    private fun Json.box(b: Box) = arr { num(b.left.toDouble()); num(b.top.toDouble()); num(b.right.toDouble()); num(b.bottom.toDouble()) }
}

/** A minimal JSON writer (the data has no nesting deeper than a few levels). */
private class Json {
    private val sb = StringBuilder()
    private var first = true

    private fun sep() {
        if (!first) sb.append(',')
        first = false
    }

    fun key(k: String) {
        sep()
        quote(k)
        sb.append(':')
        first = true
    }

    fun obj(body: Json.() -> Unit): Json {
        sep()
        sb.append('{')
        first = true
        body()
        sb.append('}')
        first = false
        return this
    }

    fun arr(body: Json.() -> Unit): Json {
        sep()
        sb.append('[')
        first = true
        body()
        sb.append(']')
        first = false
        return this
    }

    fun arr(k: String, body: Json.() -> Unit) { key(k); arr(body) }
    fun num(v: Int) { sep(); sb.append(v) }
    fun num(v: Double) { sep(); sb.append(if (v.isFinite()) ((v * 100).toLong() / 100.0).toString() else "0") }
    fun num(k: String, v: Int) { key(k); num(v) }
    fun num(k: String, v: Double) { key(k); num(v) }
    fun str(v: String) { sep(); quote(v) }
    fun str(k: String, v: String) { key(k); str(v) }
    fun bool(k: String, v: Boolean) { key(k); sep(); sb.append(v) }

    private fun quote(s: String) {
        sb.append('"')
        for (c in s) when {
            c == '"' -> sb.append("\\\"")
            c == '\\' -> sb.append("\\\\")
            c < ' ' -> sb.append("\\u").append(c.code.toString(16).padStart(4, '0'))
            else -> sb.append(c)
        }
        sb.append('"')
    }

    override fun toString() = sb.toString()
}
