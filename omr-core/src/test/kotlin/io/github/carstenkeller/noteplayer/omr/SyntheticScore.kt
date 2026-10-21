package io.github.carstenkeller.noteplayer.omr

import java.awt.BasicStroke
import java.awt.Color
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.geom.AffineTransform
import java.awt.geom.Ellipse2D
import java.awt.geom.Line2D
import java.awt.geom.Path2D
import java.awt.geom.Rectangle2D
import java.awt.image.BufferedImage
import kotlin.random.Random

/** Renders simple engraved-looking test scores with Java2D. */
class SyntheticScore(val width: Int = 1600, val height: Int = 900, val space: Double = 20.0) {
    val image = BufferedImage(width, height, BufferedImage.TYPE_INT_RGB)
    private val g: Graphics2D = image.createGraphics().apply {
        setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
        color = Color.WHITE
        fillRect(0, 0, width, height)
        color = Color.BLACK
    }
    private val lineW = space * 0.12
    private val stemW = space * 0.13
    private val stemLen = space * 3.5

    /** Draws five lines; returns the y of the bottom line. */
    fun staff(topY: Double, left: Double = 60.0, right: Double = width - 60.0): Double {
        g.stroke = BasicStroke(lineW.toFloat())
        for (i in 0 until 5) g.draw(Line2D.Double(left, topY + i * space, right, topY + i * space))
        return topY + 4 * space
    }

    fun yOf(bottomLine: Double, step: Int) = bottomLine - step * space / 2

    private fun headShape(x: Double, y: Double): java.awt.Shape {
        val e = Ellipse2D.Double(-0.65 * space, -0.47 * space, 1.3 * space, 0.94 * space)
        val t = AffineTransform()
        t.translate(x, y)
        t.rotate(Math.toRadians(-20.0))
        return t.createTransformedShape(e)
    }

    /** Draws a note head (+stem). Returns stem x and tip y. */
    fun note(x: Double, bottomLine: Double, step: Int, hollow: Boolean = false, stem: Boolean = true, up: Boolean = step < 4): Pair<Double, Double> {
        val y = yOf(bottomLine, step)
        val shape = headShape(x, y)
        g.fill(shape)
        if (hollow) {
            // engraved half/whole heads: thick sides, thin top and bottom, tilted hole
            val hole = Ellipse2D.Double(-0.45 * space, -0.25 * space, 0.9 * space, 0.5 * space)
            val t = AffineTransform()
            t.translate(x, y)
            t.rotate(Math.toRadians(-30.0))
            g.color = Color.WHITE
            g.fill(t.createTransformedShape(hole))
            g.color = Color.BLACK
        }
        // ledger lines
        g.stroke = BasicStroke(lineW.toFloat())
        var s = -2
        while (s >= step) { val ly = yOf(bottomLine, s); g.draw(Line2D.Double(x - space, ly, x + space, ly)); s -= 2 }
        s = 10
        while (s <= step) { val ly = yOf(bottomLine, s); g.draw(Line2D.Double(x - space, ly, x + space, ly)); s += 2 }
        if (!stem) return x to y
        val sx = if (up) x + 0.6 * space else x - 0.6 * space
        val tip = if (up) y - stemLen else y + stemLen
        g.fill(Rectangle2D.Double(sx - stemW / 2, minOf(y, tip), stemW, stemLen))
        return sx to tip
    }

    fun beam(a: Pair<Double, Double>, b: Pair<Double, Double>, index: Int = 0, up: Boolean = true) {
        val th = 0.5 * space
        val off = index * 0.75 * space * (if (up) 1 else -1)
        val p = Path2D.Double()
        val y0 = if (up) a.second + off else a.second + off - th
        val y1 = if (up) b.second + off else b.second + off - th
        p.moveTo(a.first - stemW / 2, y0)
        p.lineTo(b.first + stemW / 2, y1)
        p.lineTo(b.first + stemW / 2, y1 + th)
        p.lineTo(a.first - stemW / 2, y0 + th)
        p.closePath()
        g.fill(p)
    }

    fun dot(x: Double, bottomLine: Double, step: Int) {
        val y = yOf(bottomLine, if (step % 2 == 0) step + 1 else step)
        val r = 0.22 * space
        g.fill(Ellipse2D.Double(x + 1.0 * space - r, y - r, 2 * r, 2 * r))
    }

    fun sharp(x: Double, bottomLine: Double, step: Int) {
        val y = yOf(bottomLine, step)
        val cx = x - 1.5 * space
        g.fill(Rectangle2D.Double(cx - 0.3 * space, y - 1.3 * space, stemW, 2.6 * space))
        g.fill(Rectangle2D.Double(cx + 0.25 * space, y - 1.4 * space, stemW, 2.6 * space))
        for (dy in doubleArrayOf(-0.45, 0.45)) {
            val p = Path2D.Double()
            p.moveTo(cx - 0.5 * space, y + dy * space + 0.1 * space)
            p.lineTo(cx + 0.5 * space, y + dy * space - 0.1 * space)
            p.lineTo(cx + 0.5 * space, y + dy * space + 0.3 * space)
            p.lineTo(cx - 0.5 * space, y + dy * space + 0.5 * space)
            p.closePath()
            g.fill(p)
        }
    }

    /** A rough treble clef: tall stroke with a loop around the G line. */
    fun trebleClef(x: Double, bottomLine: Double) {
        g.stroke = BasicStroke((space * 0.25).toFloat())
        // the spine of a real treble clef is slanted
        g.draw(Line2D.Double(x - 0.4 * space, bottomLine + 1.5 * space, x + 0.6 * space, bottomLine - 6.5 * space))
        g.draw(Ellipse2D.Double(x - 0.8 * space, bottomLine - 2.2 * space, 1.6 * space, 1.8 * space))
    }

    /** A rough bass clef: a thick hook in the upper half plus two dots. */
    fun bassClef(x: Double, bottomLine: Double) {
        g.stroke = BasicStroke((space * 0.3).toFloat())
        val p = Path2D.Double()
        p.moveTo(x, bottomLine - 3 * space)
        p.curveTo(x + 2.2 * space, bottomLine - 4.6 * space, x + 2.8 * space, bottomLine - 2.0 * space, x, bottomLine - 1.2 * space)
        g.draw(p)
        val r = 0.2 * space
        g.fill(Ellipse2D.Double(x + 2.6 * space - r, bottomLine - 3.5 * space - r, 2 * r, 2 * r))
        g.fill(Ellipse2D.Double(x + 2.6 * space - r, bottomLine - 2.5 * space - r, 2 * r, 2 * r))
    }

    fun barline(x: Double, top: Double, bottom: Double) {
        g.fill(Rectangle2D.Double(x, top, space * 0.15, bottom - top))
    }

    fun wholeRest(x: Double, bottomLine: Double) {
        val l1 = bottomLine - 3 * space
        g.fill(Rectangle2D.Double(x, l1, 1.2 * space, 0.5 * space))
    }

    fun toGray(rotationDeg: Double = 0.0, noise: Int = 0, gradient: Boolean = false, seed: Int = 1): GrayImage {
        var img = image
        if (rotationDeg != 0.0) {
            val r = BufferedImage(width, height, BufferedImage.TYPE_INT_RGB)
            val g2 = r.createGraphics()
            g2.color = Color.WHITE
            g2.fillRect(0, 0, width, height)
            g2.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR)
            g2.rotate(Math.toRadians(rotationDeg), width / 2.0, height / 2.0)
            g2.drawImage(image, 0, 0, null)
            g2.dispose()
            img = r
        }
        val rnd = Random(seed)
        val px = IntArray(width * height)
        for (y in 0 until height) for (x in 0 until width) {
            val rgb = img.getRGB(x, y)
            var v = (rgb and 0xFF).toDouble()
            if (gradient) v = v * (0.55 + 0.45 * x / width) // uneven lighting
            if (noise > 0) v += rnd.nextInt(-noise, noise + 1)
            px[y * width + x] = v.toInt().coerceIn(0, 255)
        }
        return GrayImage(width, height, px)
    }
}
