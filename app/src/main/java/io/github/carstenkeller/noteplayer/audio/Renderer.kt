package io.github.carstenkeller.noteplayer.audio

import io.github.carstenkeller.noteplayer.omr.Clef
import io.github.carstenkeller.noteplayer.omr.Score
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.random.Random

/** Renders a score to audio (mono, 16 bit) with one of the [Instrument]s. */
object Renderer {
    const val RATE = 32_000

    /** Damper: how fast a note dies away after its written length, in seconds. */
    private const val RELEASE = 0.25

    fun secondsOf(ticks: Int, bpm: Int, tpq: Int) = ticks * 60.0 / (bpm * tpq)

    fun render(score: Score, bpm: Int, instrument: Instrument, bank: SampleBank): FloatArray {
        val tpq = score.ticksPerQuarter
        val total = secondsOf(score.totalTicks, bpm, tpq) + 2.0
        val out = FloatArray((total * RATE).toInt() + 1)
        val random = Random(1)
        for (e in score.events) {
            if (e.isRest) continue
            val start = (secondsOf(e.startTick, bpm, tpq) * RATE).toInt()
            val length = secondsOf(e.durationTicks, bpm, tpq)
            // chords are a bit softer per note so they do not get much louder than single notes;
            // the accompaniment in the bass clef a bit softer than the melody
            val bass = score.staves.getOrNull(e.staffIndex)?.clef == Clef.BASS
            val gain = 0.32f / (1 + 0.15f * (e.pitches.size - 1)) * (if (bass) 0.7f else 1f)
            for (p in e.pitches) {
                when (instrument) {
                    Instrument.GRAND_PIANO -> piano(out, start, length, p, gain, bank)
                    Instrument.ELECTRIC_PIANO -> electricPiano(out, start, length, p, gain)
                    Instrument.ORGAN -> organ(out, start, length, p, gain)
                    Instrument.HARP -> harp(out, start, length, p, gain, random)
                }
            }
        }
        val withRoom = if (instrument == Instrument.ORGAN) out else reverb(out)
        normalize(withRoom)
        return withRoom
    }

    /** A small room (Schroeder reverb: parallel damped combs, then allpasses), mixed in lightly. */
    private fun reverb(dry: FloatArray, wet: Float = 0.16f): FloatArray {
        val combDelays = intArrayOf(1116, 1188, 1277, 1356).map { it * RATE / 44_100 }
        val feedback = 0.80f
        val damp = 0.25f
        val sum = FloatArray(dry.size)
        for (delay in combDelays) {
            val buf = FloatArray(delay)
            var idx = 0
            var low = 0f
            for (i in dry.indices) {
                val y = buf[idx]
                low = y * (1 - damp) + low * damp
                buf[idx] = dry[i] + low * feedback
                idx = if (idx + 1 == delay) 0 else idx + 1
                sum[i] += y
            }
        }
        var signal = sum
        for (delay in intArrayOf(556, 341).map { it * RATE / 44_100 }) {
            val buf = FloatArray(delay)
            var idx = 0
            val out = FloatArray(signal.size)
            for (i in signal.indices) {
                val b = buf[idx]
                val y = -signal[i] * 0.5f + b
                buf[idx] = signal[i] + b * 0.5f
                idx = if (idx + 1 == delay) 0 else idx + 1
                out[i] = y
            }
            signal = out
        }
        return FloatArray(dry.size) { dry[it] + wet * signal[it] / combDelays.size }
    }

    private fun frequency(pitch: Int) = 440.0 * 2.0.pow((pitch - 69) / 12.0)

    /** Envelope after the written end of the note. */
    private fun release(t: Double, length: Double, release: Double = RELEASE): Double =
        if (t <= length) 1.0 else exp(-(t - length) / release)

    private fun piano(out: FloatArray, start: Int, length: Double, pitch: Int, gain: Float, bank: SampleBank) {
        val s = bank.nearest(pitch)
        val step = 2.0.pow((pitch - s.pitch) / 12.0) * s.sampleRate / RATE
        val frames = min(((length + 6 * RELEASE) * RATE).toInt(), ((s.data.size - 1) / step).toInt())
        var pos = 0.0
        for (i in 0 until frames) {
            val o = start + i
            if (o >= out.size) break
            val k = floor(pos).toInt()
            val a = (pos - k).toFloat()
            val v = s.data[k] * (1 - a) + s.data[k + 1] * a
            out[o] += v * gain * 2.2f * release(i.toDouble() / RATE, length).toFloat()
            pos += step
        }
    }

    private fun electricPiano(out: FloatArray, start: Int, length: Double, pitch: Int, gain: Float) {
        val f = frequency(pitch)
        val frames = ((length + 6 * 0.15) * RATE).toInt()
        for (i in 0 until frames) {
            val o = start + i
            if (o >= out.size) break
            val t = i.toDouble() / RATE
            val index = 1.1 * exp(-t / 0.5) + 0.15
            val tone = sin(2 * PI * f * t + index * sin(2 * PI * f * t))
            val bell = 0.12 * sin(2 * PI * f * 14 * t) * exp(-t / 0.04)
            val env = exp(-t / 1.8) * min(1.0, t / 0.002) * release(t, length, 0.15)
            out[o] += ((tone + bell) * env * gain).toFloat()
        }
    }

    private val ORGAN_PARTIALS = doubleArrayOf(1.0, 2.0, 3.0, 4.0, 6.0, 8.0)
    private val ORGAN_LEVELS = doubleArrayOf(1.0, 0.55, 0.35, 0.22, 0.12, 0.08)

    private fun organ(out: FloatArray, start: Int, length: Double, pitch: Int, gain: Float) {
        val f = frequency(pitch)
        val frames = ((length + 0.3) * RATE).toInt()
        for (i in 0 until frames) {
            val o = start + i
            if (o >= out.size) break
            val t = i.toDouble() / RATE
            var v = 0.0
            for (h in ORGAN_PARTIALS.indices) {
                val fh = f * ORGAN_PARTIALS[h]
                if (fh < RATE / 2.2) v += ORGAN_LEVELS[h] * sin(2 * PI * fh * t)
            }
            val env = min(1.0, t / 0.01) * release(t, length, 0.05)
            out[o] += (v * env * gain * 0.45).toFloat()
        }
    }

    /** Plucked string (Karplus-Strong). */
    private fun harp(out: FloatArray, start: Int, length: Double, pitch: Int, gain: Float, random: Random) {
        val period = (RATE / frequency(pitch)).toInt().coerceAtLeast(2)
        val buf = FloatArray(period) { random.nextFloat() * 2 - 1 }
        // a softer pluck: smooth the initial noise once
        for (i in 1 until period) buf[i] = (buf[i] + buf[i - 1]) / 2
        val frames = (min(length, 3.0) + 6 * 0.25) * RATE
        var idx = 0
        for (i in 0 until frames.toInt()) {
            val o = start + i
            if (o >= out.size) break
            val next = (idx + 1) % period
            val v = buf[idx]
            buf[idx] = 0.497f * (buf[idx] + buf[next])
            idx = next
            out[o] += v * gain * 1.3f * release(i.toDouble() / RATE, length, 0.25).toFloat()
        }
    }

    private fun normalize(out: FloatArray) {
        var peak = 0f
        for (v in out) if (v > peak) peak = v else if (-v > peak) peak = -v
        if (peak < 1e-6f) return
        val g = 0.89f / peak
        for (i in out.indices) out[i] *= g
    }

    fun writeWav(samples: FloatArray, file: File) {
        val data = ByteBuffer.allocate(samples.size * 2).order(ByteOrder.LITTLE_ENDIAN)
        for (v in samples) data.putShort((v.coerceIn(-1f, 1f) * 32767).toInt().toShort())
        val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
        header.put("RIFF".toByteArray()).putInt(36 + samples.size * 2).put("WAVE".toByteArray())
        header.put("fmt ".toByteArray()).putInt(16).putShort(1.toShort()).putShort(1.toShort())
            .putInt(RATE).putInt(RATE * 2).putShort(2.toShort()).putShort(16.toShort())
        header.put("data".toByteArray()).putInt(samples.size * 2)
        FileOutputStream(file).use { it.write(header.array()); it.write(data.array()) }
    }
}
