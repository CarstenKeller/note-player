package io.github.carstenkeller.noteplayer.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import io.github.carstenkeller.noteplayer.omr.Score
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.roundToInt

/**
 * Renders the score with the chosen sound into an audio file and plays it. The musical
 * position is derived from the playback position, so the display stays in sync.
 */
class ScorePlayer(private val context: Context) {
    private data class Key(val score: Score, val bpm: Int, val instrument: Instrument)

    private val bank = SampleBank(context)
    private var player: MediaPlayer? = null
    private var preparedFor: Key? = null
    private var fileCounter = 0
    var onCompletion: (() -> Unit)? = null

    private val prepareLock = Any()

    /**
     * Renders and loads the audio; slow (up to a few seconds), call off the main thread.
     * The player controls below stay responsive meanwhile.
     */
    fun prepare(score: Score, bpm: Int, instrument: Instrument): Unit = synchronized(prepareLock) {
        val key = Key(score, bpm, instrument)
        if (synchronized(this) { player != null && preparedFor == key }) return@synchronized
        val samples = Renderer.render(score, bpm, instrument, bank)
        // a new file name each time: the old player may still read the previous file
        cleanup()
        val file = File(context.cacheDir, "score_${fileCounter++}.wav")
        writeWav(samples, file)
        val mp = MediaPlayer()
        mp.setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build()
        )
        mp.setDataSource(file.absolutePath)
        mp.setOnCompletionListener { onCompletion?.invoke() }
        mp.prepare()
        val old = synchronized(this) {
            val o = player
            player = mp
            preparedFor = key
            o
        }
        old?.release()
    }

    @Synchronized
    fun play(fromTick: Int) {
        val mp = player ?: return
        val key = preparedFor ?: return
        val ms = Renderer.secondsOf(fromTick, key.bpm, key.score.ticksPerQuarter) * 1000
        mp.seekTo(ms.roundToInt())
        mp.start()
    }

    @Synchronized
    fun pause() {
        player?.takeIf { it.isPlaying }?.pause()
    }

    /** Current position in ticks, or null if nothing is loaded. */
    @Synchronized
    fun currentTick(): Int? {
        val mp = player ?: return null
        val key = preparedFor ?: return null
        return (mp.currentPosition / 1000.0 * key.bpm * key.score.ticksPerQuarter / 60.0).toInt()
    }

    @Synchronized
    fun release() {
        player?.release()
        player = null
        preparedFor = null
    }

    private fun cleanup() {
        context.cacheDir.listFiles { f -> f.name.startsWith("score_") && f.name.endsWith(".wav") }?.forEach { it.delete() }
    }
}

/** Writes mono float samples at [Renderer.RATE] as a 16-bit WAV file. */
private fun writeWav(samples: FloatArray, file: File) {
    val rate = Renderer.RATE
    val data = ByteBuffer.allocate(samples.size * 2).order(ByteOrder.LITTLE_ENDIAN)
    for (v in samples) data.putShort((v.coerceIn(-1f, 1f) * 32767).toInt().toShort())
    val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
    header.put("RIFF".toByteArray()).putInt(36 + samples.size * 2).put("WAVE".toByteArray())
    header.put("fmt ".toByteArray()).putInt(16).putShort(1.toShort()).putShort(1.toShort())
        .putInt(rate).putInt(rate * 2).putShort(2.toShort()).putShort(16.toShort())
    header.put("data".toByteArray()).putInt(samples.size * 2)
    FileOutputStream(file).use { it.write(header.array()); it.write(data.array()) }
}
