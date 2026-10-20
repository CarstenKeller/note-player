package io.github.carstenkeller.noteplayer.omr

class Component(val id: Int) {
    var x0 = Int.MAX_VALUE
    var y0 = Int.MAX_VALUE
    var x1 = Int.MIN_VALUE
    var y1 = Int.MIN_VALUE
    var area = 0
    val width get() = x1 - x0 + 1
    val height get() = y1 - y0 + 1
    val cx get() = (x0 + x1) / 2.0
    val cy get() = (y0 + y1) / 2.0
    val fill get() = area.toDouble() / (width * height)

    /** Ids of the labeled components merged into this glyph (see Omr.mergeGlyphs). */
    val members = ArrayList<Int>()

    internal fun absorb(o: Component) {
        if (o.x0 < x0) x0 = o.x0
        if (o.x1 > x1) x1 = o.x1
        if (o.y0 < y0) y0 = o.y0
        if (o.y1 > y1) y1 = o.y1
        area += o.area
        if (o.members.isEmpty()) members += o.id else members += o.members
    }

    internal fun add(x: Int, y: Int) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
        area++
    }
}

/** 8-connected labeling of black pixels. Label 0 = background, component i has label i + 1. */
class Components(val labels: IntArray, val list: List<Component>, private val width: Int) {
    fun at(x: Int, y: Int): Component? {
        val l = labels[y * width + x]
        return if (l == 0) null else list[l - 1]
    }

    companion object {
        fun label(img: BinaryImage): Components {
            val w = img.width
            val h = img.height
            val labels = IntArray(w * h)
            val list = ArrayList<Component>()
            var stack = IntArray(1024)
            for (start in 0 until w * h) {
                if (!img.data[start] || labels[start] != 0) continue
                val comp = Component(list.size)
                list += comp
                val label = list.size
                var sp = 0
                stack[sp++] = start
                labels[start] = label
                while (sp > 0) {
                    val p = stack[--sp]
                    val px = p % w
                    val py = p / w
                    comp.add(px, py)
                    for (dy in -1..1) {
                        val ny = py + dy
                        if (ny < 0 || ny >= h) continue
                        for (dx in -1..1) {
                            val nx = px + dx
                            if (nx < 0 || nx >= w) continue
                            val q = ny * w + nx
                            if (img.data[q] && labels[q] == 0) {
                                labels[q] = label
                                if (sp == stack.size) stack = stack.copyOf(stack.size * 2)
                                stack[sp++] = q
                            }
                        }
                    }
                }
            }
            return Components(labels, list, w)
        }
    }
}
