package io.github.carstenkeller.noteplayer

import android.app.Application
import android.graphics.Bitmap
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.github.carstenkeller.noteplayer.audio.Instrument
import io.github.carstenkeller.noteplayer.audio.ScorePlayer
import io.github.carstenkeller.noteplayer.omr.MusicEvent
import io.github.carstenkeller.noteplayer.omr.Omr
import io.github.carstenkeller.noteplayer.omr.Pages
import io.github.carstenkeller.noteplayer.omr.RecognitionResult
import io.github.carstenkeller.noteplayer.omr.Score
import io.github.carstenkeller.noteplayer.omr.VideoStitcher
import kotlinx.coroutines.CancellationException
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
    data class Working(val message: String) : ScreenState
    data class Failed(val message: String) : ScreenState
    data class Ready(val page: Bitmap, val result: RecognitionResult, val piece: Piece) : ScreenState
}

data class PlaybackState(
    val playing: Boolean = false,
    /** Current position in ticks; -1 = not started. */
    val tick: Int = -1,
    /** Playback speed relative to [baseBpm]. */
    val tempoPercent: Int = 100,
    /** Quarter notes per minute at 100 %; set by the user (tempo marks are not read). */
    val baseBpm: Int = DEFAULT_BPM,
    /** Play vocal lines (staves with lyrics) too; off by default. */
    val includeVocals: Boolean = false,
    val instrument: Instrument = Instrument.GRAND_PIANO,
    /** The sound is being rendered before playback starts. */
    val preparing: Boolean = false,
    val error: String? = null,
) {
    val bpm: Int get() = (baseBpm * tempoPercent / 100).coerceAtLeast(10)

    companion object {
        /**
         * Tempo markings are not read from the page; without a setting, 100 % means 120 quarter
         * notes per minute, the usual default of notation programs.
         */
        const val DEFAULT_BPM = 120
    }
}

/** The score to play and show: with or without vocal lines. */
fun ScreenState.Ready.score(playback: PlaybackState): Score =
    if (playback.includeVocals) result.score else result.withoutVocals

private const val MAX_PIXELS = 16_000_000L

class PlayerViewModel(app: Application) : AndroidViewModel(app) {
    private val _screen = MutableStateFlow<ScreenState>(ScreenState.Start)
    val screen: StateFlow<ScreenState> = _screen.asStateFlow()

    private val _playback = MutableStateFlow(PlaybackState())
    val playback: StateFlow<PlaybackState> = _playback.asStateFlow()

    private val prefs = app.getSharedPreferences("settings", android.content.Context.MODE_PRIVATE)

    private val player = ScorePlayer(app).apply {
        onCompletion = {
            ticker?.cancel()
            _playback.update { it.copy(playing = false, tick = -1) }
        }
    }
    private var ticker: Job? = null
    private var startJob: Job? = null

    init {
        val saved = prefs.getString("instrument", null)
        Instrument.entries.firstOrNull { it.name == saved }?.let { i -> _playback.update { it.copy(instrument = i) } }
    }

    private val store = PieceStore(app)

    /** The saved pieces, newest first. */
    private val _pieces = MutableStateFlow(store.list())
    val pieces: StateFlow<List<Piece>> = _pieces.asStateFlow()

    /** The base tempo is remembered per piece, so a piece keeps its tempo when opened again. */
    private var tempoKey: String? = null

    /** The open piece and the recognized sheets, in playing order. */
    private var piece: Piece? = null
    private var parts: List<RecognitionResult> = emptyList()

    /** Opens new sheets (one or more pictures, or a video); they are saved as a new piece. */
    fun open(uris: List<Uri>) {
        if (uris.isEmpty()) return
        rebuild(previous = null) {
            val p = store.create(uris)
            p to p.sheets.map { null }
        }
    }

    /** Opens a saved piece. */
    fun open(saved: Piece) {
        rebuild(previous = null) { saved to saved.sheets.map { null } }
    }

    /** Adds sheets at the end of the piece; the sheets already there are not recognized again. */
    fun addPages(uris: List<Uri>) {
        val p = piece ?: return
        if (uris.isEmpty()) return
        val known = parts
        rebuild(previous = _screen.value as? ScreenState.Ready) {
            store.addSheets(p, uris) to (known + uris.map { null })
        }
    }

    /** Replaces sheet [index] by a new photo or picture (e.g. when it was recognized badly). */
    fun replaceSheet(index: Int, uri: Uri) {
        val p = piece ?: return
        val known = parts
        rebuild(previous = _screen.value as? ScreenState.Ready) {
            store.replaceSheet(p, index, uri) to known.toMutableList<RecognitionResult?>().also { it[index] = null }
        }
    }

    fun removeSheet(index: Int) {
        val p = piece ?: return
        if (p.sheets.size < 2) return
        val known = parts
        rebuild(previous = _screen.value as? ScreenState.Ready) {
            store.removeSheet(p, index) to known.filterIndexed { i, _ -> i != index }
        }
    }

    fun rename(target: Piece, name: String) {
        val renamed = store.rename(target, name)
        if (piece?.id == renamed.id) {
            piece = renamed
            (_screen.value as? ScreenState.Ready)?.let { _screen.value = it.copy(piece = renamed) }
        }
        _pieces.value = store.list()
    }

    fun delete(target: Piece) {
        store.delete(target)
        prefs.edit().remove("bpm_" + target.id).apply()
        _pieces.value = store.list()
    }

    /**
     * Changes the open piece with [change] (which returns the piece and the sheets already
     * recognized, null where a sheet has to be recognized) and shows the result. If that fails
     * and a piece was shown before ([previous]), it stays as it was.
     */
    private fun rebuild(previous: ScreenState.Ready?, change: () -> Pair<Piece, List<RecognitionResult?>>) {
        stop()
        _screen.value = ScreenState.Working("Noten werden erkannt …")
        viewModelScope.launch {
            val outcome = try {
                withContext(Dispatchers.Default) {
                    val (p, known) = change()
                    val all = p.sheets.mapIndexed { i, sheet ->
                        known.getOrNull(i) ?: run {
                            val label = if (p.sheets.size > 1) "Blatt ${i + 1}: " else ""
                            if (sheet.video) recognizeVideo(Uri.fromFile(sheet.file), label) else {
                                _screen.value = ScreenState.Working("${label}Noten werden erkannt …")
                                val gray = ImageLoader.loadGray(getApplication(), Uri.fromFile(sheet.file))
                                Omr.recognize(gray, maxSideFor(gray.width, gray.height))
                            }
                        }
                    }
                    if (all.isEmpty()) error("Das Stück enthält keine Blätter mehr.")
                    val result = Pages.join(all)
                    if (piece?.id != p.id) {
                        tempoKey = "bpm_" + p.id
                        val savedBpm = prefs.getInt(tempoKey, PlaybackState.DEFAULT_BPM)
                        _playback.update { it.copy(baseBpm = savedBpm, tempoPercent = 100) }
                    }
                    piece = p
                    parts = all
                    ScreenState.Ready(ImageLoader.toBitmap(result.page), result, p)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: OutOfMemoryError) {
                ScreenState.Failed("Die Datei ist zu groß für den verfügbaren Speicher.")
            } catch (e: Exception) {
                ScreenState.Failed(e.message ?: "Die Datei konnte nicht verarbeitet werden.")
            }
            _pieces.value = store.list()
            // a sheet that could not be added leaves the piece as it was
            _screen.value = if (outcome is ScreenState.Failed && previous != null) {
                _playback.update { it.copy(error = outcome.message) }
                previous
            } else {
                if (outcome is ScreenState.Ready) _playback.update { it.copy(error = null) }
                outcome
            }
        }
    }

    private fun recognizeVideo(uri: Uri, sheet: String): RecognitionResult {
        _screen.value = ScreenState.Working("${sheet}Video wird gelesen …")
        val frames = VideoLoader.loadFrames(getApplication(), uri) { p ->
            _screen.value = ScreenState.Working("${sheet}Video wird gelesen … ${(p * 100).toInt()} %")
        }
        _screen.value = ScreenState.Working("${sheet}Notenblatt wird aus ${frames.size} Bildern zusammengesetzt …")
        val gray = VideoStitcher.stitch(frames)
        _screen.value = ScreenState.Working("${sheet}Noten werden erkannt …")
        val result = Omr.recognize(gray, maxSideFor(gray.width, gray.height))
        if (result.score.staves.isEmpty()) {
            error(
                "${sheet}Im Video wurden keine Notenlinien gefunden. Am besten geht eine " +
                    "Bildschirmaufnahme des Geräts, auf dem die Noten laufen. Ein mit " +
                    "der Kamera abgefilmter Bildschirm wird nicht unterstützt: Das Bild " +
                    "darf sich nur durch das Scrollen der Noten ändern, und die Noten " +
                    "müssen groß sein (Abstand der Notenlinien mindestens etwa 8 Pixel). " +
                    "Mehrere Blätter lassen sich besser als Fotos öffnen."
            )
        }
        return result
    }

    /**
     * Images are recognized at up to 2400 pixels on the longer side. A page put together from a
     * video can be much longer than wide; it keeps its width (the notes would get too small),
     * up to a limit on the number of pixels.
     */
    private fun maxSideFor(width: Int, height: Int): Int {
        val long = maxOf(width, height)
        val short = minOf(width, height)
        if (long <= 2400) return 2400
        val keepShort = (long.toDouble() * minOf(1.0, 2400.0 / short)).toInt()
        val pixelLimit = kotlin.math.sqrt(MAX_PIXELS.toDouble() * long / short).toInt()
        return maxOf(2400, minOf(keepShort, pixelLimit))
    }

    fun back() {
        stop()
        piece = null
        parts = emptyList()
        _screen.value = ScreenState.Start
    }

    fun togglePlay() {
        val ready = _screen.value as? ScreenState.Ready ?: return
        val pb = _playback.value
        val score = ready.score(pb)
        if (score.events.isEmpty()) return
        when {
            pb.preparing -> {
                startJob?.cancel()
                _playback.update { it.copy(preparing = false) }
            }
            pb.playing -> {
                player.pause()
                ticker?.cancel()
                _playback.update { it.copy(playing = false, tick = player.currentTick() ?: it.tick) }
            }
            else -> startAt(if (pb.tick in 0 until score.totalTicks) pb.tick else 0)
        }
    }

    fun stop() {
        startJob?.cancel()
        ticker?.cancel()
        player.pause()
        _playback.update { it.copy(playing = false, preparing = false, tick = -1) }
    }

    /** Jumps to [event]; keeps playing if playback is running. */
    fun seekTo(event: MusicEvent) {
        val pb = _playback.value
        if (pb.playing || pb.preparing) startAt(event.startTick)
        else _playback.update { it.copy(tick = event.startTick) }
    }

    fun setTempo(percent: Int) {
        val pb = _playback.value
        if (pb.tempoPercent == percent) return
        _playback.update { it.copy(tempoPercent = percent) }
        if (pb.playing || pb.preparing) startAt(player.currentTick() ?: pb.tick)
    }

    fun setBaseBpm(bpm: Int) {
        val value = bpm.coerceIn(20, 300)
        val pb = _playback.value
        if (pb.baseBpm == value) return
        tempoKey?.let { prefs.edit().putInt(it, value).apply() }
        _playback.update { it.copy(baseBpm = value) }
        if (pb.playing || pb.preparing) {
            // several quick taps: render the sound once, after the last one
            restartJob?.cancel()
            restartJob = viewModelScope.launch {
                delay(700)
                startAt(player.currentTick() ?: _playback.value.tick)
            }
        }
    }

    private var restartJob: Job? = null

    fun setInstrument(instrument: Instrument) {
        val pb = _playback.value
        if (pb.instrument == instrument) return
        prefs.edit().putString("instrument", instrument.name).apply()
        _playback.update { it.copy(instrument = instrument) }
        if (pb.playing || pb.preparing) startAt(player.currentTick() ?: pb.tick)
    }

    /** Switching the vocal line changes the timeline, so playback starts over. */
    fun setIncludeVocals(include: Boolean) {
        if (_playback.value.includeVocals == include) return
        stop()
        _playback.update { it.copy(includeVocals = include) }
    }

    private fun startAt(tick: Int) {
        val ready = _screen.value as? ScreenState.Ready ?: return
        val pb = _playback.value
        val score = ready.score(pb)
        val from = tick.coerceAtLeast(0)
        ticker?.cancel()
        startJob?.cancel()
        player.pause()
        _playback.update { it.copy(playing = false, preparing = true, tick = from, error = null) }
        startJob = viewModelScope.launch {
            try {
                // rendering the sound takes a moment; the cached result is reused
                withContext(Dispatchers.Default) { player.prepare(score, pb.bpm, pb.instrument) }
                player.play(from)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _playback.update { it.copy(preparing = false, playing = false, error = "Wiedergabe nicht möglich: ${e.message}") }
                return@launch
            }
            _playback.update { it.copy(preparing = false, playing = true) }
            ticker = launch {
                while (isActive) {
                    val t = player.currentTick()
                    if (t != null) _playback.update { it.copy(tick = t) }
                    delay(30)
                }
            }
        }
    }

    override fun onCleared() {
        startJob?.cancel()
        ticker?.cancel()
        player.release()
    }
}
