package io.github.carstenkeller.noteplayer.ui

import androidx.compose.animation.core.animate
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
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
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import io.github.carstenkeller.noteplayer.PlaybackState
import io.github.carstenkeller.noteplayer.ScreenState
import io.github.carstenkeller.noteplayer.omr.MusicEvent
import io.github.carstenkeller.noteplayer.omr.Score
import io.github.carstenkeller.noteplayer.score
import kotlin.math.min
import kotlin.math.roundToInt

private val Highlight = Color(0xFFE8833A)
private val Recognized = Color(0xFF2F6FDE)
private val RestColor = Color(0xFF7A7A7A)

private const val MAX_ZOOM = 6f

/** After the user moved the view, automatic following pauses for this long. */
private const val FOLLOW_PAUSE_MS = 4000L

@Composable
fun ScoreScreen(
    state: ScreenState.Ready,
    playback: PlaybackState,
    onPlayPause: () -> Unit,
    onStop: () -> Unit,
    onTempo: (Int) -> Unit,
    onIncludeVocals: (Boolean) -> Unit,
    onSeek: (MusicEvent) -> Unit,
    onBack: () -> Unit,
) {
    val score = state.score(playback)
    val page = remember(state.page) { state.page.asImageBitmap() }
    var showRecognized by rememberSaveable { mutableStateOf(true) }
    val tick = playback.tick
    // the cursor follows notes only: rests (especially whole-measure rests) sit elsewhere in the measure
    val current = remember(tick, score) {
        if (tick < 0) null else score.events.lastOrNull { !it.isRest && it.startTick <= tick }
            ?: score.events.lastOrNull { it.startTick <= tick }
    }
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
                        "Zeile ${it.systemIndex + 1} · Takt ${measureOffsets[it.systemIndex] + it.measureIndex + 1}"
                    } ?: "Note antippen = Startpunkt · zwei Finger = zoomen"
                    Text(position, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
                }
            }
            for (w in state.result.warnings) {
                Text(w, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 16.dp))
            }

            ZoomableScore(
                score = score,
                page = page,
                space = state.result.staffSpace.toFloat(),
                current = current,
                sounding = sounding,
                tick = tick,
                showRecognized = showRecognized,
                onSeek = onSeek,
                modifier = Modifier.weight(1f).fillMaxWidth(),
            )

            Controls(
                playback = playback,
                enabled = score.events.isNotEmpty(),
                hasVocals = state.result.hasVocals,
                showRecognized = showRecognized,
                onShowRecognized = { showRecognized = it },
                onPlayPause = onPlayPause,
                onStop = onStop,
                onTempo = onTempo,
                onIncludeVocals = onIncludeVocals,
            )
        }
    }
}

/**
 * The page with markings. Two fingers zoom and move, one finger moves, a double tap zooms
 * in or back out, a tap on a note sets the start point. While playing, the view follows
 * the current position unless the user has just moved it.
 */
@Composable
private fun ZoomableScore(
    score: Score,
    page: androidx.compose.ui.graphics.ImageBitmap,
    space: Float,
    current: MusicEvent?,
    sounding: List<MusicEvent>,
    tick: Int,
    showRecognized: Boolean,
    onSeek: (MusicEvent) -> Unit,
    modifier: Modifier,
) {
    BoxWithConstraints(modifier.clipToBounds()) {
        val viewW = constraints.maxWidth.toFloat()
        val viewH = constraints.maxHeight.toFloat()
        val fit = viewW / page.width
        var zoom by remember { mutableFloatStateOf(1f) }
        var offset by remember { mutableStateOf(Offset.Zero) }
        var lastUserMove by remember { mutableLongStateOf(0L) }

        fun clamp(o: Offset, z: Float): Offset {
            val w = page.width * fit * z
            val h = page.height * fit * z
            return Offset(o.x.coerceIn(min(0f, viewW - w), 0f), o.y.coerceIn(min(0f, viewH - h), 0f))
        }

        fun zoomAround(focus: Offset, newZoom: Float) {
            val z = newZoom.coerceIn(1f, MAX_ZOOM)
            offset = clamp((offset - focus) * (z / zoom) + focus, z)
            zoom = z
        }

        // follow the playback position
        LaunchedEffect(current, viewW, viewH) {
            val ev = current ?: return@LaunchedEffect
            if (System.currentTimeMillis() - lastUserMove < FOLLOW_PAUSE_MS) return@LaunchedEffect
            val sys = score.systems.firstOrNull { it.index == ev.systemIndex }?.box ?: return@LaunchedEffect
            val s = fit * zoom
            val top = (sys.top - 4 * space) * s
            val bottom = (sys.bottom + 4 * space) * s
            val x = cursorX(score, ev, tick) * s
            var target = offset
            if (top + offset.y < 0 || bottom + offset.y > viewH) {
                target = target.copy(y = -(top - (if (bottom - top < viewH) viewH * 0.1f else 0f)))
            }
            if (x + offset.x < viewW * 0.1f || x + offset.x > viewW * 0.9f) {
                target = target.copy(x = -(x - viewW * 0.3f))
            }
            target = clamp(target, zoom)
            if (target == offset) return@LaunchedEffect
            val from = offset
            animate(0f, 1f, animationSpec = tween(350)) { f, _ ->
                offset = from + (target - from) * f
            }
        }

        Canvas(
            Modifier
                .fillMaxSize()
                .pointerInput(fit, viewW, viewH) {
                    detectTransformGestures { centroid, pan, gestureZoom, _ ->
                        lastUserMove = System.currentTimeMillis()
                        zoomAround(centroid, zoom * gestureZoom)
                        offset = clamp(offset + pan, zoom)
                    }
                }
                .pointerInput(score, fit, viewW, viewH) {
                    detectTapGestures(
                        onDoubleTap = { p ->
                            lastUserMove = System.currentTimeMillis()
                            zoomAround(p, if (zoom > 1.2f) 1f else 2.5f)
                        },
                        onTap = { p ->
                            val s = fit * zoom
                            nearestEvent(score, (p.x - offset.x) / s, (p.y - offset.y) / s, space)?.let(onSeek)
                        },
                    )
                }
        ) {
            val s = fit * zoom
            // strokes are given in screen pixels and divided by the scale
            fun px(v: Float) = v / s
            withTransform({
                translate(offset.x, offset.y)
                scale(s, s, pivot = Offset.Zero)
            }) {
                drawImage(
                    page,
                    srcOffset = IntOffset.Zero,
                    srcSize = IntSize(page.width, page.height),
                    dstOffset = IntOffset.Zero,
                    dstSize = IntSize(page.width, page.height),
                    filterQuality = FilterQuality.Medium,
                )
                val sys = current?.let { c -> score.systems.firstOrNull { it.index == c.systemIndex }?.box }
                if (current != null && sys != null) {
                    drawRect(
                        color = Highlight.copy(alpha = 0.08f),
                        topLeft = Offset(sys.left - space, sys.top - 3 * space),
                        size = Size(sys.right - sys.left + 2 * space, sys.bottom - sys.top + 6 * space),
                    )
                    val x = cursorX(score, current, tick)
                    drawLine(
                        Highlight,
                        Offset(x, sys.top - 3 * space),
                        Offset(x, sys.bottom + 3 * space),
                        strokeWidth = px(3.dp.toPx()),
                    )
                }
                if (showRecognized) {
                    for (e in score.events) {
                        drawRect(
                            color = if (e.isRest) RestColor else Recognized,
                            topLeft = Offset(e.box.left - 0.15f * space, e.box.top - 0.15f * space),
                            size = Size(e.box.right - e.box.left + 0.3f * space, e.box.bottom - e.box.top + 0.3f * space),
                            style = Stroke(px(1.dp.toPx())),
                            alpha = 0.6f,
                        )
                    }
                }
                for (e in sounding) {
                    val tl = Offset(e.box.left - 0.3f * space, e.box.top - 0.3f * space)
                    val sz = Size(e.box.right - e.box.left + 0.6f * space, e.box.bottom - e.box.top + 0.6f * space)
                    drawRect(Highlight.copy(alpha = 0.35f), tl, sz)
                    drawRect(Highlight, tl, sz, style = Stroke(px(2.dp.toPx())))
                }
            }
        }
    }
}

@Composable
private fun Controls(
    playback: PlaybackState,
    enabled: Boolean,
    hasVocals: Boolean,
    showRecognized: Boolean,
    onShowRecognized: (Boolean) -> Unit,
    onPlayPause: () -> Unit,
    onStop: () -> Unit,
    onTempo: (Int) -> Unit,
    onIncludeVocals: (Boolean) -> Unit,
) {
    var tempo by remember(playback.tempoPercent) { mutableFloatStateOf(playback.tempoPercent.toFloat()) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = onPlayPause, enabled = enabled, modifier = Modifier.width(140.dp)) {
                Text(if (playback.playing) "❚❚ Pause" else "▶ Abspielen")
            }
            OutlinedButton(onClick = onStop, enabled = enabled) { Text("■ Stopp") }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Tempo ${tempo.roundToInt()} %", modifier = Modifier.width(100.dp), style = MaterialTheme.typography.bodyMedium)
            Slider(
                value = tempo,
                onValueChange = { tempo = (it / 5).roundToInt() * 5f },
                onValueChangeFinished = { onTempo(tempo.roundToInt()) },
                valueRange = 25f..200f,
                modifier = Modifier.weight(1f),
            )
        }
        if (hasVocals) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = playback.includeVocals, onCheckedChange = onIncludeVocals)
                Text("Gesangsstimme (mit Liedtext) abspielen", style = MaterialTheme.typography.bodyMedium)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = showRecognized, onCheckedChange = onShowRecognized)
            Text("Erkannte Noten umrahmen", style = MaterialTheme.typography.bodyMedium)
        }
    }
}

/** Number of measures before each system, for a page-wide measure count. */
private fun measureOffsets(score: Score): IntArray {
    val out = IntArray(score.systems.maxOfOrNull { it.index + 1 } ?: 0)
    var acc = 0
    for (s in out.indices) {
        out[s] = acc
        acc += (score.events.filter { it.systemIndex == s }.maxOfOrNull { it.measureIndex } ?: -1) + 1
    }
    return out
}

/** Moves the cursor smoothly from the current event towards the next one on the same staff. */
private fun cursorX(score: Score, current: MusicEvent, tick: Int): Float {
    // the next note of the line (any staff), so the cursor moves steadily to the right
    val next = score.events.firstOrNull {
        !it.isRest && it.startTick > current.startTick && it.systemIndex == current.systemIndex
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
