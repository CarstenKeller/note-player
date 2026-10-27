package io.github.carstenkeller.noteplayer.omr

/** Writes a [Score] as a standard MIDI file (format 0). */
object MidiWriter {

    fun write(score: Score, bpm: Int, program: Int = 0, velocity: Int = 90): ByteArray {
        data class Ev(val tick: Int, val order: Int, val bytes: ByteArray)

        val evs = mutableListOf<Ev>()
        for (e in score.events) {
            for (p in e.pitches.distinct()) {
                val pitch = p.coerceIn(0, 127)
                // note-offs sort before note-ons on the same tick so repeated notes re-strike
                evs += Ev(e.startTick, 1, byteArrayOf(0x90.toByte(), pitch.toByte(), velocity.toByte()))
                evs += Ev(e.endTick, 0, byteArrayOf(0x80.toByte(), pitch.toByte(), 0))
            }
        }
        evs.sortWith(compareBy<Ev>({ it.tick }, { it.order }))

        val track = Bytes()
        val usPerQuarter = 60_000_000 / bpm.coerceIn(20, 400)
        track.writeVarLen(0)
        track.write(byteArrayOf(0xFF.toByte(), 0x51, 0x03,
            (usPerQuarter shr 16).toByte(), (usPerQuarter shr 8).toByte(), usPerQuarter.toByte()))
        track.writeVarLen(0)
        track.write(byteArrayOf(0xC0.toByte(), program.coerceIn(0, 127).toByte()))
        var last = 0
        for (ev in evs) {
            track.writeVarLen(ev.tick - last)
            track.write(ev.bytes)
            last = ev.tick
        }
        // a short tail so the last note can ring out
        track.writeVarLen(score.ticksPerQuarter / 2)
        track.write(byteArrayOf(0xFF.toByte(), 0x2F, 0x00))

        val out = Bytes()
        out.write("MThd".encodeToByteArray())
        out.writeInt32(6)
        out.writeInt16(0)
        out.writeInt16(1)
        out.writeInt16(score.ticksPerQuarter)
        out.write("MTrk".encodeToByteArray())
        val trackBytes = track.toByteArray()
        out.writeInt32(trackBytes.size)
        out.write(trackBytes)
        return out.toByteArray()
    }

    fun ticksToMillis(ticks: Int, bpm: Int, tpq: Int): Long = ticks.toLong() * 60_000L / (bpm.toLong() * tpq)

    fun millisToTicks(ms: Long, bpm: Int, tpq: Int): Int = (ms * bpm * tpq / 60_000L).toInt()

    private fun Bytes.writeVarLen(value: Int) {
        var v = value
        var buffer = v and 0x7F
        while (true) {
            v = v ushr 7
            if (v == 0) break
            buffer = (buffer shl 8) or ((v and 0x7F) or 0x80)
        }
        while (true) {
            write(buffer and 0xFF)
            if (buffer and 0x80 != 0) buffer = buffer ushr 8 else break
        }
    }

    private fun Bytes.writeInt32(v: Int) {
        write(v ushr 24); write(v ushr 16 and 0xFF); write(v ushr 8 and 0xFF); write(v and 0xFF)
    }

    private fun Bytes.writeInt16(v: Int) {
        write(v ushr 8 and 0xFF); write(v and 0xFF)
    }

    /** A growing byte buffer (java.io.ByteArrayOutputStream is not available on every platform). */
    private class Bytes {
        private var data = ByteArray(256)
        private var size = 0

        fun write(b: Int) {
            if (size == data.size) data = data.copyOf(size * 2)
            data[size++] = b.toByte()
        }

        fun write(bytes: ByteArray) {
            for (b in bytes) write(b.toInt())
        }

        fun toByteArray() = data.copyOf(size)
    }
}
