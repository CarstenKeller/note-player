package io.github.carstenkeller.noteplayer.audio

import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import java.nio.ByteOrder
import kotlin.math.abs

/** A recorded note: mono samples at [sampleRate], recorded at MIDI pitch [pitch]. */
class Sample(val pitch: Int, val data: FloatArray, val sampleRate: Int)

/**
 * Piano samples from assets/piano (file names like "C4.ogg", "Fs5.ogg").
 * Decoded once on first use and kept in memory (about 4 MB).
 */
class SampleBank(private val context: Context) {
    @Volatile private var samples: List<Sample>? = null

    fun get(): List<Sample> = samples ?: synchronized(this) {
        samples ?: load().also { samples = it }
    }

    /** The recorded note closest to [pitch]. */
    fun nearest(pitch: Int): Sample = get().minBy { abs(it.pitch - pitch) }

    private fun load(): List<Sample> {
        val names = context.assets.list("piano").orEmpty().filter { it.endsWith(".ogg") }
        return names.mapNotNull { name ->
            val pitch = pitchOf(name.removeSuffix(".ogg")) ?: return@mapNotNull null
            val (data, rate) = decode("piano/$name")
            Sample(pitch, data, rate)
        }.sortedBy { it.pitch }
    }

    private fun pitchOf(name: String): Int? {
        val m = Regex("([A-G])(s?)(\\d)").matchEntire(name) ?: return null
        val base = mapOf('C' to 0, 'D' to 2, 'E' to 4, 'F' to 5, 'G' to 7, 'A' to 9, 'B' to 11)[m.groupValues[1][0]]!!
        val sharp = if (m.groupValues[2] == "s") 1 else 0
        return 12 * (m.groupValues[3].toInt() + 1) + base + sharp
    }

    /** Decodes a compressed audio asset to mono float samples. */
    private fun decode(asset: String): Pair<FloatArray, Int> {
        val afd = context.assets.openFd(asset)
        val extractor = MediaExtractor()
        extractor.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
        afd.close()
        val format = extractor.getTrackFormat(0)
        extractor.selectTrack(0)
        var rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        val codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
        codec.configure(format, null, null, 0)
        codec.start()
        var out = FloatArray(rate * 5)
        var n = 0
        val info = MediaCodec.BufferInfo()
        var inputDone = false
        var outputDone = false
        try {
            while (!outputDone) {
                if (!inputDone) {
                    val i = codec.dequeueInputBuffer(10_000)
                    if (i >= 0) {
                        val buf = codec.getInputBuffer(i)!!
                        val size = extractor.readSampleData(buf, 0)
                        if (size < 0) {
                            codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            codec.queueInputBuffer(i, 0, size, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }
                val o = codec.dequeueOutputBuffer(info, 10_000)
                if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    rate = codec.outputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    channels = codec.outputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                } else if (o >= 0) {
                    val buf = codec.getOutputBuffer(o)!!
                    buf.position(info.offset)
                    buf.limit(info.offset + info.size)
                    val shorts = buf.order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
                    val frames = shorts.remaining() / channels
                    if (n + frames > out.size) out = out.copyOf(maxOf(out.size * 2, n + frames))
                    for (f in 0 until frames) {
                        var sum = 0f
                        for (c in 0 until channels) sum += shorts.get()
                        out[n++] = sum / channels / 32768f
                    }
                    codec.releaseOutputBuffer(o, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                }
            }
        } finally {
            codec.stop()
            codec.release()
            extractor.release()
        }
        return out.copyOf(n) to rate
    }
}
