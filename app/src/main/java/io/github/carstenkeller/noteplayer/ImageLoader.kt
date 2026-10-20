package io.github.carstenkeller.noteplayer

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import io.github.carstenkeller.noteplayer.omr.GrayImage

object ImageLoader {

    /** Decodes [uri] as grayscale, honoring the EXIF orientation of camera photos. */
    fun loadGray(context: Context, uri: Uri, maxSide: Int = 2400): GrayImage {
        val resolver = context.contentResolver
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, bounds) }
        require(bounds.outWidth > 0 && bounds.outHeight > 0) { "Das Bild konnte nicht gelesen werden." }

        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        var bitmap = resolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, opts) }
            ?: error("Das Bild konnte nicht gelesen werden.")

        val rotation = resolver.openInputStream(uri).use { stream ->
            if (stream == null) 0 else when (ExifInterface(stream).getAttributeInt(
                ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90
                ExifInterface.ORIENTATION_ROTATE_180 -> 180
                ExifInterface.ORIENTATION_ROTATE_270 -> 270
                else -> 0
            }
        }
        if (rotation != 0) {
            val m = Matrix().apply { postRotate(rotation.toFloat()) }
            val rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, m, true)
            if (rotated != bitmap) bitmap.recycle()
            bitmap = rotated
        }

        val w = bitmap.width
        val h = bitmap.height
        val argb = IntArray(w * h)
        bitmap.getPixels(argb, 0, w, 0, 0, w, h)
        bitmap.recycle()
        for (i in argb.indices) {
            val c = argb[i]
            val r = (c shr 16) and 0xFF
            val g = (c shr 8) and 0xFF
            val b = c and 0xFF
            argb[i] = (r * 299 + g * 587 + b * 114) / 1000
        }
        return GrayImage(w, h, argb)
    }

    fun toBitmap(img: GrayImage): Bitmap {
        val colors = IntArray(img.width * img.height)
        for (i in colors.indices) {
            val v = img.pixels[i]
            colors[i] = (0xFF shl 24) or (v shl 16) or (v shl 8) or v
        }
        return Bitmap.createBitmap(colors, img.width, img.height, Bitmap.Config.ARGB_8888)
    }
}
