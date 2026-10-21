package io.github.carstenkeller.noteplayer.omr

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Rule-based optical music recognition for printed, mostly simple sheet music.
 *
 * Pipeline: binarize -> deskew -> find staves -> remove staff lines -> find note heads,
 * stems, beams/flags, dots, accidentals, rests and barlines -> build a timed score.
 *
 * This is deliberately simple and has clear limits (see README): it does not read
 * time signatures, tuplets, ties, multiple voices per staff, repeats or lyrics.
 */
object Omr {
    private const val SAUVOLA_K = 0.2
    /** Debug aid: "x0,y0,x1,y1" in OMR_DEBUG_REGION prints why holes in that region were rejected. */
    private val DEBUG_REGION = System.getenv("OMR_DEBUG_REGION")?.split(",")?.map { it.trim().toInt() }

    private class Head(val cx: Double, val cy: Double, var box: Box, val hollow: Boolean) {
        var staff = -1
        var comp: Component? = null
        var stemX = 0.0
        var stemTip = 0.0
        var stemDir = 0 // -1 = up, +1 = down, 0 = no stem
        var dotted = false
        var accidental: Int? = null
        var group = -1
    }

    private class Item(
        val x: Double,
        val box: Box,
        val heads: List<Head>,
        var duration: Int,
        val fullMeasureRest: Boolean = false,
    ) {
        var measure = 0
        var pitches: List<Int> = emptyList()
    }

    fun recognize(input: GrayImage, maxSide: Int = 2400): RecognitionResult {
        val warnings = ArrayList<String>()
        var gray = input.downscaled(maxSide)
        // a low k keeps thin, light-gray staff lines and stems of photographed pages
        val bin0 = Binarizer.sauvola(gray, max(31, min(gray.width, gray.height) / 15), k = SAUVOLA_K)
        val m0 = StaffDetector.metrics(bin0)
            ?: return empty(gray, 0.0, 0.0, "Auf dem Bild wurden keine Notenlinien gefunden.")
        val skew = StaffDetector.estimateSkew(bin0, m0.interline, m0.lineThickness)
        if (abs(skew) >= 0.1) gray = gray.rotated(-skew)
        val bin = Binarizer.sauvola(gray, max(31, (m0.interline * 5).toInt()), k = SAUVOLA_K)
        val m = StaffDetector.metrics(bin) ?: m0
        val d = m.interline
        if (d < 7) warnings += "Die Notenlinien sind sehr klein abgebildet – ein näheres Foto verbessert die Erkennung."

        val staves = StaffDetector.detect(bin, m)
        if (staves.isEmpty()) return empty(gray, d, skew, "Auf dem Bild wurden keine Notenlinien gefunden.")

        val systemOf = groupSystems(bin, staves, d)

        val aggressive = StaffDetector.removeLines(bin, staves, maxRun = 2 * m.lineThickness + 1)
        val conservative = StaffDetector.removeLines(bin, staves, maxRun = m.lineThickness + 1)
        val comps = Components.label(aggressive)

        // --- note heads ---------------------------------------------------------------
        val heads = ArrayList<Head>()
        heads += filledHeads(aggressive, d)
        // half/whole heads: notes on a line show their hole once the line is removed, notes in a
        // space can lose their hole when the thin ring merges with the line, so look in both images
        heads += hollowHeads(conservative, aggressive, staves, d)
        heads += hollowHeads(bin, aggressive, staves, d)
        dedupe(heads, d)
        for (h in heads) {
            h.staff = nearestStaff(staves, h.cx, h.cy, d)
            h.comp = compOfHead(comps, aggressive, h, d)
            findStem(aggressive, h, d)
        }
        // notes beyond the staff need ledger lines; lyrics and chord diagrams have none
        heads.removeAll { it.staff < 0 || !ledgersOk(bin, staves[it.staff], it, d, m.lineThickness) }

        // --- per staff: header (clef, key, time signature) -------------------------------
        // staff line removal can cut symbols into pieces; overlapping pieces are merged into glyphs
        val headerGlyphs = mergeGlyphs(comps.list.filter { it.area >= 3 }, d)
        val headerStaff = IntArray(headerGlyphs.size) { nearestStaff(staves, headerGlyphs[it].cx, headerGlyphs[it].cy, d, maxDist = 3.0 * d) }
        val headerUsed = BooleanArray(headerGlyphs.size)
        val clefs = Array(staves.size) { Clef.TREBLE }
        val keys = IntArray(staves.size)
        val headerEnd = DoubleArray(staves.size)
        for ((si, staff) in staves.withIndex()) {
            val own = headerGlyphs.filter { headerStaff[it.id] == si }.sortedBy { it.x0 }
            // half/whole notes and notes with a stem are never part of the clef/key/time signature
            val notes = heads.filter { it.staff == si && (it.hollow || it.stemDir != 0) }.map { it.box }
            // the clef is read from the picture with its staff lines: on small pictures the thin
            // strokes of a clef do not survive the line removal
            val lowerOfPair = si > 0 && systemOf[si - 1] == systemOf[si] && (si + 1 >= staves.size || systemOf[si + 1] != systemOf[si])
            val (clef, clefRight) = classifyClef(bin, staff, d, m.lineThickness, lowerOfPair)
            val header = readHeader(aggressive, staff, own, notes, clefRight, d, headerUsed)
            clefs[si] = clef
            keys[si] = header.second
            headerEnd[si] = header.third
        }
        // all staves of a piece normally share one key signature: a staff where none was found
        // takes the key that most staves show
        val keyVotes = keys.toList().groupingBy { it }.eachCount()
        val (commonKey, votes) = keyVotes.maxBy { it.value }
        if (commonKey != 0 && votes * 2 > keys.size) for (i in keys.indices) if (keys[i] == 0) keys[i] = commonKey
        heads.removeAll { it.cx < headerEnd[it.staff] }
        val consumed = HashSet<Int>()
        for (g in headerGlyphs) if (headerUsed[g.id]) consumed += g.members

        // --- chords -------------------------------------------------------------------
        val groups = groupChords(heads, d)
        val noteComps = groups.flatten().mapNotNull { it.comp?.id }.toHashSet()
        consumed += noteComps

        // everything that is not part of a note or the header: barlines, accidentals, dots, rests
        val glyphs = mergeGlyphs(comps.list.filter { it.area >= 3 && it.id !in consumed }, d)
        val glyphStaff = IntArray(glyphs.size) { nearestStaff(staves, glyphs[it].cx, glyphs[it].cy, d, maxDist = 3.0 * d) }
        val used = BooleanArray(glyphs.size)

        // --- barlines -------------------------------------------------------------------
        val barlines = Array(staves.size) { ArrayList<Double>() }
        for (c in glyphs) {
            if (c.width > 0.6 * d || c.height < 3.4 * d || c.fill < 0.55) continue
            var any = false
            for ((si, s) in staves.withIndex()) {
                if (c.cx < s.left - 0.5 * d || c.cx > s.right + 0.5 * d || c.cx <= headerEnd[si]) continue
                if (c.y0 <= s.top(c.cx) + 0.4 * d && c.y1 >= s.bottom(c.cx) - 0.4 * d) {
                    barlines[si] += c.cx
                    any = true
                }
            }
            if (any) used[c.id] = true
        }
        // barlines that touch a tie or a note are part of a bigger component; find them as thin
        // vertical lines running exactly from the top to the bottom line, not ending at a head
        for ((si, s) in staves.withIndex()) {
            var x = max(s.left, headerEnd[si].roundToInt())
            while (x <= s.right) {
                if (!spansStaff(aggressive, s, x, d)) { x++; continue }
                val start = x
                while (x <= s.right && spansStaff(aggressive, s, x, d)) x++
                val cx = (start + x - 1) / 2.0
                val stem = heads.any { h ->
                    h.staff == si && cx >= h.box.left - 0.4 * d && cx <= h.box.right + 0.4 * d
                }
                if (x - start <= 0.6 * d && !stem) barlines[si] += cx
            }
        }
        for (b in barlines) {
            b.sort()
            val merged = ArrayList<Double>()
            for (x in b) if (merged.isEmpty() || x - merged.last() > 1.2 * d) merged += x
            b.clear(); b += merged
        }

        // --- accidentals and dots -----------------------------------------------------------
        for (h in heads) {
            val acc = glyphs.filter { c ->
                !used[c.id] && glyphStaff[c.id] == h.staff &&
                    c.x1 <= h.box.left + 0.15 * d && c.x1 >= h.box.left - 1.8 * d &&
                    abs(c.cy - h.cy) <= 1.0 * d && accidentalLike(c, d)
            }.maxByOrNull { it.x1 }
            if (acc != null) {
                h.accidental = classifyAccidental(aggressive, acc)
                used[acc.id] = true
            }
        }
        for (h in heads) {
            val dot = glyphs.firstOrNull { c -> !used[c.id] && isDotFor(c, h.box, h.cy, d) }
            if (dot != null) {
                h.dotted = true
                used[dot.id] = true
            }
        }

        // --- items per staff -----------------------------------------------------------------
        val items = Array(staves.size) { ArrayList<Item>() }
        for (g in groups) {
            val si = g.first().staff
            val stemHead = g.filter { it.stemDir != 0 }.maxByOrNull { abs(it.stemTip - it.cy) }
            val hollow = g.any { it.hollow }
            var dur = when {
                hollow && stemHead != null -> 2 * Score.TPQ
                hollow -> 4 * Score.TPQ
                else -> {
                    val edge = if (stemHead!!.stemDir < 0) g.minOf { it.box.top }.toDouble() else g.maxOf { it.box.bottom }.toDouble()
                    when (countBeams(aggressive, stemHead, edge, d)) {
                        0 -> Score.TPQ
                        1 -> Score.TPQ / 2
                        2 -> Score.TPQ / 4
                        else -> Score.TPQ / 8
                    }
                }
            }
            if (g.any { it.dotted }) dur = dur * 3 / 2
            var box = g.first().box
            for (h in g) box = box.union(h.box)
            items[si] += Item(g.minOf { it.box.left }.toDouble(), box, g, dur)
        }
        for ((si, s) in staves.withIndex()) {
            for (c in glyphs) {
                if (used[c.id] || glyphStaff[c.id] != si || c.cx <= headerEnd[si]) continue
                if (c.cx < s.left || c.cx > s.right) continue
                if (heads.any { h -> c.x1 >= h.box.left && c.x0 <= h.box.right && c.y1 >= h.box.top && c.y0 <= h.box.bottom }) continue
                val rest = classifyRest(s, c, d) ?: continue
                used[c.id] = true
                var dur = rest.first
                val restBox = Box(c.x0.toFloat(), c.y0.toFloat(), c.x1.toFloat(), c.y1.toFloat())
                val dot = glyphs.firstOrNull { o -> !used[o.id] && isDotFor(o, restBox, c.cy, d) }
                if (dot != null && !rest.second) { dur = dur * 3 / 2; used[dot.id] = true }
                items[si] += Item(c.x0.toDouble(), restBox, emptyList(), dur, fullMeasureRest = rest.second)
            }
            items[si].sortBy { it.x }
            for (it in items[si]) it.measure = barlines[si].count { b -> b < it.x }
            assignPitches(items[si], staves[si], clefs[si], keys[si])
        }

        // --- timing --------------------------------------------------------------------------
        // Notes printed above each other sound together. Items of all staves of a system are
        // grouped into columns by x; a column starts when the previous column of each of its
        // staves has ended (the latest such time wins, so a missed note only causes a local error).
        fun timing(include: (Int) -> Boolean): Pair<List<MusicEvent>, List<SystemInfo>> {
        val events = ArrayList<MusicEvent>()
        val systems = ArrayList<SystemInfo>()
        var t = 0
        val systemCount = (systemOf.maxOrNull() ?: -1) + 1
        for (sys in 0 until systemCount) {
            val allMembers = staves.indices.filter { systemOf[it] == sys }
            val members = allMembers.filter(include)
            if (members.isEmpty()) continue
            // in photos the staves of a system can be shifted against each other (perspective);
            // barlines run straight through the system, so they map each staff onto the first one
            val ref = members.first()
            val anchors = members.associateWith { si -> alignmentAnchors(staves[si], barlines[si], staves[ref], barlines[ref], d) }
            fun refX(si: Int, x: Double) = mapPiecewise(anchors.getValue(si), x)
            val timed = members.flatMap { si -> items[si].filter { !it.fullMeasureRest }.map { si to it } }
                .sortedBy { refX(it.first, it.second.box.centerX.toDouble()) }
            val columns = ArrayList<MutableList<Pair<Int, Item>>>()
            var colX = Double.NEGATIVE_INFINITY
            for (e in timed) {
                val x = refX(e.first, e.second.box.centerX.toDouble())
                if (columns.isEmpty() || x - colX > 0.8 * d) {
                    columns += ArrayList<Pair<Int, Item>>()
                    colX = x
                }
                columns.last() += e
            }
            val colTime = IntArray(columns.size)
            val lastCol = HashMap<Int, Int>() // staff -> index of its previous column
            for ((c, col) in columns.withIndex()) {
                var time = -1
                for (si in col.map { it.first }.distinct()) {
                    val pc = lastCol[si] ?: continue
                    val shortest = columns[pc].filter { it.first == si }.minOf { it.second.duration }
                    time = max(time, colTime[pc] + shortest)
                }
                if (time < 0) {
                    time = if (c == 0) t else colTime[c - 1] + columns[c - 1].minOf { it.second.duration }
                }
                if (c > 0) time = max(time, colTime[c - 1])
                colTime[c] = time
                for (si in col.map { it.first }.distinct()) lastCol[si] = c
                for ((si, it) in col) {
                    events += MusicEvent(time, it.duration, it.pitches, it.box, si, sys, it.measure)
                }
            }
            // whole-measure rests sit in the middle of their measure: they start with the
            // first column after the preceding barline
            for (si in members) for (it in items[si].filter { r -> r.fullMeasureRest }) {
                val barX = barlines[si].lastOrNull { b -> b < it.x } ?: staves[si].left.toDouble()
                val c = columns.indexOfFirst { col -> refX(col.first().first, col.first().second.box.centerX.toDouble()) > refX(si, barX) }
                val start = when {
                    c >= 0 -> colTime[c]
                    columns.isNotEmpty() -> colTime.last() + columns.last().minOf { e -> e.second.duration }
                    else -> t
                }
                events += MusicEvent(start, it.duration, emptyList(), it.box, si, sys, it.measure)
            }
            var sysBox = staves[allMembers.first()].box()
            for (si in allMembers) sysBox = sysBox.union(staves[si].box())
            // the line ends when every staff has finished its last column (its shortest note there,
            // so that a single note read too long does not hold up the next line)
            val end = if (lastCol.isEmpty()) {
                events.filter { it.systemIndex == sys }.maxOfOrNull { it.endTick } ?: t
            } else {
                lastCol.maxOf { (si, pc) -> colTime[pc] + columns[pc].filter { it.first == si }.minOf { it.second.duration } }
            }
            systems += SystemInfo(sys, sysBox, t, end)
            t = end
        }
        events.sortWith(compareBy<MusicEvent>({ it.startTick }, { it.staffIndex }))
        return events to systems
        }

        // a staff with lyrics below it is a vocal line; it can be left out when other staves
        // of its system carry the accompaniment
        // Only the top staff of a system with three or more staves (voice + piano) can be a vocal
        // line. Leaving out an accompaniment staff by mistake is worse than playing the voice, so
        // the rule is deliberately strict.
        val systemSize = IntArray(staves.size) { si -> staves.indices.count { systemOf[it] == systemOf[si] } }
        val isTop = BooleanArray(staves.size) { si -> si == 0 || systemOf[si - 1] != systemOf[si] }
        val vocal = BooleanArray(staves.size) { si ->
            isTop[si] && systemSize[si] >= 3 && hasLyrics(staves[si], staves[si + 1], headerGlyphs, consumed, d)
        }
        // systems with the same layout: if the voice was recognized in at least one of them, the
        // top staff is the voice in all of them (lines with little text, or only rests)
        if (vocal.any { it }) {
            val sizes = staves.indices.filter { vocal[it] }.map { systemSize[it] }.toSet()
            for (si in staves.indices) if (isTop[si] && systemSize[si] in sizes) vocal[si] = true
        }
        val accompanied = BooleanArray(staves.size) { si -> vocal[si] && staves.indices.any { o -> systemOf[o] == systemOf[si] && !vocal[o] } }
        val (events, systems) = timing { true }.let { Timing.normalizeMeasures(it.first, it.second) }
        val (instrEvents, instrSystems) = if (accompanied.any { it }) {
            timing { !accompanied[it] }.let { Timing.normalizeMeasures(it.first, it.second) }
        } else {
            events to systems
        }

        val staffInfos = staves.mapIndexed { i, s -> StaffInfo(i, systemOf[i], s.box(), clefs[i], keys[i], accompanied[i]) }
        val score = Score(Score.TPQ, events, staffInfos, systems)
        val instrumental = Score(Score.TPQ, instrEvents, staffInfos, instrSystems)
        if (score.noteCount == 0) warnings += "Es wurden Notenlinien, aber keine Noten erkannt."
        return RecognitionResult(gray, score, instrumental, d, skew, warnings)
    }

    /** Pairs (x in this staff, x in the reference staff): staff starts, matching barlines, staff ends. */
    /**
     * Lyrics: at least six letter-sized glyphs on a common baseline in the gap below the staff.
     * Note heads and other parts of notes do not count.
     */
    private fun hasLyrics(s: Staff, next: Staff, glyphs: List<Component>, noteParts: Set<Int>, d: Double): Boolean {
        val letters = glyphs.filter { g ->
            val below = g.cy - s.bottom(g.cx)
            val gap = next.top(g.cx) - s.bottom(g.cx)
            g.cx > s.left && g.cx < s.right && below > 0.8 * d && below < gap - 1.0 * d &&
                g.height >= 0.35 * d && g.height <= 1.6 * d && g.width <= 1.6 * d &&
                g.members.none { it in noteParts }
        }
        if (letters.size < 6) return false
        val bottoms = letters.map { it.y1 }.sorted()
        var best = 0
        var j = 0
        for (i in bottoms.indices) {
            while (bottoms[i] - bottoms[j] > 0.3 * d) j++
            best = max(best, i - j + 1)
        }
        return best >= 6
    }

    /** True if column [x] is inked from the top to the bottom line of the staff (1 px gaps allowed). */
    private fun spansStaff(img: BinaryImage, s: Staff, x: Int, d: Double): Boolean {
        val fx = x.toDouble()
        val top = (s.top(fx) + 0.15 * d).roundToInt()
        val bottom = (s.bottom(fx) - 0.15 * d).roundToInt()
        var gap = 0
        for (y in top..bottom) {
            if (img[x, y]) gap = 0 else if (++gap > 1) return false
        }
        return true
    }

    private fun alignmentAnchors(s: Staff, bars: List<Double>, r: Staff, refBars: List<Double>, d: Double): List<Pair<Double, Double>> {
        val out = arrayListOf(s.left.toDouble() to r.left.toDouble())
        for (b in bars) {
            val shiftSoFar = out.last().second - out.last().first
            val match = refBars.minByOrNull { abs(it - (b + shiftSoFar)) } ?: continue
            if (abs(match - (b + shiftSoFar)) <= 2 * d && match > out.last().second && b > out.last().first) out += b to match
        }
        if (s.right > out.last().first && r.right > out.last().second) out += s.right.toDouble() to r.right.toDouble()
        return out
    }

    private fun mapPiecewise(anchors: List<Pair<Double, Double>>, x: Double): Double {
        if (anchors.size == 1) return x - anchors[0].first + anchors[0].second
        var i = anchors.indexOfFirst { it.first >= x }
        i = when {
            i <= 0 -> 1
            else -> i
        }
        val (a, b) = anchors[i - 1] to anchors[i]
        if (b.first == a.first) return x - a.first + a.second
        return a.second + (x - a.first) * (b.second - a.second) / (b.first - a.first)
    }

    private fun empty(gray: GrayImage, d: Double, skew: Double, msg: String) =
        Score(Score.TPQ, emptyList(), emptyList(), emptyList()).let { RecognitionResult(gray, it, it, d, skew, listOf(msg)) }

    // ------------------------------------------------------------------------------------

    /** Staves connected by a vertical line at their left end belong to one system (e.g. piano). */
    private fun groupSystems(bin: BinaryImage, staves: List<Staff>, d: Double): IntArray {
        val sys = IntArray(staves.size)
        var cur = 0
        for (i in staves.indices) {
            if (i > 0) {
                val a = staves[i - 1]
                val b = staves[i]
                if (!connected(bin, a, b, d)) cur++
            }
            sys[i] = cur
        }
        return sys
    }

    private fun connected(bin: BinaryImage, a: Staff, b: Staff, d: Double): Boolean {
        val x0 = min(a.left, b.left)
        if (abs(a.left - b.left) > 2 * d) return false
        for (x in (x0 - d.toInt())..(x0 + d.toInt())) {
            val fx = x.toDouble()
            val yTop = a.bottom(fx).roundToInt() + 1
            val yBottom = b.top(fx).roundToInt() - 1
            if (yBottom <= yTop || yBottom - yTop > 14 * d) return false
            // follow the (possibly slightly slanted) line downwards
            var cx = x
            var black = 0
            for (y in yTop..yBottom) {
                val nx = (-2..2).map { cx + it }.filter { bin[it, y] }.minByOrNull { abs(it - cx) }
                if (nx != null) { black++; cx = nx }
            }
            if (black >= 0.9 * (yBottom - yTop + 1) && abs(cx - x) <= d) return true
        }
        return false
    }

    private fun nearestStaff(staves: List<Staff>, x: Double, y: Double, d: Double, maxDist: Double = 5.0 * d): Int {
        var best = -1
        var bestDist = Double.MAX_VALUE
        for ((i, s) in staves.withIndex()) {
            if (x < s.left - d || x > s.right + d) continue
            val dist = s.distance(x, y)
            if (dist < bestDist) { bestDist = dist; best = i }
        }
        return if (bestDist <= maxDist) best else -1
    }

    private fun filledHeads(img: BinaryImage, d: Double): List<Head> {
        val r = max(1, (0.22 * d).roundToInt())
        val comps = Components.label(img.eroded(r))
        val out = ArrayList<Head>()
        for (c in comps.list) {
            if (c.width < 0.3 * d || c.height < 0.2 * d) continue
            // what is left of a head is roughly elliptic; beams leave long thin strips
            if (c.height < 0.3 * d || c.width > 3.2 * c.height) continue
            val w = c.width + 2 * r
            val h = c.height + 2 * r
            if (w < 0.8 * d || w > 2.1 * d || h < 0.6 * d || h > 6 * d) continue
            if (partOfBeam(img, c, r, d)) continue
            val x0 = (c.x0 - r).toFloat()
            val x1 = (c.x1 + r).toFloat()
            val y0 = c.y0 - r
            val n = if (h > 1.5 * d) max(1, (h / (0.95 * d)).roundToInt()) else 1
            for (k in 0 until n) {
                val top = y0 + k * h.toDouble() / n
                val bottom = y0 + (k + 1) * h.toDouble() / n
                out += Head((x0 + x1) / 2.0, (top + bottom) / 2, Box(x0, top.toFloat(), x1, bottom.toFloat()), hollow = false)
            }
        }
        return out
    }

    /**
     * A thick piece of a beam (or of two beams merged by blur) survives the erosion like a note
     * head. Unlike a head, the ink continues sideways: on both sides, or far on one side.
     */
    private fun partOfBeam(img: BinaryImage, core: Component, r: Int, d: Double): Boolean {
        var left = 0
        var right = 0
        val limit = (r + 2.5 * d).toInt()
        for (y in core.y0..core.y1) {
            var l = 0
            while (l < limit && img[core.x0 - 1 - l, y]) l++
            var rr = 0
            while (rr < limit && img[core.x1 + 1 + rr, y]) rr++
            left = max(left, l)
            right = max(right, rr)
        }
        val side = r + 0.6 * d
        val far = r + 1.8 * d
        return (left >= side && right >= side) || left >= far || right >= far
    }

    /** Finds half/whole heads by the hole enclosed by their ring in [cons]. */
    private fun hollowHeads(cons: BinaryImage, agg: BinaryImage, staves: List<Staff>, d: Double): List<Head> {
        val w = cons.width
        val visited = BooleanArray(w * cons.height)
        val out = ArrayList<Head>()
        var stack = IntArray(1024)
        val maxHole = 1.5 * d
        val maxPixels = (4 * d * d).toInt()
        val pixels = IntArray(maxPixels)
        for (s in staves) {
            val bx0 = max(0, s.left)
            val bx1 = min(w - 1, s.right)
            val by0 = max(0, (s.minTop() - 5 * d).toInt())
            val by1 = min(cons.height - 1, (s.maxBottom() + 5 * d).toInt())
            for (y in by0..by1) for (x in bx0..bx1) {
                val p = y * w + x
                if (cons.data[p] || visited[p]) continue
                var sp = 0
                stack[sp++] = p
                visited[p] = true
                var hx0 = x; var hx1 = x; var hy0 = y; var hy1 = y
                var area = 0
                var open = false
                while (sp > 0) {
                    val q = stack[--sp]
                    val qx = q % w
                    val qy = q / w
                    if (area < maxPixels) pixels[area] = q
                    area++
                    if (qx < hx0) hx0 = qx
                    if (qx > hx1) hx1 = qx
                    if (qy < hy0) hy0 = qy
                    if (qy > hy1) hy1 = qy
                    if (qx <= bx0 || qx >= bx1 || qy <= by0 || qy >= by1) open = true
                    val nb = intArrayOf(q - 1, q + 1, q - w, q + w)
                    val nx = intArrayOf(qx - 1, qx + 1, qx, qx)
                    val ny = intArrayOf(qy, qy, qy - 1, qy + 1)
                    for (k in 0 until 4) {
                        if (nx[k] < bx0 || nx[k] > bx1 || ny[k] < by0 || ny[k] > by1) continue
                        val nq = nb[k]
                        if (cons.data[nq] || visited[nq]) continue
                        visited[nq] = true
                        if (sp == stack.size) stack = stack.copyOf(stack.size * 2)
                        stack[sp++] = nq
                    }
                }
                if (open) continue
                val hw = hx1 - hx0 + 1
                val hh = hy1 - hy0 + 1
                val dbg = DEBUG_REGION?.let { r -> hx0 >= r[0] && hx1 <= r[2] && hy0 >= r[1] && hy1 <= r[3] } == true
                fun reject(why: String): Boolean {
                    if (dbg) println("DBG hole $hx0..$hx1 x $hy0..$hy1 rejected: $why")
                    return true
                }
                if (hw > maxHole || hh > maxHole) continue
                if ((hw < 0.2 * d || hw > 1.3 * d || hh < 0.15 * d || hh > 0.95 * d) && reject("size ${hw / d} ${hh / d}")) continue
                // note head holes are elliptic; rectangular holes are gaps between stems and lines
                // (a hole of only a few pixels is square at this resolution)
                val maxFill = if (hh <= 7 && hw <= 9) 1.0 else 0.88
                if ((area < 0.35 * hw * hh || area > maxFill * hw * hh || area > maxPixels) && reject("fill")) continue
                // on low-resolution pictures a note hole is only a few pixels high and every
                // edge looks straight; there the check would remove real notes
                if (hh > 7 && straightSide(pixels, area, w, hy0, hh) && reject("straight")) continue
                val cx = (hx0 + hx1) / 2
                val cy = (hy0 + hy1) / 2
                val limit = (0.7 * d).roundToInt()
                val left = edge(cons, cx, cy, -1, 0, limit)
                val right = edge(cons, cx, cy, 1, 0, limit)
                val top = edge(cons, cx, cy, 0, -1, limit)
                val bottom = edge(cons, cx, cy, 0, 1, limit)
                if ((left == null || right == null || top == null || bottom == null) && reject("ring $left $right $top $bottom")) continue
                left!!; right!!; top!!; bottom!!
                val ow = right - left + 1
                val oh = bottom - top + 1
                if ((ow < 1.0 * d || ow > 2.4 * d || oh < 0.6 * d || oh > 1.5 * d) && reject("outer ${ow / d} ${oh / d}")) continue
                // sharps and naturals also enclose small holes: they have long vertical strokes on
                // both sides; a note has at most one (its stem, which in a chord passes the other heads)
                val leftRun = verticalExtent(agg, left + 1, cy, d)
                val rightRun = verticalExtent(agg, right - 1, cy, d)
                val longLeft = leftRun.second - leftRun.first > 1.8 * d
                val longRight = rightRun.second - rightRun.first > 1.8 * d
                if (longLeft && longRight && reject("accidental")) continue
                // walls right next to the hole: a gap between a stem and a barline (bounded by two
                // staff lines) has long straight walls on both sides, a note head has short ones
                // (stacked chord heads also have long walls, but their holes are narrower)
                val wallLeft = verticalExtent(agg, hx0 - 1, cy, d)
                val wallRight = verticalExtent(agg, hx1 + 1, cy, d)
                if (hw >= 0.8 * d && wallLeft.second - wallLeft.first > 1.5 * d &&
                    wallRight.second - wallRight.first > 1.5 * d && reject("between strokes")
                ) continue
                if (dbg) println("DBG hole $hx0..$hx1 x $hy0..$hy1 accepted")
                val box = Box(left.toFloat(), top.toFloat(), right.toFloat(), bottom.toFloat())
                out += Head(box.centerX.toDouble(), box.centerY.toDouble(), box, hollow = true)
            }
        }
        return out
    }

    /**
     * True if the hole is bounded on the left or right by a straight vertical stroke: then it is
     * a gap between a stem or barline and something else, not the inside of a note head.
     */
    private fun straightSide(pixels: IntArray, n: Int, w: Int, y0: Int, rows: Int): Boolean {
        val minX = IntArray(rows) { Int.MAX_VALUE }
        val maxX = IntArray(rows) { Int.MIN_VALUE }
        for (i in 0 until n) {
            val r = pixels[i] / w - y0
            val x = pixels[i] % w
            if (x < minX[r]) minX[r] = x
            if (x > maxX[r]) maxX[r] = x
        }
        fun straight(xs: IntArray): Boolean {
            val counts = xs.asList().groupingBy { it }.eachCount()
            val best = counts.values.maxOrNull() ?: 0
            return rows >= 4 && best >= 0.75 * rows
        }
        return straight(minX) || straight(maxX)
    }

    /** From inside a hole, crosses the ink ring in direction (dx, dy); returns the last ink pixel. */
    private fun edge(img: BinaryImage, x0: Int, y0: Int, dx: Int, dy: Int, limit: Int): Int? {
        var x = x0
        var y = y0
        var steps = 0
        while (!img[x, y]) {
            x += dx; y += dy
            if (++steps > limit * 2) return null
        }
        var ink = 0
        while (img[x, y]) {
            x += dx; y += dy
            if (++ink > limit) return null
        }
        return if (dx != 0) x - dx else y - dy
    }

    /** Top and bottom of the ink run through (x, y), tolerating tiny gaps. */
    private fun verticalExtent(img: BinaryImage, x: Int, y: Int, d: Double): Pair<Int, Int> {
        var start = -1
        for (dy in 0..2) {
            if (img[x, y + dy]) { start = y + dy; break }
            if (img[x, y - dy]) { start = y - dy; break }
        }
        if (start < 0) return y to y
        return follow(img, x, start, -1) to follow(img, x, start, 1)
    }

    private fun follow(img: BinaryImage, x: Int, y: Int, dir: Int, gap: Int = 2): Int {
        var yy = y
        while (true) {
            var next = -1
            for (g in 1..gap + 1) if (img[x, yy + dir * g]) { next = yy + dir * g; break }
            if (next < 0) return yy
            yy = next
        }
    }

    private fun ledgersOk(bin: BinaryImage, s: Staff, h: Head, d: Double, t: Int): Boolean {
        val step = s.stepAt(h.cx, h.cy)
        val ledgers = when {
            step >= 10 -> (10..step step 2).toList()
            step <= -2 -> (-2 downTo step step 2).toList()
            else -> return true
        }
        val tol = t + 1
        val out = max(1, (0.12 * d).roundToInt())
        // every ledger line between staff and note must be there and stick out on both sides of the head
        return ledgers.all { k ->
            val y = (s.bottom(h.cx) - k * s.space(h.cx) / 2).roundToInt()
            fun inkNear(x: Int) = (-tol..tol).any { bin[x, y + it] }
            inkNear(h.box.left.roundToInt() - out) && inkNear(h.box.right.roundToInt() + out)
        }
    }

    private fun dedupe(heads: MutableList<Head>, d: Double) {
        // hollow heads win over filled candidates at the same place
        heads.sortBy { if (it.hollow) 0 else 1 } // stable: earlier hollow detections win
        val kept = ArrayList<Head>()
        for (h in heads) {
            // a ledger line through a whole/half note can split its hole into two halves
            val half = kept.indexOfFirst {
                it.hollow && h.hollow && abs(it.cx - h.cx) < 0.4 * d && abs(it.cy - h.cy) < 0.75 * d &&
                    it.box.bottom - it.box.top < 0.8 * d && h.box.bottom - h.box.top < 0.8 * d
            }
            if (half >= 0) {
                val box = kept[half].box.union(h.box)
                kept[half] = Head(box.centerX.toDouble(), box.centerY.toDouble(), box, hollow = true)
                continue
            }
            val duplicate = kept.any {
                (abs(it.cx - h.cx) < 0.6 * d && abs(it.cy - h.cy) < 0.5 * d) ||
                    (h.cx.toFloat() in it.box.left..it.box.right && h.cy.toFloat() in it.box.top..it.box.bottom) ||
                    overlapRatio(it.box, h.box) > (if (it.hollow != h.hollow) 0.3 else 0.4)
            }
            if (!duplicate) kept += h
        }
        heads.clear()
        heads += kept
    }

    /** Intersection area relative to the smaller box. */
    private fun overlapRatio(a: Box, b: Box): Double {
        val w = min(a.right, b.right) - max(a.left, b.left)
        val h = min(a.bottom, b.bottom) - max(a.top, b.top)
        if (w <= 0 || h <= 0) return 0.0
        val smaller = min((a.right - a.left) * (a.bottom - a.top), (b.right - b.left) * (b.bottom - b.top))
        return if (smaller <= 0) 0.0 else (w * h / smaller).toDouble()
    }

    private fun compOfHead(comps: Components, img: BinaryImage, h: Head, d: Double): Component? {
        val y = h.cy.roundToInt()
        val reach = d.roundToInt()
        for (dx in 0..reach) {
            for (x in intArrayOf(h.cx.roundToInt() - dx, h.cx.roundToInt() + dx)) {
                if (img[x, y]) return comps.at(x, y)
            }
        }
        return null
    }

    private fun findStem(img: BinaryImage, h: Head, d: Double) {
        var bestLen = 0.0
        val slack = (0.3 * d).roundToInt()
        fun tryColumn(x: Int, dir: Int) {
            // start at the ink closest to the head center in this column
            var start = -1
            for (k in 0..slack) {
                if (img[x, h.cy.roundToInt() + k * -dir]) { start = h.cy.roundToInt() + k * -dir; break }
                if (img[x, h.cy.roundToInt() + k * dir]) { start = h.cy.roundToInt() + k * dir; break }
            }
            if (start < 0) return
            val tip = follow(img, x, start, dir)
            val len = abs(tip - h.cy)
            if (len <= bestLen || len < 2.0 * d) return
            // a stem is thin
            val mid = ((h.cy + tip) / 2).roundToInt()
            var l = x
            while (img[l - 1, mid]) l--
            var r = x
            while (img[r + 1, mid]) r++
            if (r - l + 1 > 0.45 * d) return
            bestLen = len
            h.stemX = (l + r) / 2.0
            h.stemTip = tip.toDouble()
            h.stemDir = dir
        }
        val right = h.box.right
        val left = h.box.left
        for (x in (right - 0.45 * d).roundToInt()..(right + 0.25 * d).roundToInt()) tryColumn(x, -1)
        for (x in (left - 0.25 * d).roundToInt()..(left + 0.45 * d).roundToInt()) tryColumn(x, 1)
    }

    private fun balanced(img: BinaryImage, c: Component): Boolean {
        val mid = (c.y0 + c.y1) / 2
        var upper = 0
        var lower = 0
        for (y in c.y0..c.y1) for (x in c.x0..c.x1) if (img[x, y]) { if (y < mid) upper++ else lower++ }
        return upper > 0 && lower > 0 && upper.toDouble() / lower in 0.5..2.0
    }

    /** Merges components that overlap horizontally (at least half of the narrower one) and nearly touch vertically. */
    private fun mergeGlyphs(parts: List<Component>, d: Double): List<Component> {
        val sorted = parts.sortedBy { it.x0 }
        val parent = IntArray(sorted.size) { it }
        fun find(i: Int): Int {
            var x = i
            while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x] }
            return x
        }
        val gap = 0.35 * d
        // big things (page borders, long lines, braces) stay on their own
        fun mergeable(c: Component) = c.width <= 3 * d && c.height <= 8 * d
        for (i in sorted.indices) {
            val a = sorted[i]
            if (!mergeable(a)) continue
            for (j in i + 1 until sorted.size) {
                val b = sorted[j]
                if (b.x0 > a.x1 + 0.25 * d) break
                if (!mergeable(b)) continue
                val overlap = min(a.x1, b.x1) - max(a.x0, b.x0) + 1
                val vGap = max(a.y0, b.y0) - min(a.y1, b.y1) - 1
                val stacked = overlap >= 0.5 * min(a.width, b.width) && vGap <= gap
                // thin side by side pieces, e.g. the two strokes of a sharp whose bars were removed
                val vOverlap = -vGap - 1
                val sideBySide = min(a.width, b.width) < 0.45 * d && overlap > -0.25 * d &&
                    vOverlap >= 0.6 * min(a.height, b.height)
                if (stacked || sideBySide) parent[find(i)] = find(j)
            }
        }
        val byRoot = LinkedHashMap<Int, Component>()
        for (i in sorted.indices) {
            val root = find(i)
            val g = byRoot.getOrPut(root) { Component(byRoot.size) }
            g.absorb(sorted[i])
        }
        return byRoot.values.toList()
    }

    private fun accidentalLike(c: Component, d: Double) =
        c.height >= 1.4 * d && c.height <= 3.4 * d && c.width >= 0.35 * d && c.width <= 1.15 * d

    /** +1 sharp, -1 flat, 0 natural. */
    private fun classifyAccidental(img: BinaryImage, c: Component): Int {
        val mid = (c.y0 + c.y1) / 2
        var upper = 0
        var lower = 0
        for (y in c.y0..c.y1) for (x in c.x0..c.x1) if (img[x, y]) { if (y < mid) upper++ else lower++ }
        if (lower > 1.6 * upper) return -1
        val band = max(1, c.height / 5)
        fun meanX(y0: Int, y1: Int): Double {
            var s = 0.0
            var n = 0
            for (y in y0..y1) for (x in c.x0..c.x1) if (img[x, y]) { s += (x - c.x0).toDouble() / max(1, c.width - 1); n++ }
            return if (n == 0) 0.5 else s / n
        }
        val top = meanX(c.y0, c.y0 + band)
        val bottom = meanX(c.y1 - band, c.y1)
        return if (top < 0.42 && bottom > 0.58) 0 else 1
    }

    private fun isDotFor(c: Component, box: Box, cy: Double, d: Double): Boolean {
        val big = max(c.width, c.height)
        val small = min(c.width, c.height)
        if (big > 0.6 * d || small < 0.12 * d || c.fill < 0.45) return false
        if (c.x0 < box.right + 0.05 * d || c.x0 > box.right + 1.4 * d) return false
        return c.cy >= cy - 0.75 * d && c.cy <= cy + 0.4 * d
    }

    /** Returns clef, key (fifths) and the x coordinate where the music starts. */
    /**
     * Treble clefs reach well above and below the staff, an alto (C) clef has a heavy bar across
     * the whole staff, a bass clef stays inside. Without a recognizable clef the lower staff of a
     * piano system is taken as bass, any other as treble.
     */
    private fun classifyClef(bin: BinaryImage, s: Staff, d: Double, t: Int, lowerOfPair: Boolean): Pair<Clef, Int?> {
        var right: Int? = null
        fun result(c: Clef) = c to right
        // locate the clef: the first wide inked area after the staff start (barlines and the
        // brace are narrow or lie before it)
        val scanEnd = (s.left + 4 * d).roundToInt()
        val colInk = IntArray(scanEnd - s.left + 1) { i ->
            val x = s.left + i
            val tx = s.top(x.toDouble())
            val bx = s.bottom(x.toDouble())
            var n = 0
            var rows = 0
            for (y in tx.roundToInt()..bx.roundToInt()) {
                if ((0 until 5).any { abs(y - s.lineY(it, x.toDouble())) <= t }) continue
                rows++
                if (bin[x, y]) n++
            }
            // barlines and brackets fill the whole staff height: not part of the clef
            if (n >= 0.85 * rows) 0 else n
        }
        val minInk = max(2.0, 0.25 * d)
        var x0 = -1
        var x1 = -1
        var i = 0
        while (i < colInk.size) {
            if (colInk[i] < minInk) { i++; continue }
            val start = i
            while (i < colInk.size && colInk[i] > 0) i++
            if (i - start >= 0.4 * d) { x0 = s.left + start; x1 = s.left + minOf(i - 1, start + (3 * d).toInt()); break }
        }
        val fallbackClef = if (lowerOfPair) Clef.BASS else Clef.TREBLE
        if (x0 < 0) return result(fallbackClef)
        right = x1
        val mid = (x0 + x1) / 2.0
        val top = s.top(mid)
        val bottom = s.bottom(mid)
        fun ink(ya: Double, yb: Double, skipLines: Boolean = false): Int {
            var n = 0
            for (y in ya.roundToInt()..yb.roundToInt()) {
                if (skipLines && (0 until 5).any { abs(y - s.lineY(it, mid)) <= t }) continue
                for (x in x0..x1) if (bin[x, y]) n++
            }
            return n
        }
        val area = d * d
        val inside = ink(top, bottom, skipLines = true)
        if (inside < 0.3 * area) return result(fallbackClef)
        val above = ink(top - 1.8 * d, top - 0.4 * d)
        val below = ink(bottom + 0.4 * d, bottom + 1.8 * d)
        // only the treble clef reaches below the bottom line (its tail); fonts differ above
        if (below >= 0.06 * area || (above >= 0.15 * area && below >= 0.02 * area)) return result(Clef.TREBLE)
        // a heavy vertical bar over the whole staff height: C clef
        val thick = max(2, (0.3 * d).roundToInt())
        for (x in x0..x1) {
            var run = 0
            var best = 0
            for (y in (top - 0.3 * d).roundToInt()..(bottom + 0.3 * d).roundToInt()) {
                run = if ((0 until thick).all { bin[x + it, y] }) run + 1 else 0
                best = max(best, run)
            }
            if (best >= 3.7 * d && best <= 4.8 * d) return result(Clef.ALTO)
        }
        return result(Clef.BASS)
    }

    private fun readHeader(img: BinaryImage, staff: Staff, own: List<Component>, notes: List<Box>, clefRight: Int?, d: Double, used: BooleanArray): Triple<Clef, Int, Double> {
        fun holdsNote(c: Component) = notes.any { it.centerX >= c.x0 && it.centerX <= c.x1 && it.centerY >= c.y0 && it.centerY <= c.y1 }
        val left = staff.left
        var cursor = left + 0.5 * d
        var clef = Clef.TREBLE
        // the clef: glyphs starting right after the staff start. Removing the staff lines can cut
        // a clef into pieces, so all pieces in that area are taken together.
        // pieces must reach into the staff: measure numbers or text above the staff do not count
        val staffTop = staff.top(left.toDouble())
        val staffBottom = staff.bottom(left.toDouble())
        fun clefPiece(c: Component) = c.height <= 9 * d && !(c.width < 0.5 * d && c.height > 4.5 * d) &&
            max(c.width, c.height) >= 0.5 * d && c.y1 > staffTop && c.y0 < staffBottom
        val clefParts = own.filter { it.x1 > left + 0.6 * d && it.x0 < left + 2.2 * d && clefPiece(it) }.toMutableList()
        if (clefParts.isNotEmpty()) {
            var ux0: Int
            var ux1: Int
            do {
                ux0 = clefParts.minOf { it.x0 }
                ux1 = clefParts.maxOf { it.x1 }
                val more = own.filter { c -> c !in clefParts && clefPiece(c) && c.x0 < ux1 + 0.2 * d && c.x1 > ux0 - 0.2 * d }
                clefParts += more
            } while (more.isNotEmpty() && clefParts.maxOf { it.x1 } - clefParts.minOf { it.x0 } <= 3.5 * d)
            ux0 = clefParts.minOf { it.x0 }
            ux1 = clefParts.maxOf { it.x1 }
            val uy0 = clefParts.minOf { it.y0 }
            val uy1 = clefParts.maxOf { it.y1 }
            if (uy1 - uy0 >= 2.0 * d && ux1 - ux0 <= 3.5 * d) {
                val cx = (ux0 + ux1) / 2.0
                val top = staff.top(cx)
                val bottom = staff.bottom(cx)
                clef = when {
                    uy0 < top - 0.7 * d || uy1 > bottom + 0.5 * d -> Clef.TREBLE
                    uy1 < bottom - 0.6 * d -> Clef.BASS
                    else -> Clef.ALTO
                }
                cursor = ux1.toDouble()
                for (c in clefParts) used[c.id] = true
                // the two dots of a bass clef
                for (c in own) {
                    if (c.x0 > cursor && c.x0 < cursor + 0.8 * d && max(c.width, c.height) < 0.65 * d) {
                        cursor = max(cursor, c.x1.toDouble()); used[c.id] = true
                    }
                }
            }
        }

        // pieces of the clef that the glyph merging missed
        if (clefRight != null && clefRight > cursor && clefRight < left + 4 * d) {
            for (c in own) if (c.x1 <= clefRight + 1 && c.x0 >= left - 1 && !holdsNote(c)) used[c.id] = true
            cursor = max(cursor, clefRight.toDouble())
            for (c in own) {
                if (c.x0 > cursor && c.x0 < cursor + 0.8 * d && max(c.width, c.height) < 0.65 * d) {
                    cursor = max(cursor, c.x1.toDouble()); used[c.id] = true
                }
            }
        }
        var sharps = 0
        var flats = 0
        for (c in own.filter { it.x0 >= cursor - 1 }) {
            if (c.x0 >= cursor + 2.2 * d) break
            if (max(c.width, c.height) < 0.6 * d) { cursor = max(cursor, c.x1.toDouble()); continue } // specks, clef dots
            if (!accidentalLike(c, d) || holdsNote(c)) break
            if (classifyAccidental(img, c) < 0) flats++ else sharps++
            cursor = c.x1.toDouble()
            used[c.id] = true
        }
        val count = min(7, sharps + flats)
        val key = if (flats > sharps) -count else count

        // time signature: stacked digits (or a single "C")
        val mid = staff.lineY(2, cursor)
        val digits = own.filter {
            !holdsNote(it) && it.x0 >= cursor - 1 && it.x0 < cursor + 2.0 * d &&
                it.height >= 1.3 * d && it.height <= 2.7 * d && it.width >= 0.6 * d && it.width <= 2.2 * d
        }
        val hasUpper = digits.any { it.cy < mid }
        val hasLower = digits.any { it.cy > mid }
        val common = digits.size == 1 && digits[0].width >= 1.1 * d && digits[0].height >= 1.7 * d && abs(digits[0].cy - mid) < 0.5 * d
        if ((hasUpper && hasLower) || common) {
            for (c in digits) { cursor = max(cursor, c.x1.toDouble()); used[c.id] = true }
        } else {
            // both digits merged into one glyph
            val stacked = own.firstOrNull {
                !holdsNote(it) && it.x0 >= cursor - 1 && it.x0 < cursor + 2.0 * d && it.height >= 3.2 * d && it.height <= 4.8 * d &&
                    it.width >= 0.8 * d && it.width <= 2.4 * d && abs(it.cy - mid) < 0.6 * d &&
                    balanced(img, it) // a note with its stem has nearly all ink in one half
            }
            if (stacked != null) {
                cursor = max(cursor, stacked.x1.toDouble()); used[stacked.id] = true
            } else {
                // digits broken into pieces: pieces stacked at the same x that together span the staff
                // the digits stay within the staff (notes, e.g. chords at the start of a line, do not)
                val top0 = staff.top(cursor)
                val bottom0 = staff.bottom(cursor)
                val pieces = own.filter {
                    !holdsNote(it) && it.x0 >= cursor - 1 && it.x0 < cursor + 2.0 * d && it.height <= 2.7 * d &&
                        max(it.width, it.height) >= 0.4 * d && it.y0 >= top0 - 0.4 * d && it.y1 <= bottom0 + 0.4 * d
                }
                val first = pieces.minByOrNull { it.x0 }
                if (first != null) {
                    val column = pieces.filter { it.x0 < first.x1 + 0.2 * d && it.x1 > first.x0 - 0.2 * d }
                    val ux0 = column.minOf { it.x0 }
                    val ux1 = column.maxOf { it.x1 }
                    val top = staff.top(first.cx)
                    val bottom = staff.bottom(first.cx)
                    val spans = column.minOf { it.y0 } <= top + 0.5 * d && column.maxOf { it.y1 } >= bottom - 0.5 * d
                    if (spans && column.any { it.cy < mid } && column.any { it.cy > mid } && ux1 - ux0 in (0.7 * d).toInt()..(2.4 * d).toInt()) {
                        cursor = max(cursor, ux1.toDouble())
                        for (c in column) used[c.id] = true
                    }
                }
            }
        }
        // a line always starts with a clef; nothing within its usual width is a note or rest
        return Triple(clef, key, max(cursor + 0.1 * d, left + 3.0 * d))
    }

    private fun groupChords(heads: List<Head>, d: Double): List<List<Head>> {
        val parent = IntArray(heads.size) { it }
        fun find(i: Int): Int {
            var x = i
            while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x] }
            return x
        }
        fun union(a: Int, b: Int) { parent[find(a)] = find(b) }
        for (i in heads.indices) for (j in i + 1 until heads.size) {
            val a = heads[i]
            val b = heads[j]
            if (a.staff != b.staff) continue
            val dx = abs(a.cx - b.cx)
            val dy = abs(a.cy - b.cy)
            val same = when {
                a.stemDir != 0 && b.stemDir != 0 ->
                    a.stemDir == b.stemDir && abs(a.stemX - b.stemX) <= 0.5 * d && dy <= 4 * d
                else -> (dx <= 0.6 * d && dy <= 4 * d) || (dx <= 1.5 * d && dy <= 1.2 * d)
            }
            if (same) union(i, j)
        }
        val byRoot = LinkedHashMap<Int, ArrayList<Head>>()
        for (i in heads.indices) byRoot.getOrPut(find(i)) { ArrayList() } += heads[i]
        // filled heads need a stem; stemless filled blobs are usually not notes
        return byRoot.values.filter { g -> g.any { it.hollow } || g.any { it.stemDir != 0 } }
    }

    private fun countBeams(img: BinaryImage, h: Head, headEdge: Double, d: Double): Int {
        val tip = h.stemTip
        val (ya, yb) = if (h.stemDir < 0) {
            (tip - 0.2 * d) to min(tip + 2.8 * d, headEdge - 0.3 * d)
        } else {
            max(tip - 2.8 * d, headEdge + 0.3 * d) to (tip + 0.2 * d)
        }
        if (yb <= ya) return 0
        var best = 0
        for (side in intArrayOf(-1, 1)) {
            // a curved flag can cross a column twice, so a side counts the fewest beams any column sees
            var sideCount = Int.MAX_VALUE
            for (off in doubleArrayOf(0.45, 0.75, 1.0)) {
            val x = (h.stemX + side * off * d).roundToInt()
            var count = 0
            var y = ya.roundToInt()
            while (y <= yb.roundToInt()) {
                if (!img[x, y]) { y++; continue }
                val start = y
                while (y <= yb.roundToInt() + d.toInt() && img[x, y]) y++
                val len = y - start
                if (len >= 0.22 * d && len <= 1.6 * d && attachedToStem(img, h.stemX, x, start, y - 1)) {
                    count += max(1, (len / (0.68 * d)).roundToInt())
                }
            }
            if (count > 0) sideCount = min(sideCount, count)
            }
            if (sideCount != Int.MAX_VALUE) best = max(best, sideCount)
        }
        if (DEBUG_REGION?.let { h.cx >= it[0] && h.cx <= it[2] && h.cy >= it[1] && h.cy <= it[3] } == true) {
            println("DBG beams head=(${h.cx.toInt()},${h.cy.toInt()}) stemX=${h.stemX} tip=${h.stemTip} dir=${h.stemDir} ya=$ya yb=$yb -> $best")
        }
        return min(best, 3)
    }

    /** True if some row of the run y0..y1 at column x is connected to the stem by a solid horizontal stroke. */
    private fun attachedToStem(img: BinaryImage, stemX: Double, x: Int, y0: Int, y1: Int): Boolean {
        val sx = stemX.roundToInt()
        val from = min(sx, x)
        val to = max(sx, x)
        for (y in y0..y1) {
            var solid = true
            for (xx in from..to) if (!img[xx, y]) { solid = false; break }
            if (solid) return true
        }
        return false
    }

    /** Duration and whether it is a whole-measure rest. */
    private fun classifyRest(s: Staff, c: Component, d: Double): Pair<Int, Boolean>? {
        val top = s.top(c.cx)
        val bottom = s.bottom(c.cx)
        if (c.cy < top - 0.3 * d || c.cy > bottom + 0.3 * d) return null
        val mid = s.lineY(2, c.cx)
        val w = c.width
        val h = c.height
        if (w >= 0.8 * d && w <= 1.8 * d && h >= 0.3 * d && h <= 0.8 * d && c.fill >= 0.7) {
            val l1 = s.lineY(1, c.cx)
            return if (c.cy < l1 + 0.5 * d) (4 * Score.TPQ to true) else (2 * Score.TPQ to false)
        }
        if (w < 0.55 * d || w > 1.4 * d) return null
        if (h >= 2.0 * d && h <= 3.4 * d && abs(c.cy - mid) <= 1.0 * d && c.fill in 0.2..0.75) return Score.TPQ to false
        if (h >= 1.1 * d && h < 2.0 * d && abs(c.cy - mid) <= 1.2 * d && c.fill <= 0.6) return Score.TPQ / 2 to false
        return null
    }

    private val SHARP_ORDER = intArrayOf(3, 0, 4, 1, 5, 2, 6) // F C G D A E B
    private val FLAT_ORDER = intArrayOf(6, 2, 5, 1, 4, 0, 3)  // B E A D G C F
    private val SEMITONES = intArrayOf(0, 2, 4, 5, 7, 9, 11)

    private fun assignPitches(items: List<Item>, staff: Staff, clef: Clef, key: Int) {
        // diatonic number (octave * 7 + letter) of the bottom line
        val base = when (clef) {
            Clef.TREBLE -> 4 * 7 + 2 // E4
            Clef.BASS -> 2 * 7 + 4   // G2
            Clef.ALTO -> 3 * 7 + 3   // F3
        }
        val keyAlter = IntArray(7)
        if (key > 0) for (i in 0 until key) keyAlter[SHARP_ORDER[i]] = 1
        if (key < 0) for (i in 0 until -key) keyAlter[FLAT_ORDER[i]] = -1
        var measure = -1
        val local = HashMap<Int, Int>()
        for (it in items) {
            if (it.measure != measure) { measure = it.measure; local.clear() }
            it.pitches = it.heads.map { h ->
                val dia = base + staff.stepAt(h.cx, h.cy)
                h.accidental?.let { a -> local[dia] = a }
                val letter = Math.floorMod(dia, 7)
                val octave = Math.floorDiv(dia, 7)
                val alter = local[dia] ?: keyAlter[letter]
                12 * (octave + 1) + SEMITONES[letter] + alter
            }.distinct().sorted()
        }
    }
}
