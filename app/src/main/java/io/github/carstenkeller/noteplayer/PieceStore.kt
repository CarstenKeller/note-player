package io.github.carstenkeller.noteplayer

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** One sheet of a piece: a copy of the photo, picture or video in the app's storage. */
data class Sheet(val file: File, val video: Boolean)

/** A saved piece: its sheets in playing order. */
data class Piece(val id: String, val name: String, val created: Long, val sheets: List<Sheet>)

/**
 * Keeps the pieces that were opened, so they can be played again later. The pictures are copied
 * into the app's own storage (the originals may be deleted or come from the camera's cache);
 * the music is recognized again when a piece is opened.
 */
class PieceStore(private val context: Context) {
    private val root = File(context.filesDir, "pieces").apply { mkdirs() }

    fun list(): List<Piece> = (root.listFiles() ?: emptyArray())
        .mapNotNull { dir -> runCatching { read(dir) }.getOrNull() }
        .sortedByDescending { it.created }

    /** Saves a new piece from [uris] (pictures or videos, in playing order). */
    fun create(uris: List<Uri>): Piece {
        val created = System.currentTimeMillis()
        val id = created.toString()
        val dir = File(root, id).apply { mkdirs() }
        val name = "Stück vom " + SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.GERMANY).format(Date(created))
        val piece = Piece(id, name, created, emptyList())
        return try {
            write(piece.copy(sheets = uris.mapIndexed { i, uri -> copy(uri, dir, i) }))
        } catch (e: Exception) {
            dir.deleteRecursively()
            throw e
        }
    }

    fun addSheets(piece: Piece, uris: List<Uri>): Piece {
        val dir = File(root, piece.id)
        val start = nextNumber(piece)
        return write(piece.copy(sheets = piece.sheets + uris.mapIndexed { i, uri -> copy(uri, dir, start + i) }))
    }

    fun replaceSheet(piece: Piece, index: Int, uri: Uri): Piece {
        val sheet = copy(uri, File(root, piece.id), nextNumber(piece))
        val old = piece.sheets[index]
        val updated = write(piece.copy(sheets = piece.sheets.toMutableList().also { it[index] = sheet }))
        old.file.delete()
        return updated
    }

    fun removeSheet(piece: Piece, index: Int): Piece {
        val old = piece.sheets[index]
        val updated = write(piece.copy(sheets = piece.sheets.filterIndexed { i, _ -> i != index }))
        old.file.delete()
        return updated
    }

    fun rename(piece: Piece, name: String): Piece = write(piece.copy(name = name.trim().ifEmpty { piece.name }))

    fun delete(piece: Piece) {
        File(root, piece.id).deleteRecursively()
    }

    private fun nextNumber(piece: Piece): Int =
        (piece.sheets.mapNotNull { it.file.nameWithoutExtension.substringAfter("sheet_").toIntOrNull() }.maxOrNull() ?: -1) + 1

    private fun copy(uri: Uri, dir: File, number: Int): Sheet {
        val type = context.contentResolver.getType(uri).orEmpty()
        val video = type.startsWith("video/")
        val ext = when {
            video -> "mp4"
            type == "image/png" -> "png"
            else -> "jpg"
        }
        val file = File(dir, "sheet_$number.$ext")
        val input = context.contentResolver.openInputStream(uri) ?: error("Die Datei konnte nicht gelesen werden.")
        input.use { inp -> file.outputStream().use { inp.copyTo(it) } }
        return Sheet(file, video)
    }

    private fun write(piece: Piece): Piece {
        val json = JSONObject()
            .put("name", piece.name)
            .put("created", piece.created)
            .put("sheets", JSONArray().apply {
                for (s in piece.sheets) put(JSONObject().put("file", s.file.name).put("video", s.video))
            })
        val dir = File(root, piece.id)
        val tmp = File(dir, "piece.json.tmp")
        tmp.writeText(json.toString())
        tmp.renameTo(File(dir, "piece.json"))
        return piece
    }

    private fun read(dir: File): Piece {
        val json = JSONObject(File(dir, "piece.json").readText())
        val arr = json.getJSONArray("sheets")
        val sheets = (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            Sheet(File(dir, o.getString("file")), o.optBoolean("video"))
        }.filter { it.file.exists() }
        return Piece(dir.name, json.getString("name"), json.getLong("created"), sheets)
    }
}
