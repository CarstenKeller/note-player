package io.github.carstenkeller.noteplayer.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import java.io.File

@Composable
/** [working]: what is being done right now, or null. */
fun StartScreen(working: String?, error: String?, onImage: (Uri) -> Unit) {
    val context = LocalContext.current
    var pendingPhoto by rememberSaveable { mutableStateOf<String?>(null) }

    val takePicture = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val uri = pendingPhoto?.let(Uri::parse)
        if (ok && uri != null) onImage(uri)
    }
    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) onImage(uri)
    }
    val photoUri = remember {
        {
            val dir = File(context.cacheDir, "photos").apply { mkdirs() }
            val file = File(dir, "photo_${System.currentTimeMillis()}.jpg")
            FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        }
    }

    Surface(Modifier.fillMaxSize()) {
        Column(
            Modifier
                .safeDrawingPadding()
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Spacer(Modifier.height(24.dp))
            Text("Notenspieler", style = MaterialTheme.typography.headlineLarge, color = MaterialTheme.colorScheme.primary)
            Text(
                "Fotografiere ein Notenblatt oder wähle ein Bild oder ein Video aus, in dem Noten " +
                    "über den Bildschirm laufen. Die App erkennt die Noten, spielt sie vor und " +
                    "zeigt dabei an, wo du dich gerade befindest.",
                textAlign = TextAlign.Center,
            )
            if (working != null) {
                CircularProgressIndicator()
                Text(working, textAlign = TextAlign.Center)
            } else {
                Button(
                    onClick = {
                        val uri = photoUri()
                        pendingPhoto = uri.toString()
                        takePicture.launch(uri)
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Notenblatt fotografieren") }
                OutlinedButton(
                    onClick = { pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Bild auswählen") }
                OutlinedButton(
                    onClick = { pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.VideoOnly)) },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Video auswählen (scrollende Noten)") }
            }
            if (error != null) {
                Text(error, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center)
            }
            Spacer(Modifier.height(8.dp))
            Text("Tipps für gute Ergebnisse", style = MaterialTheme.typography.titleMedium)
            Text(
                "• Gedruckte Noten funktionieren, Handschrift nicht.\n" +
                    "• Senkrecht von oben fotografieren, Blatt möglichst flach und gleichmäßig beleuchtet.\n" +
                    "• Lieber eine halbe Seite scharf als eine ganze Seite unscharf.\n" +
                    "• Erkannt werden u. a. Violin-/Bassschlüssel, Vorzeichen, Ganze bis Sechzehntel, " +
                    "Punktierungen, Akkorde, einfache Pausen und Klaviersysteme.\n" +
                    "• Nicht erkannt werden u. a. Taktart, Triolen, Wiederholungen und " +
                    "mehrere Stimmen in einem System.\n" +
                    "• Videos: Die Noten sollten gleichmäßig nach oben oder zur Seite laufen und " +
                    "groß genug sein. Farbige Markierungen (Cursor, hervorgehobene Noten) werden " +
                    "herausgerechnet, wo die Stelle auch ohne Markierung zu sehen ist.",
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}
