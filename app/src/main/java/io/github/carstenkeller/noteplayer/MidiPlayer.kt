package io.github.carstenkeller.noteplayer

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import io.github.carstenkeller.noteplayer.omr.MidiWriter
import io.github.carstenkeller.noteplayer.omr.Score
import java.io.File

/**
 * Plays a [Score] through Android's built-in MIDI synthesizer (MediaPlayer can play .mid files).
 * The current musical position is derived from the player's playback position.
 */
class MidiPlayer(private val context: Context) {
    private var player: MediaPlayer? = null
    private var preparedFor: Pair<Score, Int>? = null
    var onCompletion: (() -> Unit)? = null

    val isPlaying: Boolean get() = player?.isPlaying == true

    private fun ensurePrepared(score: Score, bpm: Int): MediaPlayer {
        val current = player
        if (current != null && preparedFor?.first === score && preparedFor?.second == bpm) return current
        release()
        val file = File(context.cacheDir, "score.mid")
        file.writeBytes(MidiWriter.write(score, bpm))
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
        player = mp
        preparedFor = score to bpm
        return mp
    }

    /** Starts playing at [fromTick] with tempo [bpm]. */
    fun play(score: Score, bpm: Int, fromTick: Int) {
        val mp = ensurePrepared(score, bpm)
        val ms = MidiWriter.ticksToMillis(fromTick, bpm, score.ticksPerQuarter).toInt()
        mp.seekTo(ms)
        mp.start()
    }

    fun pause() {
        player?.takeIf { it.isPlaying }?.pause()
    }

    /** Current position in ticks, or null if nothing is loaded. */
    fun currentTick(): Int? {
        val mp = player ?: return null
        val (score, bpm) = preparedFor ?: return null
        return MidiWriter.millisToTicks(mp.currentPosition.toLong(), bpm, score.ticksPerQuarter)
    }

    fun release() {
        player?.release()
        player = null
        preparedFor = null
    }
}
