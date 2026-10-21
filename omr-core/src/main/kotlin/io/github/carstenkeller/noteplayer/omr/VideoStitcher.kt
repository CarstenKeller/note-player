package io.github.carstenkeller.noteplayer.omr

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * One grayscale video frame, one unsigned byte per pixel (0 = black, 255 = white).
 * [colored] marks pixels whose gray value is doubtful because something colored covers them.
 */
class VideoFrame(val width: Int, val height: Int, val gray: ByteArray, val colored: BooleanArray? = null) {
    init {
        require(gray.size == width * height) { "pixel buffer does not match size" }
        require(colored == null || colored.size == gray.size) { "mask does not match size" }
    }

    operator fun get(x: Int, y: Int): Int = gray[y * width + x].toInt() and 0xFF

    companion object {
        /**
         * Grayscale from ARGB pixels. Colored pixels (cursor, highlighted notes, frames drawn by a
         * player app) are marked: printed notes are black.
         */
        fun fromArgb(width: Int, height: Int, argb: IntArray): VideoFrame {
            val out = ByteArray(width * height)
            val mask = BooleanArray(width * height)
            for (i in argb.indices) {
                val c = argb[i]
                val r = (c shr 16) and 0xFF
                val g = (c shr 8) and 0xFF
                val b = c and 0xFF
                mask[i] = max(r, max(g, b)) - min(r, min(g, b)) > COLOR_LIMIT
                val luma = (r * 299 + g * 587 + b * 114) / 1000
                // a light colored area is a highlight on the paper, a dark one ink underneath
                out[i] = (if (mask[i] && luma > 110) 255 else luma).toByte()
            }
            // video compression stores color at a lower resolution than brightness: the edges
            // of thin colored lines look gray, so the neighbourhood of colored pixels goes too
            val grown = grow(mask, width, height, 1)
            return VideoFrame(width, height, out, grown)
        }

        private fun grow(mask: BooleanArray, w: Int, h: Int, r: Int): BooleanArray {
            val rows = BooleanArray(mask.size)
            for (y in 0 until h) {
                var last = -r - 1
                for (x in 0 until w) if (mask[y * w + x]) last = x else if (x - last <= r) rows[y * w + x] = true
                last = w + r + 1
                for (x in w - 1 downTo 0) if (mask[y * w + x]) last = x else if (last - x <= r) rows[y * w + x] = true
                for (x in 0 until w) if (mask[y * w + x]) rows[y * w + x] = true
            }
            val out = BooleanArray(mask.size)
            for (x in 0 until w) {
                var last = -r - 1
                for (y in 0 until h) if (rows[y * w + x]) { last = y; out[y * w + x] = true } else if (y - last <= r) out[y * w + x] = true
                last = h + r + 1
                for (y in h - 1 downTo 0) if (rows[y * w + x]) last = y else if (last - y <= r) out[y * w + x] = true
            }
            return out
        }

        /** Above this difference between the strongest and the weakest color channel a pixel counts as colored. */
        const val COLOR_LIMIT = 40
    }
}

/**
 * Puts the frames of a video in which sheet music scrolls by (vertically or horizontally)
 * together into one long page.
 *
 * 1. The part of the picture that changes during the video is the score. What never changes
 *    (buttons) is left out, and so is what stands still while the score scrolls (a title bar
 *    whose text changes now and then).
 * 2. Each frame is located in the page built so far: rough candidates from the ink per row,
 *    checked pixel by pixel. A frame that fits nowhere (a page was turned) starts a new
 *    section below.
 * 3. Overlapping frames are averaged, leaving out colored pixels. A cursor or a highlighted
 *    note in one frame is filled in from the others.
 */
object VideoStitcher {

    fun stitch(frames: List<VideoFrame>): GrayImage {
        require(frames.isNotEmpty()) { "Das Video enthält keine Bilder." }
        val w = frames[0].width
        val h = frames[0].height
        val region = movingRegion(frames) ?: Region(0, 0, w, h)
        val crops = frames.map { crop(it, region) }
        val horizontal = scrollsHorizontally(crops)
        val strips = (if (horizontal) crops.map { transpose(it) } else crops).let { s ->
            val rows = scrollingRows(s)
            if (rows == null) s else s.map { crop(it, Region(0, rows.first, it.width, rows.last + 1)) }
        }
        val page = stitchVertically(strips)
        return withMargin((if (horizontal) transpose(page) else page).toGray())
    }

    /** A white margin around the page: the frame may cut the score right at its first lines. */
    private fun withMargin(img: GrayImage): GrayImage {
        val m = max(16, img.width / 25)
        val w = img.width + 2 * m
        val out = IntArray(w * (img.height + 2 * m)) { 255 }
        for (y in 0 until img.height) System.arraycopy(img.pixels, y * img.width, out, (y + m) * w + m, img.width)
        return GrayImage(w, img.height + 2 * m, out)
    }

    data class Region(val left: Int, val top: Int, val right: Int, val bottom: Int) {
        val width get() = right - left
        val height get() = bottom - top
    }

    /** The largest block of rows and columns whose pixels change during the video. */
    fun movingRegion(frames: List<VideoFrame>): Region? {
        if (frames.size < 2) return null
        val w = frames[0].width
        val h = frames[0].height
        val step = 4
        val gw = w / step
        val gh = h / step
        if (gw < 4 || gh < 4) return null
        val lo = IntArray(gw * gh) { 255 }
        val hi = IntArray(gw * gh)
        for (f in frames) for (gy in 0 until gh) for (gx in 0 until gw) {
            val v = f[gx * step, gy * step]
            val i = gy * gw + gx
            if (v < lo[i]) lo[i] = v
            if (v > hi[i]) hi[i] = v
        }
        val moving = BooleanArray(gw * gh) { hi[it] - lo[it] > 60 }
        val rowFraction = DoubleArray(gh) { gy -> (0 until gw).count { moving[gy * gw + it] }.toDouble() / gw }
        val rows = largestBlock(BooleanArray(gh) { rowFraction[it] > 0.05 }, gh / 30) ?: return null
        val colFraction = DoubleArray(gw) { gx -> (rows.first until rows.last + 1).count { moving[it * gw + gx] }.toDouble() / (rows.last + 1 - rows.first) }
        val cols = largestBlock(BooleanArray(gw) { colFraction[it] > 0.05 }, gw / 30) ?: return null
        val region = Region(cols.first * step, rows.first * step, min(w, (cols.last + 1) * step), min(h, (rows.last + 1) * step))
        return if (region.width >= w / 4 && region.height >= h / 8) region else null
    }

    /**
     * Rows that take part in the scrolling. Rows that stay the same while the frame scrolls (a
     * title bar above the score, buttons below) are cut off.
     */
    private fun scrollingRows(frames: List<VideoFrame>): IntRange? {
        val h = frames[0].height
        val w = frames[0].width
        val still = IntArray(h)
        val moved = IntArray(h)
        val neutral = IntArray(h)
        val blank = IntArray(h)
        for (i in 1 until frames.size) {
            val a = frames[i - 1]
            val b = frames[i]
            val shift = bestShift(rowInk(a), rowInk(b))
            if (abs(shift) < 4) continue
            for (y in 0 until h) {
                // row y of b came from row y + shift of a; near the edge, where that row is not
                // in the picture, row y of a went to row y - shift of b
                val forward = y + shift in 0 until h
                if (!forward && y - shift !in 0 until h) continue
                val (now, before, other) = if (forward) Triple(b, a, y + shift) else Triple(a, b, y - shift)
                var ink = 0
                var diff = 0
                var shifted = 0
                fun colored(f: VideoFrame, x: Int, yy: Int) = f.colored?.get(yy * w + x) == true
                for (x in 0 until w step 2) {
                    // a cursor or a highlight changes from frame to frame: left out
                    if (colored(now, x, y) || colored(before, x, y) || colored(before, x, other)) continue
                    ink += 255 - now[x, y]
                    diff += abs(before[x, y] - now[x, y])
                    shifted += abs(before[x, other] - now[x, y])
                }
                if (ink < 3 * w / 2) { blank[y]++; continue }
                if (diff * 2 < shifted && diff * 4 < ink) still[y]++
                else if (shifted * 2 < diff && shifted * 2 < ink) moved[y]++
                // looks the same either way: along a staff line, a uniform button
                else neutral[y]++
            }
        }
        if (moved.sum() == 0) return null
        // from the edges, rows are cut off while they stood still, look the same moved or not
        // (a uniform button) or are blank; a row that was never compared stops the cutting
        // (after a big jump only part of the rows overlap)
        fun cut(y: Int) = still[y] + neutral[y] > moved[y] || (moved[y] + still[y] + neutral[y] == 0 && blank[y] > 0)
        var first = 0
        while (first < h && cut(first)) first++
        var last = h - 1
        while (last > first && cut(last)) last--
        return if (first >= last) null else first..last
    }

    /** The longest run of true values, bridging gaps up to [maxGap]. */
    private fun largestBlock(on: BooleanArray, maxGap: Int): IntRange? {
        var best: IntRange? = null
        var start = -1
        var lastOn = -1
        for (i in 0..on.size) {
            val isOn = i < on.size && on[i]
            if (!isOn) continue
            if (start < 0) start = i
            else if (i - lastOn > maxGap + 1) {
                if (best == null || lastOn - start > best.last - best.first) best = start..lastOn
                start = i
            }
            lastOn = i
        }
        if (start >= 0 && (best == null || lastOn - start > best.last - best.first)) best = start..lastOn
        return best
    }

    private fun crop(f: VideoFrame, r: Region): VideoFrame {
        val out = ByteArray(r.width * r.height)
        val mask = f.colored?.let { BooleanArray(r.width * r.height) }
        for (y in 0 until r.height) {
            System.arraycopy(f.gray, (r.top + y) * f.width + r.left, out, y * r.width, r.width)
            if (mask != null) System.arraycopy(f.colored, (r.top + y) * f.width + r.left, mask, y * r.width, r.width)
        }
        return VideoFrame(r.width, r.height, out, mask)
    }

    private fun transpose(f: VideoFrame): VideoFrame {
        val out = ByteArray(f.gray.size)
        val mask = f.colored?.let { BooleanArray(f.gray.size) }
        for (y in 0 until f.height) for (x in 0 until f.width) {
            out[x * f.height + y] = f.gray[y * f.width + x]
            if (mask != null) mask[x * f.height + y] = f.colored[y * f.width + x]
        }
        return VideoFrame(f.height, f.width, out, mask)
    }

    private fun VideoFrame.toGray() = GrayImage(width, height, IntArray(gray.size) { gray[it].toInt() and 0xFF })

    /** Ink per row (or per column), 0 = white. */
    private fun rowInk(f: VideoFrame): IntArray = IntArray(f.height) { y ->
        var s = 0
        for (x in 0 until f.width) s += 255 - f[x, y]
        s / f.width
    }

    private fun colInk(f: VideoFrame): IntArray = IntArray(f.width) { x ->
        var s = 0
        for (y in 0 until f.height) s += 255 - f[x, y]
        s / f.height
    }

    /** Whether the content moves sideways rather than up and down. */
    private fun scrollsHorizontally(frames: List<VideoFrame>): Boolean {
        var vertical = 0
        var horizontal = 0
        for (i in 1 until frames.size) {
            vertical += abs(bestShift(rowInk(frames[i - 1]), rowInk(frames[i])))
            horizontal += abs(bestShift(colInk(frames[i - 1]), colInk(frames[i])))
        }
        return horizontal > 2 * vertical
    }

    /** Shift s with b[k] ≈ a[k + s], at least half overlapping; the smallest of equally good shifts. */
    private fun bestShift(a: IntArray, b: IntArray): Int {
        val n = a.size
        var best = 0
        var bestErr = Double.MAX_VALUE
        for (s in -n / 2..n / 2) {
            var err = 0L
            var cnt = 0
            for (k in max(0, -s) until min(n, n - s)) { err += abs(b[k] - a[k + s]); cnt++ }
            if (cnt == 0) continue
            val e = err.toDouble() / cnt
            if (e < bestErr - 1e-9 || (abs(e - bestErr) < 1e-9 && abs(s) < abs(best))) { bestErr = e; best = s }
        }
        return best
    }

    /**
     * The page as rows of summed gray values; it grows at the bottom (and at the top when
     * scrolling back). Colored pixels are only used where a pixel never shows without color.
     */
    private class Canvas(val width: Int) {
        val sums = ArrayDeque<IntArray>()
        val counts = ArrayDeque<ShortArray>()
        val coloredSums = ArrayDeque<IntArray>()
        val coloredCounts = ArrayDeque<ShortArray>()
        var top = 0 // page coordinate of the first row
        val bottom get() = top + sums.size

        /** Mean gray value at page row [y], white where nothing is known. */
        fun value(x: Int, y: Int): Int {
            val i = y - top
            val n = counts[i][x].toInt()
            if (n > 0) return sums[i][x] / n
            val m = coloredCounts[i][x].toInt()
            return if (m > 0) coloredSums[i][x] / m else 255
        }

        private fun addRow(first: Boolean) {
            if (first) {
                sums.addFirst(IntArray(width)); counts.addFirst(ShortArray(width))
                coloredSums.addFirst(IntArray(width)); coloredCounts.addFirst(ShortArray(width))
            } else {
                sums.addLast(IntArray(width)); counts.addLast(ShortArray(width))
                coloredSums.addLast(IntArray(width)); coloredCounts.addLast(ShortArray(width))
            }
        }

        fun put(f: VideoFrame, at: Int) {
            while (at < top) { addRow(first = true); top-- }
            while (at + f.height > bottom) addRow(first = false)
            for (y in 0 until f.height) {
                for (x in 0 until width) {
                    val i = y * width + x
                    val isColored = f.colored?.get(i) == true
                    val sum = (if (isColored) coloredSums else sums)[at + y - top]
                    val cnt = (if (isColored) coloredCounts else counts)[at + y - top]
                    if (cnt[x] == Short.MAX_VALUE) continue
                    sum[x] += f.gray[i].toInt() and 0xFF
                    cnt[x]++
                }
            }
        }

        fun toFrame(): VideoFrame {
            val out = ByteArray(width * sums.size)
            for (y in 0 until sums.size) for (x in 0 until width) out[y * width + x] = value(x, top + y).toByte()
            return VideoFrame(width, sums.size, out)
        }
    }

    private fun stitchVertically(frames: List<VideoFrame>): VideoFrame {
        val canvas = Canvas(frames[0].width)
        canvas.put(frames[0], 0)
        var pos = 0
        for (i in 1 until frames.size) {
            val f = frames[i]
            pos = locate(canvas, f, pos) ?: (canvas.bottom + f.height / 20) // no overlap: a new page below
            canvas.put(f, pos)
        }
        return canvas.toFrame()
    }

    /**
     * Where [f] fits into [canvas] (page row of its top), or null. Rough candidates from the ink
     * per row are checked pixel by pixel; of equally good places the one closest to [previous]
     * wins (a piece may repeat whole lines).
     */
    private fun locate(canvas: Canvas, f: VideoFrame, previous: Int): Int? {
        val fr = rowInk(f)
        val cr = IntArray(canvas.sums.size) { i ->
            var s = 0
            for (x in 0 until canvas.width) s += 255 - canvas.value(x, canvas.top + i)
            s / canvas.width
        }
        // usually the score moves on a little: first look near the previous place
        val near = (previous - 2 * f.height)..(previous + 2 * f.height)
        return locateIn(canvas, f, fr, cr, previous, near) ?: locateIn(canvas, f, fr, cr, previous, Int.MIN_VALUE..Int.MAX_VALUE)
    }

    private fun locateIn(canvas: Canvas, f: VideoFrame, fr: IntArray, cr: IntArray, previous: Int, range: IntRange): Int? {
        val minOverlap = f.height / 4
        val candidates = ArrayList<Pair<Int, Double>>()
        val from = max(range.first, canvas.top - f.height + minOverlap)
        val to = min(range.last, canvas.bottom - minOverlap)
        for (at in from..to) {
            var err = 0L
            var sum = 0L
            val y0 = max(0, canvas.top - at)
            val y1 = min(f.height, canvas.bottom - at)
            for (y in y0 until y1) {
                val c = cr[at + y - canvas.top]
                err += abs(fr[y] - c)
                sum += fr[y] + c
            }
            if (sum == 0L) continue
            candidates += at to err.toDouble() / sum
        }
        val shortlist = candidates.sortedBy { it.second }.take(8).map { it.first } + previous
        var best: Int? = null
        var bestScore = Double.MAX_VALUE
        for (c in shortlist.distinct()) for (at in c - 2..c + 2) {
            if (at < from || at > to) continue
            val s = pixelMismatch(canvas, f, at) ?: continue
            val better = s < bestScore - 0.03 || (s < bestScore + 0.03 && best != null && abs(at - previous) < abs(best - previous))
            if (better) { bestScore = min(bestScore, s); best = at }
        }
        return if (best != null && bestScore < 0.45) best else null
    }

    /** Share of ink that differs between [f] placed at [at] and the canvas (0 = same, 1 = unrelated). */
    private fun pixelMismatch(canvas: Canvas, f: VideoFrame, at: Int): Double? {
        val y0 = max(0, canvas.top - at)
        val y1 = min(f.height, canvas.bottom - at)
        if (y1 - y0 < f.height / 4) return null
        var diff = 0L
        var ink = 0L
        for (y in y0 until y1 step 2) for (x in 0 until f.width step 2) {
            if (f.colored?.get(y * f.width + x) == true) continue
            val a = 255 - f[x, y]
            val b = 255 - canvas.value(x, at + y)
            // ink only: white paper does not count
            if (a > 60 || b > 60) {
                diff += abs(a - b)
                ink += max(a, b)
            }
        }
        return if (ink == 0L) null else diff.toDouble() / ink
    }
}
