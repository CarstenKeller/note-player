package io.github.carstenkeller.noteplayer

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Color
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.carstenkeller.noteplayer.ui.ScoreScreen
import io.github.carstenkeller.noteplayer.ui.StartScreen

class MainActivity : ComponentActivity() {
    private val vm: PlayerViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) handleShare(intent)
        setContent {
            MaterialTheme(colorScheme = lightColorScheme(primary = Color(0xFF3E2C73), secondary = Color(0xFFE8833A))) {
                val screen by vm.screen.collectAsStateWithLifecycle()
                val playback by vm.playback.collectAsStateWithLifecycle()
                val pieces by vm.pieces.collectAsStateWithLifecycle()
                when (val s = screen) {
                    is ScreenState.Ready -> {
                        BackHandler { vm.back() }
                        ScoreScreen(
                            state = s,
                            playback = playback,
                            onPlayPause = vm::togglePlay,
                            onStop = vm::stop,
                            onTempo = vm::setTempo,
                            onIncludeVocals = vm::setIncludeVocals,
                            onInstrument = vm::setInstrument,
                            onBaseBpm = vm::setBaseBpm,
                            onSeek = vm::seekTo,
                            onBack = vm::back,
                            onAddPages = vm::addPages,
                            onReplaceSheet = vm::replaceSheet,
                            onRemoveSheet = vm::removeSheet,
                            onRename = { name -> vm.rename(s.piece, name) },
                        )
                    }
                    else -> StartScreen(
                        working = (s as? ScreenState.Working)?.message,
                        error = (s as? ScreenState.Failed)?.message,
                        pieces = pieces,
                        onOpen = { uris: List<Uri> -> vm.open(uris) },
                        onOpenPiece = { piece -> vm.open(piece) },
                        onRename = vm::rename,
                        onDelete = vm::delete,
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleShare(intent)
    }

    override fun onStop() {
        super.onStop()
        // keep the position, but do not play in the background
        if (vm.playback.value.playing) vm.togglePlay()
    }

    private fun handleShare(intent: Intent?) {
        val uris: List<Uri> = when (intent?.action) {
            Intent.ACTION_SEND -> listOfNotNull(
                if (Build.VERSION.SDK_INT >= 33) {
                    intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(Intent.EXTRA_STREAM)
                }
            )
            // several pictures shared at once: the sheets of one piece
            Intent.ACTION_SEND_MULTIPLE -> if (Build.VERSION.SDK_INT >= 33) {
                intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
            } else {
                @Suppress("DEPRECATION")
                intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty()
            }
            else -> emptyList()
        }
        if (uris.isNotEmpty()) vm.open(uris)
    }
}
