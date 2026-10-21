package io.github.carstenkeller.noteplayer

import android.content.Context
import android.media.Image
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import io.github.carstenkeller.noteplayer.omr.VideoFrame
import kotlin.math.abs
import kotlin.math.max

/** Reads frames from a video in which sheet music scrolls by. */
object VideoLoader {

    /** Frames are taken at most this often. */
    private const val MIN_INTERVAL_US = 250_000L

    /**
     * Decodes [uri] and returns grayscale frames at regular intervals. How many frames are kept
     * depends on the memory available; frames that do not differ from the previous one (the
     * video stands still) are skipped.
     */
    fun loadFrames(context: Context, uri: Uri, onProgress: (Float) -> Unit = {}): List<VideoFrame> {
        val extractor = MediaExtractor()
        try {
            extractor.setDataSource(context, uri, null)
            val track = (0 until extractor.trackCount).firstOrNull {
                extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true
            } ?: error("Die Datei enthält kein Video.")
            extractor.selectTrack(track)
            val format = extractor.getTrackFormat(track)
            val mime = format.getString(MediaFormat.KEY_MIME)!!
            val durationUs = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L
            val rotation = if (format.containsKey(MediaFormat.KEY_ROTATION)) format.getInteger(MediaFormat.KEY_ROTATION) else 0
            val width = format.getInteger(MediaFormat.KEY_WIDTH)
            val height = format.getInteger(MediaFormat.KEY_HEIGHT)
            // very large videos are read at half the resolution
            val step = if (max(width, height) > 2200) 2 else 1
            // gray value and color mark: two bytes per pixel; at most about a third of the memory
            val frameBytes = 2L * (width / step) * (height / step)
            val maxFrames = (Runtime.getRuntime().maxMemory() / 3 / frameBytes).toInt().coerceIn(8, 150)
            var interval = max(MIN_INTERVAL_US, durationUs / maxFrames)

            format.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
            val codec = MediaCodec.createDecoderByType(mime)
            var frames = ArrayList<VideoFrame>()
            try {
                codec.configure(format, null, null, 0)
                codec.start()
                val info = MediaCodec.BufferInfo()
                var inputDone = false
                var nextUs = 0L
                while (true) {
                    if (!inputDone) {
                        val i = codec.dequeueInputBuffer(10_000)
                        if (i >= 0) {
                            val n = extractor.readSampleData(codec.getInputBuffer(i)!!, 0)
                            if (n < 0) {
                                codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                                inputDone = true
                            } else {
                                codec.queueInputBuffer(i, 0, n, extractor.sampleTime, 0)
                                extractor.advance()
                            }
                        }
                    }
                    val o = codec.dequeueOutputBuffer(info, 10_000)
                    if (o < 0) continue
                    val end = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                    if (info.size > 0 && (info.presentationTimeUs >= nextUs || end)) {
                        codec.getOutputImage(o)?.use { image ->
                            val f = rotate(toFrame(image, step), rotation)
                            if (frames.isEmpty() || differs(frames.last(), f)) {
                                if (frames.size >= maxFrames) {
                                    // the video is longer than expected: keep every second frame
                                    frames = ArrayList(frames.filterIndexed { k, _ -> k % 2 == 0 })
                                    interval *= 2
                                }
                                frames += f
                            }
                        }
                        nextUs = info.presentationTimeUs + interval
                        if (durationUs > 0) onProgress((info.presentationTimeUs.toFloat() / durationUs).coerceIn(0f, 1f))
                    }
                    codec.releaseOutputBuffer(o, false)
                    if (end) break
                }
            } finally {
                runCatching { codec.stop() }
                codec.release()
            }
            if (frames.isEmpty()) error("Aus dem Video konnten keine Bilder gelesen werden.")
            return frames
        } finally {
            extractor.release()
        }
    }

    /** YUV image to a frame, via RGB so that colored pixels can be recognized. */
    private fun toFrame(image: Image, step: Int): VideoFrame {
        val crop = image.cropRect
        val w = crop.width() / step
        val h = crop.height() / step
        val yp = image.planes[0]
        val up = image.planes[1]
        val vp = image.planes[2]
        val yBuf = yp.buffer
        val uBuf = up.buffer
        val vBuf = vp.buffer
        val argb = IntArray(w * h)
        for (y in 0 until h) {
            val sy = crop.top + y * step
            for (x in 0 until w) {
                val sx = crop.left + x * step
                val yy = (yBuf.get(sy * yp.rowStride + sx * yp.pixelStride).toInt() and 0xFF) - 16
                val cy = sy / 2
                val cx = sx / 2
                val u = (uBuf.get(cy * up.rowStride + cx * up.pixelStride).toInt() and 0xFF) - 128
                val v = (vBuf.get(cy * vp.rowStride + cx * vp.pixelStride).toInt() and 0xFF) - 128
                val r = ((298 * yy + 409 * v + 128) shr 8).coerceIn(0, 255)
                val g = ((298 * yy - 100 * u - 208 * v + 128) shr 8).coerceIn(0, 255)
                val b = ((298 * yy + 516 * u + 128) shr 8).coerceIn(0, 255)
                argb[y * w + x] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
            }
        }
        return VideoFrame.fromArgb(w, h, argb)
    }

    private fun rotate(f: VideoFrame, degrees: Int): VideoFrame {
        val turns = Math.floorMod(degrees / 90, 4)
        if (turns == 0) return f
        val nw = if (turns % 2 == 1) f.height else f.width
        val nh = if (turns % 2 == 1) f.width else f.height
        val gray = ByteArray(f.gray.size)
        val colored = f.colored
        val mask = colored?.let { BooleanArray(it.size) }
        for (y in 0 until f.height) for (x in 0 until f.width) {
            val (nx, ny) = when (turns) {
                1 -> (f.height - 1 - y) to x
                2 -> (f.width - 1 - x) to (f.height - 1 - y)
                else -> y to (f.width - 1 - x)
            }
            gray[ny * nw + nx] = f.gray[y * f.width + x]
            if (mask != null && colored != null) mask[ny * nw + nx] = colored[y * f.width + x]
        }
        return VideoFrame(nw, nh, gray, mask)
    }

    /** Whether two frames differ noticeably (a coarse grid of pixels is compared). */
    private fun differs(a: VideoFrame, b: VideoFrame): Boolean {
        if (a.width != b.width || a.height != b.height) return true
        var diff = 0L
        var n = 0
        for (y in 0 until a.height step 4) for (x in 0 until a.width step 4) {
            diff += abs(a[x, y] - b[x, y])
            n++
        }
        return diff.toDouble() / n > 0.5
    }
}
