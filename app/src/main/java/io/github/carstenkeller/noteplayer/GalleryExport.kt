package io.github.carstenkeller.noteplayer

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.annotation.RequiresApi

/** Saves the photos (or videos) of sheets into the gallery, in the album "Notenspieler". */
object GalleryExport {
    const val ALBUM = "Notenspieler"

    /** Whether this Android version can save into the gallery without asking for a permission. */
    val supported: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q

    /** Copies [sheet] into the gallery; [name] becomes the file name (without extension). */
    @RequiresApi(Build.VERSION_CODES.Q)
    fun save(context: Context, sheet: Sheet, name: String) {
        val ext = sheet.file.extension.ifEmpty { "jpg" }
        val mime = when {
            sheet.video -> "video/mp4"
            ext == "png" -> "image/png"
            else -> "image/jpeg"
        }
        val collection = if (sheet.video) {
            MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        } else {
            MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        }
        val dir = if (sheet.video) Environment.DIRECTORY_MOVIES else Environment.DIRECTORY_PICTURES
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, "${safe(name)}.$ext")
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, "$dir/$ALBUM")
            // hidden from the gallery until the copy is complete
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val resolver = context.contentResolver
        val uri = resolver.insert(collection, values) ?: error("Die Galerie hat das Speichern abgelehnt.")
        try {
            val out = resolver.openOutputStream(uri) ?: error("Die Galerie hat das Speichern abgelehnt.")
            out.use { o -> sheet.file.inputStream().use { it.copyTo(o) } }
            resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
        } catch (e: Exception) {
            resolver.delete(uri, null, null)
            throw e
        }
    }

    /** A file name without characters that file systems do not allow. */
    private fun safe(name: String) = name.replace(Regex("[\\\\/:*?\"<>|]"), "_").trim().ifEmpty { "Blatt" }
}
