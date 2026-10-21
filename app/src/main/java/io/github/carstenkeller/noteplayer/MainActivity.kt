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
                            onSeek = vm::seekTo,
                            onBack = vm::back,
                        )
                    }
                    else -> StartScreen(
                        working = s is ScreenState.Working,
                        error = (s as? ScreenState.Failed)?.message,
                        onImage = vm::open,
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
        if (intent?.action != Intent.ACTION_SEND) return
        val uri: Uri? = if (Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(Intent.EXTRA_STREAM)
        }
        if (uri != null) vm.open(uri)
    }
}
