package io.github.carstenkeller.noteplayer.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import io.github.carstenkeller.noteplayer.PlaybackState
import io.github.carstenkeller.noteplayer.ScreenState
import io.github.carstenkeller.noteplayer.omr.MusicEvent
import io.github.carstenkeller.noteplayer.omr.Score
import kotlin.math.roundToInt

private val Highlight = Color(0xFFE8833A)
private val Recognized = Color(0xFF2F6FDE)
private val RestColor = Color(0xFF7A7A7A)

@Composable
fun ScoreScreen(
    state: ScreenState.Ready,
    playback: PlaybackState,
    onPlayPause: () -> Unit,
    onStop: () -> Unit,
    onTempo: (Int) -> Unit,
    onSeek: (MusicEvent) -> Unit,
    onBack: () -> Unit,
) {
    val score = state.result.score
    val page = remember(state.page) { state.page.asImageBitmap() }
    var showRecognized by rememberSaveable { mutableStateOf(true) }
    val tick = playback.tick
    val current = remember(tick, score) { if (tick < 0) null else score.events.lastOrNull { it.startTick <= tick } }
    val sounding = remember(tick, score) { if (tick < 0) emptyList() else score.eventsAt(tick) }
    val measureOffsets = remember(score) { measureOffsets(score) }

    Surface(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().safeDrawingPadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onBack) { Text("‹ Zurück") }
                Column(Modifier.weight(1f)) {
                    Text(
                        "${score.noteCount} Noten in ${score.systems.size} Zeile(n) erkannt",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    val position = current?.let {
                        "Zeile ${it.systemIndex + 1} von ${score.systems.size} · Takt ${measureOffsets[it.systemIndex] + it.measureIndex + 1}"
                    } ?: "Antippen einer Note setzt den Startpunkt"
                    Text(position, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
                }
            }
            for (w in state.result.warnings) {
                Text(w, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 16.dp))
            }

            BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
                val density = LocalDensity.current
                val widthPx = constraints.maxWidth.toFloat()
                val viewportPx = constraints.maxHeight
                val scale = widthPx / page.width
                val heightDp = with(density) { (page.height * scale).toDp() }
                val scroll = rememberScrollState()
                val space = state.result.staffSpace.toFloat()

                // keep the current line of music in view
                LaunchedEffect(current?.systemIndex, viewportPx) {
                    val ev = current ?: return@LaunchedEffect
                    val sys = score.systems.getOrNull(ev.systemIndex)?.box ?: return@LaunchedEffect
                    val top = ((sys.top - 4 * space) * scale).roundToInt()
                    val bottom = ((sys.bottom + 4 * space) * scale).roundToInt()
                    if (top < scroll.value || bottom > scroll.value + viewportPx) {
                        scroll.animateScrollTo((top - viewportPx / 6).coerceAtLeast(0))
                    }
                }

                Box(Modifier.verticalScroll(scroll)) {
                    Image(
                        bitmap = page,
                        contentDescription = "Notenblatt",
                        contentScale = ContentScale.FillWidth,
                        modifier = Modifier.fillMaxWidth().height(heightDp),
                    )
                    Canvas(
                        Modifier
                            .fillMaxWidth()
                            .height(heightDp)
                            .pointerInput(score, scale) {
                                detectTapGestures { off ->
                                    nearestEvent(score, off.x / scale, off.y / scale, space)?.let(onSeek)
                                }
                            }
                    ) {
                        val sp = space * scale
                        if (current != null) {
                            val sys = score.systems[current.systemIndex].box
                            drawRect(
                                color = Highlight.copy(alpha = 0.08f),
                                topLeft = Offset(sys.left * scale - sp, sys.top * scale - 3 * sp),
                                size = Size((sys.right - sys.left) * scale + 2 * sp, (sys.bottom - sys.top) * scale + 6 * sp),
                            )
                            val x = cursorX(score, current, tick) * scale
                            drawLine(
                                Highlight,
                                Offset(x, sys.top * scale - 3 * sp),
                                Offset(x, sys.bottom * scale + 3 * sp),
                                strokeWidth = 3.dp.toPx(),
                            )
                        }
                        if (showRecognized) {
                            for (e in score.events) {
                                drawRect(
                                    color = if (e.isRest) RestColor else Recognized,
                                    topLeft = Offset(e.box.left * scale - 2, e.box.top * scale - 2),
                                    size = Size((e.box.right - e.box.left) * scale + 4, (e.box.bottom - e.box.top) * scale + 4),
                                    style = Stroke(1.dp.toPx()),
                                    alpha = 0.6f,
                                )
                            }
                        }
                        for (e in sounding) {
                            val tl = Offset(e.box.left * scale - 0.3f * sp, e.box.top * scale - 0.3f * sp)
                            val sz = Size((e.box.right - e.box.left) * scale + 0.6f * sp, (e.box.bottom - e.box.top) * scale + 0.6f * sp)
                            drawRect(Highlight.copy(alpha = 0.35f), tl, sz)
                            drawRect(Highlight, tl, sz, style = Stroke(2.dp.toPx()))
                        }
                    }
                }
            }

            Controls(
                playback = playback,
                enabled = score.events.isNotEmpty(),
                showRecognized = showRecognized,
                onShowRecognized = { showRecognized = it },
                onPlayPause = onPlayPause,
                onStop = onStop,
                onTempo = onTempo,
            )
        }
    }
}

@Composable
private fun Controls(
    playback: PlaybackState,
    enabled: Boolean,
    showRecognized: Boolean,
    onShowRecognized: (Boolean) -> Unit,
    onPlayPause: () -> Unit,
    onStop: () -> Unit,
    onTempo: (Int) -> Unit,
) {
    var tempo by remember(playback.bpm) { mutableFloatStateOf(playback.bpm.toFloat()) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = onPlayPause, enabled = enabled, modifier = Modifier.width(140.dp)) {
                Text(if (playback.playing) "❚❚ Pause" else "▶ Abspielen")
            }
            OutlinedButton(onClick = onStop, enabled = enabled) { Text("■ Stopp") }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Tempo ${tempo.roundToInt()} ♩/min", modifier = Modifier.width(130.dp), style = MaterialTheme.typography.bodyMedium)
            Slider(
                value = tempo,
                onValueChange = { tempo = it },
                onValueChangeFinished = { onTempo(tempo.roundToInt()) },
                valueRange = 30f..200f,
                modifier = Modifier.weight(1f),
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = showRecognized, onCheckedChange = onShowRecognized)
            Text("Erkannte Noten umrahmen", style = MaterialTheme.typography.bodyMedium)
        }
    }
}

/** Number of measures before each system, for a page-wide measure count. */
private fun measureOffsets(score: Score): IntArray {
    val out = IntArray(score.systems.size)
    var acc = 0
    for (s in score.systems.indices) {
        out[s] = acc
        acc += (score.events.filter { it.systemIndex == s }.maxOfOrNull { it.measureIndex } ?: -1) + 1
    }
    return out
}

/** Moves the cursor smoothly from the current event towards the next one on the same staff. */
private fun cursorX(score: Score, current: MusicEvent, tick: Int): Float {
    val next = score.events.firstOrNull {
        it.staffIndex == current.staffIndex && it.startTick >= current.endTick && it.systemIndex == current.systemIndex
    }
    val x0 = current.box.centerX
    if (next == null || current.durationTicks <= 0) return x0
    val f = ((tick - current.startTick).toFloat() / (next.startTick - current.startTick)).coerceIn(0f, 1f)
    return x0 + (next.box.centerX - x0) * f
}

private fun nearestEvent(score: Score, x: Float, y: Float, space: Float): MusicEvent? =
    score.events
        .map { e ->
            val dx = maxOf(e.box.left - x, 0f, x - e.box.right)
            val dy = maxOf(e.box.top - y, 0f, y - e.box.bottom)
            e to (dx * dx + dy * dy)
        }
        .filter { it.second <= (3 * space) * (3 * space) }
        .minByOrNull { it.second }
        ?.first
