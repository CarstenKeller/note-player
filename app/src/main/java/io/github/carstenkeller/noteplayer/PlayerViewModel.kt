package io.github.carstenkeller.noteplayer

import android.app.Application
import android.graphics.Bitmap
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.github.carstenkeller.noteplayer.omr.MusicEvent
import io.github.carstenkeller.noteplayer.omr.Omr
import io.github.carstenkeller.noteplayer.omr.RecognitionResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

sealed interface ScreenState {
    data object Start : ScreenState
    data object Working : ScreenState
    data class Failed(val message: String) : ScreenState
    data class Ready(val page: Bitmap, val result: RecognitionResult) : ScreenState
}

data class PlaybackState(
    val playing: Boolean = false,
    /** Current position in ticks; -1 = not started. */
    val tick: Int = -1,
    val bpm: Int = 90,
)

class PlayerViewModel(app: Application) : AndroidViewModel(app) {
    private val _screen = MutableStateFlow<ScreenState>(ScreenState.Start)
    val screen: StateFlow<ScreenState> = _screen.asStateFlow()

    private val _playback = MutableStateFlow(PlaybackState())
    val playback: StateFlow<PlaybackState> = _playback.asStateFlow()

    private val player = MidiPlayer(app).apply {
        onCompletion = {
            ticker?.cancel()
            _playback.update { it.copy(playing = false, tick = -1) }
        }
    }
    private var ticker: Job? = null

    fun open(uri: Uri) {
        stop()
        _screen.value = ScreenState.Working
        viewModelScope.launch {
            _screen.value = try {
                withContext(Dispatchers.Default) {
                    val gray = ImageLoader.loadGray(getApplication(), uri)
                    val result = Omr.recognize(gray)
                    ScreenState.Ready(ImageLoader.toBitmap(result.page), result)
                }
            } catch (e: OutOfMemoryError) {
                ScreenState.Failed("Das Bild ist zu groß für den verfügbaren Speicher.")
            } catch (e: Exception) {
                ScreenState.Failed(e.message ?: "Das Bild konnte nicht verarbeitet werden.")
            }
        }
    }

    fun back() {
        stop()
        _screen.value = ScreenState.Start
    }

    fun togglePlay() {
        val ready = _screen.value as? ScreenState.Ready ?: return
        val score = ready.result.score
        if (score.events.isEmpty()) return
        val pb = _playback.value
        if (pb.playing) {
            player.pause()
            ticker?.cancel()
            _playback.update { it.copy(playing = false, tick = player.currentTick() ?: it.tick) }
        } else {
            val from = if (pb.tick in 0 until score.totalTicks) pb.tick else 0
            startAt(from)
        }
    }

    fun stop() {
        ticker?.cancel()
        player.release()
        _playback.update { it.copy(playing = false, tick = -1) }
    }

    /** Jumps to [event]; keeps playing if playback is running. */
    fun seekTo(event: MusicEvent) {
        if (_playback.value.playing) startAt(event.startTick)
        else _playback.update { it.copy(tick = event.startTick) }
    }

    fun setTempo(bpm: Int) {
        val pb = _playback.value
        if (pb.bpm == bpm) return
        _playback.update { it.copy(bpm = bpm) }
        if (pb.playing) startAt(player.currentTick() ?: pb.tick)
    }

    private fun startAt(tick: Int) {
        val ready = _screen.value as? ScreenState.Ready ?: return
        val score = ready.result.score
        ticker?.cancel()
        try {
            player.play(score, _playback.value.bpm, tick.coerceAtLeast(0))
        } catch (e: Exception) {
            _screen.value = ScreenState.Failed("Wiedergabe nicht möglich: ${e.message}")
            return
        }
        _playback.update { it.copy(playing = true, tick = tick) }
        ticker = viewModelScope.launch {
            while (isActive) {
                val t = player.currentTick()
                if (t != null) _playback.update { it.copy(tick = t) }
                delay(30)
            }
        }
    }

    override fun onCleared() {
        ticker?.cancel()
        player.release()
    }
}
