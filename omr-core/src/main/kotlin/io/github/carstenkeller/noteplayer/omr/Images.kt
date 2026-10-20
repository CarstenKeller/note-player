package io.github.carstenkeller.noteplayer.omr

import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/** 8-bit grayscale image, 0 = black, 255 = white. */
class GrayImage(val width: Int, val height: Int, val pixels: IntArray = IntArray(width * height) { 255 }) {
    init {
        require(pixels.size == width * height) { "pixel buffer does not match size" }
    }

    operator fun get(x: Int, y: Int): Int = pixels[y * width + x]

    /** Bilinear sample, white outside the image. */
    fun sample(fx: Double, fy: Double): Int {
        val x0 = floor(fx).toInt()
        val y0 = floor(fy).toInt()
        val ax = fx - x0
        val ay = fy - y0
        fun px(x: Int, y: Int) = if (x in 0 until width && y in 0 until height) pixels[y * width + x] else 255
        val top = px(x0, y0) * (1 - ax) + px(x0 + 1, y0) * ax
        val bottom = px(x0, y0 + 1) * (1 - ax) + px(x0 + 1, y0 + 1) * ax
        return (top * (1 - ay) + bottom * ay).toInt()
    }

    /** Area-averaging downscale so that the longer side is at most [maxSide]. */
    fun downscaled(maxSide: Int): GrayImage {
        val longSide = max(width, height)
        if (longSide <= maxSide) return this
        val scale = maxSide.toDouble() / longSide
        val nw = max(1, (width * scale).toInt())
        val nh = max(1, (height * scale).toInt())
        val out = IntArray(nw * nh)
        for (ny in 0 until nh) {
            val sy0 = (ny / scale).toInt()
            val sy1 = min(height, max(sy0 + 1, ((ny + 1) / scale).toInt()))
            for (nx in 0 until nw) {
                val sx0 = (nx / scale).toInt()
                val sx1 = min(width, max(sx0 + 1, ((nx + 1) / scale).toInt()))
                var sum = 0L
                for (sy in sy0 until sy1) {
                    val row = sy * width
                    for (sx in sx0 until sx1) sum += pixels[row + sx]
                }
                out[ny * nw + nx] = (sum / ((sy1 - sy0) * (sx1 - sx0))).toInt()
            }
        }
        return GrayImage(nw, nh, out)
    }

    /** Rotates the image by [degrees] around its center, keeping the size. */
    fun rotated(degrees: Double): GrayImage {
        if (degrees == 0.0) return this
        val rad = Math.toRadians(degrees)
        val c = cos(rad)
        val s = sin(rad)
        val cx = width / 2.0
        val cy = height / 2.0
        val out = IntArray(width * height)
        for (y in 0 until height) {
            val dy = y - cy
            for (x in 0 until width) {
                val dx = x - cx
                // inverse mapping: rotate the target pixel back into the source
                val sx = c * dx + s * dy + cx
                val sy = -s * dx + c * dy + cy
                out[y * width + x] = sample(sx, sy)
            }
        }
        return GrayImage(width, height, out)
    }
}

/** Binary image, true = black (ink). Reads outside the image return false. */
class BinaryImage(val width: Int, val height: Int, val data: BooleanArray = BooleanArray(width * height)) {
    operator fun get(x: Int, y: Int): Boolean =
        x in 0 until width && y in 0 until height && data[y * width + x]

    operator fun set(x: Int, y: Int, value: Boolean) {
        if (x in 0 until width && y in 0 until height) data[y * width + x] = value
    }

    fun copy() = BinaryImage(width, height, data.copyOf())

    /** Erosion with a (2r+1) x (2r+1) square: a pixel stays black only if the whole square is black. */
    fun eroded(r: Int): BinaryImage {
        if (r <= 0) return copy()
        val horizontal = BooleanArray(width * height)
        for (y in 0 until height) {
            val row = y * width
            var run = 0
            // run = number of consecutive black pixels ending at x
            val runs = IntArray(width)
            for (x in 0 until width) {
                run = if (data[row + x]) run + 1 else 0
                runs[x] = run
            }
            for (x in r until width - r) {
                horizontal[row + x] = runs[x + r] >= 2 * r + 1
            }
        }
        val out = BooleanArray(width * height)
        val colRuns = IntArray(height)
        for (x in 0 until width) {
            var run = 0
            for (y in 0 until height) {
                run = if (horizontal[y * width + x]) run + 1 else 0
                colRuns[y] = run
            }
            for (y in r until height - r) {
                out[y * width + x] = colRuns[y + r] >= 2 * r + 1
            }
        }
        return BinaryImage(width, height, out)
    }
}

object Binarizer {
    /**
     * Sauvola thresholding. Local mean and deviation are computed on a 4x reduced grid
     * to keep memory small on phones; [window] is given in full-resolution pixels.
     */
    fun sauvola(img: GrayImage, window: Int, k: Double = 0.2, r: Double = 128.0): BinaryImage {
        val f = 4
        val sw = (img.width + f - 1) / f
        val sh = (img.height + f - 1) / f
        val small = DoubleArray(sw * sh)
        val smallSq = DoubleArray(sw * sh)
        val counts = IntArray(sw * sh)
        for (y in 0 until img.height) {
            for (x in 0 until img.width) {
                val i = (y / f) * sw + x / f
                val v = img.pixels[y * img.width + x].toDouble()
                small[i] += v
                smallSq[i] += v * v
                counts[i]++
            }
        }
        // integral images over the reduced grid
        val iw = sw + 1
        val sum = DoubleArray(iw * (sh + 1))
        val sumSq = DoubleArray(iw * (sh + 1))
        val cnt = IntArray(iw * (sh + 1))
        for (y in 0 until sh) {
            var rs = 0.0
            var rq = 0.0
            var rc = 0
            for (x in 0 until sw) {
                val i = y * sw + x
                rs += small[i]; rq += smallSq[i]; rc += counts[i]
                val o = (y + 1) * iw + x + 1
                sum[o] = sum[o - iw] + rs
                sumSq[o] = sumSq[o - iw] + rq
                cnt[o] = cnt[o - iw] + rc
            }
        }
        val half = max(1, window / f / 2)
        val mean = DoubleArray(sw * sh)
        val thr = DoubleArray(sw * sh)
        for (y in 0 until sh) {
            val y0 = max(0, y - half)
            val y1 = min(sh, y + half + 1)
            for (x in 0 until sw) {
                val x0 = max(0, x - half)
                val x1 = min(sw, x + half + 1)
                val a = y0 * iw + x0
                val b = y0 * iw + x1
                val c = y1 * iw + x0
                val d = y1 * iw + x1
                val n = (cnt[d] - cnt[b] - cnt[c] + cnt[a]).toDouble()
                val m = (sum[d] - sum[b] - sum[c] + sum[a]) / n
                val v = (sumSq[d] - sumSq[b] - sumSq[c] + sumSq[a]) / n - m * m
                val sd = sqrt(max(0.0, v))
                mean[y * sw + x] = m
                thr[y * sw + x] = m * (1 + k * (sd / r - 1))
            }
        }
        val out = BinaryImage(img.width, img.height)
        for (y in 0 until img.height) {
            for (x in 0 until img.width) {
                val i = (y / f) * sw + x / f
                val p = img.pixels[y * img.width + x]
                // the absolute guard avoids turning paper texture into ink in flat regions
                out.data[y * img.width + x] = p < thr[i] && p < 225
            }
        }
        return out
    }
}
