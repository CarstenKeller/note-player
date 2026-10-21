package io.github.carstenkeller.noteplayer.omr

import javax.imageio.ImageIO
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * A video is simulated from an engraved page: a window scrolls down the page, above it a title
 * bar whose text changes, below it buttons that never change, and an orange cursor moving
 * through the score. The stitched page must be read like the page itself.
 */
class VideoStitcherTest {

    private class Page(val w: Int, val h: Int, val argb: IntArray)

    private fun load(name: String): Page {
        val img = ImageIO.read(javaClass.getResourceAsStream("/$name")!!)
        val argb = IntArray(img.width * img.height)
        img.getRGB(0, 0, img.width, img.height, argb, 0, img.width)
        return Page(img.width, img.height, argb)
    }

    private fun gray(w: Int, h: Int, argb: IntArray) = GrayImage(w, h, IntArray(argb.size) { i ->
        val c = argb[i]
        (((c shr 16) and 255) * 299 + ((c shr 8) and 255) * 587 + (c and 255) * 114) / 1000
    })

    private fun simulate(w: Int, h: Int, page: IntArray, view: Int, steps: List<Int>): List<VideoFrame> {
        val bar = 60
        val buttons = 80
        val fh = bar + view + buttons
        return steps.mapIndexed { n, top ->
            val f = IntArray(w * fh) { 0xFFFFFFFF.toInt() }
            // title bar with a "text" that changes every few frames
            for (y in 15 until 45) for (x in 20 until 20 + 40 * (1 + (n / 4) % 3)) if ((x / 6) % 2 == 0) f[y * w + x] = 0xFF000000.toInt()
            for (y in 0 until view) {
                val py = top + y
                if (py in 0 until h) System.arraycopy(page, py * w, f, (bar + y) * w, w)
            }
            // orange cursor
            val cx = 50 + (n * 97) % (w - 100)
            for (y in bar until bar + view) for (x in cx until cx + 4) f[y * w + x] = 0xFFE8833A.toInt()
            // buttons
            for (y in bar + view + 20 until bar + view + 60) for (x in 40 until w - 40) f[y * w + x] = 0xFF3E2C73.toInt()
            for (y in bar + view + 30 until bar + view + 50) for (x in 60 until 160) f[y * w + x] = 0xFF000000.toInt()
            VideoFrame.fromArgb(w, fh, f)
        }
    }

    @Test
    fun scrollingPageIsReadLikeThePage() {
        val p = load("song_vocal_piano.png")
        val w = p.w
        val h = p.h
        val page = p.argb
        val view = h * 2 / 5
        // uneven scrolling with pauses, a little back, up to the end of the page
        val steps = ArrayList<Int>()
        var top = 0
        var k = 0
        while (top < h - view) {
            steps += top
            top += when (k++ % 5) { 0 -> 0; 1 -> view / 3; 2 -> view / 7; 3 -> -view / 10; else -> view / 4 }
        }
        steps += h - view
        val stitched = VideoStitcher.stitch(simulate(w, h, page, view, steps))

        val expected = Omr.recognize(gray(w, h, page)).score
        val actual = Omr.recognize(stitched).score
        assertTrue(expected.events.size > 20)
        assertEquals(expected.staves.map { it.clef to it.keyFifths }, actual.staves.map { it.clef to it.keyFifths })
        // the notes of every staff; the stitched page is not identical pixel for pixel, small
        // differences in timing are a matter of the recognition, not of the stitching
        fun notes(s: Score) = s.staves.indices.map { st -> s.events.filter { it.staffIndex == st }.map { it.pitches } }
        assertEquals(notes(expected), notes(actual))
    }

    /** One line of music scrolling sideways, as in many videos of piano pieces. */
    @Test
    fun sidewaysScrollingLineIsReadLikeTheLine() {
        val p = load("ties.png")
        // the line of music with some room above and below
        val top = 40
        val h = 140
        val w = 1300
        val line = IntArray(w * h) { i -> p.argb[(top + i / w) * p.w + i % w] }
        val view = 500
        val bar = 50
        val fh = bar + h + 70
        val frames = ArrayList<VideoFrame>()
        var x = 0
        var n = 0
        while (true) {
            val f = IntArray(view * fh) { 0xFFFFFFFF.toInt() }
            for (yy in 10 until 30) for (xx in 10 until 10 + 40 * (1 + (n / 4) % 3)) f[yy * view + xx] = 0xFF000000.toInt()
            for (yy in 0 until h) System.arraycopy(line, yy * w + x, f, (bar + yy) * view, view)
            val cx = 40 + (n * 53) % (view - 80)
            for (yy in bar until bar + h) for (xx in cx until cx + 4) f[yy * view + xx] = 0xFFE8833A.toInt()
            for (yy in bar + h + 20 until bar + h + 60) for (xx in 20 until view - 20) f[yy * view + xx] = 0xFF3E2C73.toInt()
            frames += VideoFrame.fromArgb(view, fh, f)
            if (x == w - view) break
            n++
            x = (x + listOf(60, 0, 90, -20, 70)[n % 5]).coerceIn(0, w - view)
        }
        val expected = Omr.recognize(gray(w, h, line)).score
        val actual = Omr.recognize(VideoStitcher.stitch(frames)).score
        assertTrue(expected.events.size > 10)
        assertEquals(expected.events.map { it.pitches }, actual.events.map { it.pitches })
    }
}
