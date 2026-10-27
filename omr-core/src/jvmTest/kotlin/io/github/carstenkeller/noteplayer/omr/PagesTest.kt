package io.github.carstenkeller.noteplayer.omr

import javax.imageio.ImageIO
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PagesTest {

    private fun recognize(name: String): RecognitionResult {
        val img = ImageIO.read(javaClass.getResourceAsStream("/$name")!!)
        val px = IntArray(img.width * img.height)
        for (y in 0 until img.height) for (x in 0 until img.width) {
            val c = img.getRGB(x, y)
            px[y * img.width + x] = (((c shr 16) and 255) * 299 + ((c shr 8) and 255) * 587 + (c and 255) * 114) / 1000
        }
        return Omr.recognize(GrayImage(img.width, img.height, px))
    }

    @Test
    fun pagesArePlayedOneAfterTheOther() {
        val a = recognize("entchen.png")
        val b = recognize("piano.png")
        val joined = Pages.join(listOf(a, b))
        val s = joined.score

        // the music of the second page follows the first
        assertEquals(a.score.events.map { it.pitches } + b.score.events.map { it.pitches }, s.events.map { it.pitches })
        val second = s.events.drop(a.score.events.size)
        assertEquals(b.score.events.map { it.startTick + a.score.totalTicks }, second.map { it.startTick })
        assertEquals(a.score.totalTicks + b.score.totalTicks, s.totalTicks)

        // staves and systems are numbered through, events point to the right ones
        assertEquals(a.score.staves.size + b.score.staves.size, s.staves.size)
        assertEquals(a.score.systems.size + b.score.systems.size, s.systems.size)
        assertEquals(s.staves.indices.toList(), s.staves.map { it.index })
        for (e in s.events) assertEquals(s.staves[e.staffIndex].systemIndex, e.systemIndex)
        assertEquals(b.score.staves.map { it.clef }, s.staves.drop(a.score.staves.size).map { it.clef })

        // the second page lies below the first, everything on the joined page
        val firstBottom = s.systems.take(a.score.systems.size).maxOf { it.box.bottom }
        val secondTop = s.systems.drop(a.score.systems.size).minOf { it.box.top }
        assertTrue(secondTop > firstBottom)
        for (e in s.events) assertTrue(e.box.right <= joined.page.width && e.box.bottom <= joined.page.height)
    }
}
