package io.github.carstenkeller.noteplayer.omr

import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.tan

/** Typical sizes on the page: staff line thickness and distance between line centers. */
data class StaffMetrics(val lineThickness: Int, val interline: Double)

/** A five-line staff whose line positions are tracked across the page (photos are rarely flat). */
class Staff(private val ys: Array<DoubleArray>, private val step: Int) {
    var left = 0
    var right = 0

    fun lineY(line: Int, x: Double): Double {
        val row = ys[line]
        val f = x / step
        val j = floor(f).toInt().coerceIn(0, row.size - 2)
        val a = (f - j).coerceIn(0.0, 1.0)
        return row[j] * (1 - a) + row[j + 1] * a
    }

    fun top(x: Double) = lineY(0, x)
    fun bottom(x: Double) = lineY(4, x)
    fun space(x: Double) = (bottom(x) - top(x)) / 4

    /** Diatonic steps above the bottom line (0 = on bottom line, 1 = first space, ...). */
    fun stepAt(x: Double, y: Double): Int = ((bottom(x) - y) / (space(x) / 2)).roundToInt()

    fun minTop(): Double = (left..right step max(1, step)).minOf { top(it.toDouble()) }
    fun maxBottom(): Double = (left..right step max(1, step)).maxOf { bottom(it.toDouble()) }

    fun box() = Box(left.toFloat(), minTop().toFloat(), right.toFloat(), maxBottom().toFloat())

    /** Vertical distance of [y] to the staff (0 when inside). */
    fun distance(x: Double, y: Double): Double {
        val t = top(x)
        val b = bottom(x)
        return when {
            y < t -> t - y
            y > b -> y - b
            else -> 0.0
        }
    }
}

object StaffDetector {

    fun metrics(bin: BinaryImage): StaffMetrics? {
        val black = IntArray(64)
        val white = IntArray(512)
        for (x in 0 until bin.width step 2) {
            var y = 0
            var seenBlack = false
            while (y < bin.height) {
                val v = bin.data[y * bin.width + x]
                var len = 0
                while (y < bin.height && bin.data[y * bin.width + x] == v) { len++; y++ }
                if (v) {
                    if (len < black.size) black[len]++
                    seenBlack = true
                } else if (seenBlack && y < bin.height && len < white.size) {
                    white[len]++
                }
            }
        }
        val t = (1 until black.size).maxByOrNull { black[it] } ?: return null
        val s = (2 until white.size).maxByOrNull { white[it] } ?: return null
        if (black[t] == 0 || white[s] == 0) return null
        // sub-pixel refinement of the space: weighted mean around the mode
        var sum = 0.0
        var wsum = 0.0
        for (i in max(2, s - 1)..min(white.size - 1, s + 1)) {
            sum += i * white[i].toDouble(); wsum += white[i]
        }
        return StaffMetrics(t, sum / wsum + t)
    }

    /** Estimates the page rotation in degrees (positive = lines fall to the right). */
    fun estimateSkew(bin: BinaryImage, interline: Double, lineThickness: Int = 2): Double {
        // only thin pixels in longer horizontal runs: staff lines dominate; text is ignored, and
        // so are thick dark areas such as the table around a photographed page
        val minRun = max(8, (interline * 2).toInt())
        val thin = max(2, 2 * lineThickness + 1)
        val xs = ArrayList<Int>()
        val ys = ArrayList<Int>()
        for (y in 0 until bin.height) {
            var x = 0
            val row = y * bin.width
            while (x < bin.width) {
                if (!bin.data[row + x]) { x++; continue }
                val start = x
                while (x < bin.width && bin.data[row + x]) x++
                if (x - start >= minRun / 2) {
                    var i = start
                    while (i < x) {
                        if (!bin[i, y - thin] && !bin[i, y + thin]) { xs += i; ys += y }
                        i += 2
                    }
                }
            }
        }
        if (xs.isEmpty()) return 0.0
        val pad = bin.width
        val profile = IntArray(bin.height + 2 * pad)
        fun score(deg: Double): Double {
            java.util.Arrays.fill(profile, 0)
            val tn = tan(Math.toRadians(deg))
            for (i in xs.indices) {
                val p = (ys[i] - xs[i] * tn).roundToInt() + pad
                if (p in profile.indices) profile[p]++
            }
            var s = 0.0
            for (v in profile) s += v.toDouble() * v
            return s
        }
        var best = 0.0
        var bestScore = score(0.0)
        var a = -6.0
        while (a <= 6.0) {
            val sc = score(a)
            if (sc > bestScore) { bestScore = sc; best = a }
            a += 0.25
        }
        var fine = best - 0.25
        val end = best + 0.25
        while (fine <= end) {
            val sc = score(fine)
            if (sc > bestScore) { bestScore = sc; best = fine }
            fine += 0.05
        }
        return best
    }

    fun detect(bin: BinaryImage, m: StaffMetrics): List<Staff> {
        val d = m.interline
        val w = bin.width
        val h = bin.height
        val minRun = max(10, (2 * d).toInt())
        val profile = IntArray(h)
        val longestRunMid = IntArray(h)
        for (y in 0 until h) {
            var x = 0
            var best = 0
            val row = y * w
            while (x < w) {
                if (!bin.data[row + x]) { x++; continue }
                val start = x
                while (x < w && bin.data[row + x]) x++
                val len = x - start
                if (len >= minRun) profile[y] += len
                if (len > best) { best = len; longestRunMid[y] = (start + x) / 2 }
            }
        }
        val maxP = profile.maxOrNull() ?: 0
        if (maxP == 0) return emptyList()
        val thr = maxP * 0.25

        // candidate lines = groups of neighboring rows above the threshold
        data class Cand(val y: Double, val strongestRow: Int)
        val cands = ArrayList<Cand>()
        var y = 0
        while (y < h) {
            if (profile[y] < thr) { y++; continue }
            var sum = 0.0
            var wsum = 0.0
            var strongest = y
            while (y < h && profile[y] >= thr) {
                sum += y * profile[y].toDouble(); wsum += profile[y]
                if (profile[y] > profile[strongest]) strongest = y
                y++
            }
            cands += Cand(sum / wsum, strongest)
        }

        // five candidates with (roughly) equal spacing form a staff
        val staves = ArrayList<Staff>()
        var i = 0
        while (i < cands.size) {
            val chosen = arrayListOf(i)
            var cur = i
            while (chosen.size < 5) {
                var bestJ = -1
                var bestErr = Double.MAX_VALUE
                for (j in cur + 1 until cands.size) {
                    val gap = cands[j].y - cands[cur].y
                    if (gap > 1.35 * d) break
                    if (gap < 0.7 * d) continue
                    val err = abs(gap - d)
                    if (err < bestErr) { bestErr = err; bestJ = j }
                }
                if (bestJ < 0) break
                chosen += bestJ
                cur = bestJ
            }
            if (chosen.size == 5) {
                val startX = longestRunMid[cands[chosen[2]].strongestRow]
                val staff = track(bin, chosen.map { cands[it].y }.toDoubleArray(), startX, m)
                if (staff != null) staves += staff
                i = chosen.last() + 1
            } else {
                i++
            }
        }
        return staves
    }

    private fun track(bin: BinaryImage, startYs: DoubleArray, startX: Int, m: StaffMetrics): Staff? {
        val d = m.interline
        val step = max(4, d.roundToInt())
        val n = bin.width / step + 2
        val ys = Array(5) { DoubleArray(n) }
        val r = max(2, (d * 0.3).roundToInt())
        val halfBlock = step / 2

        fun rowCount(x: Int, yy: Int): Int {
            if (yy < 0 || yy >= bin.height) return 0
            var c = 0
            for (xx in max(0, x - halfBlock)..min(bin.width - 1, x + halfBlock)) if (bin.data[yy * bin.width + xx]) c++
            return c
        }

        fun stepTo(j: Int, prev: DoubleArray) {
            val x = j * step
            var bestO = 0
            var bestS = -1
            for (o in -r..r) {
                var s = 0
                for (l in 0 until 5) s += rowCount(x, (prev[l] + o).roundToInt())
                if (s > bestS) { bestS = s; bestO = o }
            }
            val evidence = bestS >= 5 * halfBlock // at least about half of the block is ink
            for (l in 0 until 5) {
                var yl = prev[l] + if (evidence) bestO else 0
                if (evidence) {
                    // small per-line correction (perspective changes the spacing slightly)
                    val c0 = rowCount(x, yl.roundToInt())
                    val cu = rowCount(x, yl.roundToInt() - 1)
                    val cd = rowCount(x, yl.roundToInt() + 1)
                    if (cu > c0 && cu >= cd) yl -= 1 else if (cd > c0) yl += 1
                }
                ys[l][j] = yl
            }
        }

        val j0 = (startX / step).coerceIn(0, n - 1)
        for (l in 0 until 5) ys[l][j0] = startYs[l]
        // refine the start column itself
        stepTo(j0, DoubleArray(5) { startYs[it] })
        for (j in j0 + 1 until n) stepTo(j, DoubleArray(5) { ys[it][j - 1] })
        for (j in j0 - 1 downTo 0) stepTo(j, DoubleArray(5) { ys[it][j + 1] })

        // light smoothing against outliers caused by note heads or beams
        for (l in 0 until 5) {
            val src = ys[l].copyOf()
            for (j in 1 until n - 1) {
                val a = src[j - 1]; val b = src[j]; val c = src[j + 1]
                ys[l][j] = max(min(a, b), min(max(a, b), c))
            }
        }

        val staff = Staff(ys, step)
        // horizontal extent: columns where at least four of the five lines have ink
        val tol = max(1, m.lineThickness / 2 + 1)
        val covered = BooleanArray(bin.width)
        for (x in 0 until bin.width) {
            var c = 0
            for (l in 0 until 5) {
                val yl = staff.lineY(l, x.toDouble()).roundToInt()
                for (dy in -tol..tol) if (bin[x, yl + dy]) { c++; break }
            }
            covered[x] = c >= 4
        }
        var bestStart = -1
        var bestEnd = -1
        var segStart = -1
        var lastCovered = -1
        val maxGap = d.toInt()
        for (x in 0..bin.width) {
            val cov = x < bin.width && covered[x]
            if (cov) {
                if (segStart < 0 || x - lastCovered > maxGap) {
                    if (segStart >= 0 && lastCovered - segStart > bestEnd - bestStart) { bestStart = segStart; bestEnd = lastCovered }
                    segStart = x
                }
                lastCovered = x
            }
        }
        if (segStart >= 0 && lastCovered - segStart > bestEnd - bestStart) { bestStart = segStart; bestEnd = lastCovered }
        if (bestStart < 0 || bestEnd - bestStart < 8 * d) return null
        staff.left = bestStart
        staff.right = bestEnd
        return staff
    }

    /**
     * Removes staff (and ledger) line pixels: thin vertical runs at the line positions.
     * [maxRun] controls how aggressive the removal is.
     */
    fun removeLines(bin: BinaryImage, staves: List<Staff>, maxRun: Int, ledgerLines: Int = 4): BinaryImage {
        val out = bin.copy()
        for (staff in staves) {
            val d = staff.space(((staff.left + staff.right) / 2).toDouble())
            // never thicker than a line plus a little blur and well below a beam's thickness
            // (about half a staff space), so beams lying on a line are kept
            val lineThickness = (maxRun - 1) / 2
            val limit = min(maxRun, max(lineThickness + 2, (0.35 * d).roundToInt()))
            for (x in staff.left..staff.right) {
                val fx = x.toDouble()
                for (l in 0 until 5) eraseThinRun(bin, out, x, staff.lineY(l, fx).roundToInt(), limit)
                // ledger lines are short; a long thin stroke at a ledger position is a beam (on
                // small pictures a beam is no thicker than a line) and must stay
                for (k in 1..ledgerLines) {
                    for (py in doubleArrayOf(staff.top(fx) - k * d, staff.bottom(fx) + k * d)) {
                        val y = py.roundToInt()
                        if (horizontalExtent(bin, x, y, (3 * d).toInt()) <= 3 * d) eraseThinRun(bin, out, x, y, limit)
                    }
                }
            }
            // ledger lines stick out a bit beyond notes at the staff ends as well
        }
        return out
    }

    /** Length of the horizontal ink run through (x, y±1), counted up to [limit] on each side. */
    private fun horizontalExtent(src: BinaryImage, x: Int, y: Int, limit: Int): Int {
        val row = when {
            src[x, y] -> y
            src[x, y - 1] -> y - 1
            src[x, y + 1] -> y + 1
            else -> return 0
        }
        var l = 0
        while (l < limit && src[x - l - 1, row]) l++
        var r = 0
        while (r < limit && src[x + r + 1, row]) r++
        return l + r + 1
    }

    private fun eraseThinRun(src: BinaryImage, out: BinaryImage, x: Int, y: Int, maxRun: Int) {
        var yy = when {
            src[x, y] -> y
            src[x, y - 1] -> y - 1
            src[x, y + 1] -> y + 1
            else -> return
        }
        var top = yy
        while (src[x, top - 1]) top--
        var bottom = yy
        while (src[x, bottom + 1]) bottom++
        if (bottom - top + 1 <= maxRun) {
            yy = top
            while (yy <= bottom) { out[x, yy] = false; yy++ }
        }
    }
}
