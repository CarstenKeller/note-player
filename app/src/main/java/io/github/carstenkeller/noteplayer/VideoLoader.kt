package io.github.carstenkeller.noteplayer

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.media.MediaMetadataRetriever
import android.net.Uri
import io.github.carstenkeller.noteplayer.omr.VideoFrame
import kotlin.math.abs
import kotlin.math.max

/** Reads frames from a video in which sheet music scrolls by. */
object VideoLoader {

    /** Frames are taken at most this often. */
    private const val MIN_INTERVAL_MS = 250L

    /**
     * Takes frames of [uri] at regular intervals as grayscale. How many frames are kept depends
     * on the memory available; frames that do not differ from the previous one (the video stands
     * still) are skipped.
     *
     * The frames come from the system ([MediaMetadataRetriever]) as finished pictures; decoding
     * the raw video data directly depends on the pixel formats of each device's decoder.
     */
    fun loadFrames(context: Context, uri: Uri, onProgress: (Float) -> Unit = {}): List<VideoFrame> {
        val retriever = MediaMetadataRetriever()
        try {
            retriever.setDataSource(context, uri)
            fun meta(key: Int) = retriever.extractMetadata(key)?.toLongOrNull()
            val durationMs = meta(MediaMetadataRetriever.METADATA_KEY_DURATION) ?: 0L
            val width = meta(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toInt() ?: 0
            val height = meta(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toInt() ?: 0
            val rotation = meta(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toInt() ?: 0
            if (width <= 0 || height <= 0) error("Die Datei enthält kein Video.")
            // very large videos are read at half the resolution
            val scale = if (max(width, height) > 2200) 0.5f else 1f
            // gray value and color mark: two bytes per pixel; the frames take at most a fifth of
            // the memory (putting them together needs about as much again, plus the page)
            val frameBytes = 2L * (width * scale).toLong() * (height * scale).toLong()
            val maxFrames = (Runtime.getRuntime().maxMemory() / 5 / frameBytes).toInt().coerceIn(8, 150)
            val interval = max(MIN_INTERVAL_MS, durationMs / maxFrames)

            val frames = ArrayList<VideoFrame>()
            var t = 0L
            while (t <= durationMs) {
                val bitmap = retriever.getFrameAtTime(t * 1000, MediaMetadataRetriever.OPTION_CLOSEST)
                if (bitmap != null) {
                    val f = toFrame(upright(bitmap, rotation, width, height), scale)
                    if (frames.isEmpty() || differs(frames.last(), f)) frames += f
                }
                if (durationMs > 0) onProgress((t.toFloat() / durationMs).coerceIn(0f, 1f))
                t += interval
            }
            if (frames.isEmpty()) error("Aus dem Video konnten keine Bilder gelesen werden.")
            return frames
        } finally {
            retriever.release()
        }
    }

    /**
     * Turns the frame as the video is meant to be watched. Depending on the Android version the
     * system already did that; then the frame has the turned size.
     */
    private fun upright(bitmap: Bitmap, rotation: Int, width: Int, height: Int): Bitmap {
        val r = Math.floorMod(rotation, 360)
        if (r == 0) return bitmap
        if (r % 180 != 0 && bitmap.width == height && bitmap.height == width) return bitmap
        val m = Matrix().apply { postRotate(r.toFloat()) }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, m, true).also {
            if (it != bitmap) bitmap.recycle()
        }
    }

    private fun toFrame(bitmap: Bitmap, scale: Float): VideoFrame {
        val b = if (scale == 1f) bitmap else Bitmap.createScaledBitmap(
            bitmap, (bitmap.width * scale).toInt(), (bitmap.height * scale).toInt(), true,
        ).also { if (it != bitmap) bitmap.recycle() }
        val argb = IntArray(b.width * b.height)
        b.getPixels(argb, 0, b.width, 0, 0, b.width, b.height)
        val frame = VideoFrame.fromArgb(b.width, b.height, argb)
        b.recycle()
        return frame
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
