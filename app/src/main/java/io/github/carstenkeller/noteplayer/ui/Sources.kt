package io.github.carstenkeller.noteplayer.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.FileProvider
import java.io.File

/** Ways to get sheets of music into the app: camera, pictures (one or more), video. */
class SourcePickers(val takePhoto: () -> Unit, val pickImages: () -> Unit, val pickVideo: () -> Unit)

/** Most pictures that can be chosen at once (one per sheet). */
private const val MAX_PICTURES = 20

@Composable
fun rememberSourcePickers(onUris: (List<Uri>) -> Unit): SourcePickers {
    val context = LocalContext.current
    var pendingPhoto by rememberSaveable { mutableStateOf<String?>(null) }

    val takePicture = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val uri = pendingPhoto?.let(Uri::parse)
        if (ok && uri != null) onUris(listOf(uri))
    }
    // the pictures come in the order in which they were chosen
    val pickImages = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(MAX_PICTURES)) { uris ->
        if (uris.isNotEmpty()) onUris(uris)
    }
    val pickVideo = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) onUris(listOf(uri))
    }
    return remember(takePicture, pickImages, pickVideo) {
        SourcePickers(
            takePhoto = {
                val dir = File(context.cacheDir, "photos").apply { mkdirs() }
                val file = File(dir, "photo_${System.currentTimeMillis()}.jpg")
                val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
                pendingPhoto = uri.toString()
                takePicture.launch(uri)
            },
            pickImages = { pickImages.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
            pickVideo = { pickVideo.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.VideoOnly)) },
        )
    }
}
