// Making the stored photos smaller without changing what is read from them: the recognition
// reads a photo in grey and no larger than its working size. Stored like that, without loss
// (a grey PNG), it reads exactly the same pixels. That is smaller for screenshots and pictures
// saved as PNG, not for photos from a camera (JPEG): those stay as they are. A picture is only
// replaced when its recognition, done again, gives exactly the same notes.

import { zlibSync } from 'fflate';
import { db, type Recognized, type Sheet } from './db';
import { ENGINE, recognizeBlob } from './engine';
import { maxSideFor } from './worksize';

/** The size the recognition makes a picture smaller to (as GrayImage.downscaled in the core). */
export function workingSize(width: number, height: number): { w: number; h: number } {
  const maxSide = maxSideFor(width, height);
  const long = Math.max(width, height);
  if (long <= maxSide) return { w: width, h: height };
  const scale = maxSide / long;
  return { w: Math.max(1, Math.floor(width * scale)), h: Math.max(1, Math.floor(height * scale)) };
}

/**
 * Grey values of an RGBA picture, made smaller to [w] x [h] by averaging boxes of pixels, as the
 * recognition does (grey as in the worker, boxes as in GrayImage.downscaled).
 */
export function greyDownscaled(rgba: Uint8ClampedArray, width: number, height: number, w: number, h: number): Uint8ClampedArray {
  const grey = new Int32Array(width * height);
  for (let i = 0, j = 0; i < grey.length; i++, j += 4) grey[i] = ((rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000) | 0;
  if (w === width && h === height) return Uint8ClampedArray.from(grey);
  const scale = w / width;
  const out = new Uint8ClampedArray(w * h);
  for (let ny = 0; ny < h; ny++) {
    const sy0 = Math.floor(ny / scale);
    const sy1 = Math.min(height, Math.max(sy0 + 1, Math.floor((ny + 1) / scale)));
    for (let nx = 0; nx < w; nx++) {
      const sx0 = Math.floor(nx / scale);
      const sx1 = Math.min(width, Math.max(sx0 + 1, Math.floor((nx + 1) / scale)));
      let sum = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        const row = sy * width;
        for (let sx = sx0; sx < sx1; sx++) sum += grey[row + sx];
      }
      out[ny * w + nx] = Math.floor(sum / ((sy1 - sy0) * (sx1 - sx0)));
    }
  }
  return out;
}

/** A PNG of 8-bit grey pixels (each row with the filter that leaves the least to pack). */
export function greyPng(grey: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const raw = new Uint8Array((w + 1) * h);
  const filtered = new Uint8Array(w);
  for (let y = 0; y < h; y++) {
    const row = grey.subarray(y * w, (y + 1) * w);
    const up = y > 0 ? grey.subarray((y - 1) * w, y * w) : null;
    let best = 0;
    let bestCost = Infinity;
    let bestRow = row as Uint8Array | Uint8ClampedArray;
    for (let f = 0; f <= 4; f++) {
      let cost = 0;
      for (let x = 0; x < w; x++) {
        const a = x > 0 ? row[x - 1] : 0;
        const b = up ? up[x] : 0;
        const c = up && x > 0 ? up[x - 1] : 0;
        let pred = 0;
        if (f === 1) pred = a;
        else if (f === 2) pred = b;
        else if (f === 3) pred = (a + b) >> 1;
        else if (f === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        const v = (row[x] - pred) & 255;
        filtered[x] = v;
        cost += v < 128 ? v : 256 - v;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = f;
        bestRow = filtered.slice();
      }
    }
    raw[y * (w + 1)] = best;
    raw.set(best === 0 ? row : bestRow, y * (w + 1) + 1);
  }
  const data = zlibSync(raw, { level: 9 });
  const chunk = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
    return out;
  };
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, w);
  hv.setUint32(4, h);
  header[8] = 8; // bits
  header[9] = 0; // grey
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', data), chunk('IEND', new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  return png;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The photo as the recognition sees it: grey, at its working size, without loss (PNG). */
async function smaller(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  // transparent parts count as paper (as in the worker)
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const rgba = ctx.getImageData(0, 0, width, height).data;
  canvas.width = canvas.height = 0;
  const { w, h } = workingSize(width, height);
  return new Blob([greyPng(greyDownscaled(rgba, width, height, w, h), w, h)], { type: 'image/png' });
}

/** What is read from a sheet: staves and all notes (with the time, length and pitches). */
function reading(json: string): string {
  const r = JSON.parse(json);
  const notes = (s: { staves: { clef: string; key: number }[]; events: { start: number; duration: number; pitches: number[]; holds: number[]; staff: number }[] }) =>
    [s.staves.map((st) => `${st.clef}${st.key}`).join(','), ...s.events.map((e) => `${e.start}/${e.duration}/${e.staff}/${[...e.pitches].sort().join('+')}/${[...e.holds].sort().join('+')}`)].join(' ');
  return `${notes(r.score)} | ${notes(r.withoutVocals)} | ${(r.tabs ?? []).length}`;
}

export interface OptimizeResult { before: number; after: number; smaller: number; kept: number }

/** The photos that may be made smaller: pictures (not pages of a PDF, not pasted text). */
const isPhoto = (s: Sheet) => !s.source && s.kind !== 'text' && s.kind !== 'pdf';

/**
 * Makes the photos of the library smaller where that changes nothing that is read from them
 * (each one is recognized again and compared). [progress] gets the number done and of all.
 */
export async function optimizePhotos(progress: (done: number, of: number) => void): Promise<OptimizeResult> {
  const ids = (await db.pieces()).flatMap((p) => p.sheets);
  const sheets: Sheet[] = [];
  for (const id of ids) {
    const s = await db.sheet(id);
    if (s && isPhoto(s) && !s.optimized) sheets.push(s);
  }
  const result: OptimizeResult = { before: 0, after: 0, smaller: 0, kept: 0 };
  for (const [k, s] of sheets.entries()) {
    progress(k, sheets.length);
    result.before += s.blob.size;
    let kept = true;
    try {
      const small = await smaller(s.blob);
      if (small.size < 0.9 * s.blob.size) {
        // what is read from the original (from the cache when it is current) and from the smaller one
        const cached = await db.result(s.id);
        const original = cached && cached.engine === ENGINE ? cached : { ...(await recognizeBlob(s.blob)), id: s.id, engine: ENGINE } as Recognized;
        const fromSmall = await recognizeBlob(small);
        if (reading(fromSmall.json) === reading(original.json)) {
          await db.saveSheet({ ...s, blob: small, optimized: true });
          await db.saveResult({ id: s.id, engine: ENGINE, width: fromSmall.width, height: fromSmall.height, page: fromSmall.page, json: fromSmall.json, ocr: cached?.ocr, ocrVersion: cached?.ocrVersion });
          result.after += small.size;
          result.smaller++;
          kept = false;
        }
      }
    } catch {
      // stays as it is
    }
    if (kept) {
      // tried once: not again (unless it is replaced)
      await db.saveSheet({ ...s, optimized: true });
      result.after += s.blob.size;
      result.kept++;
    }
  }
  progress(sheets.length, sheets.length);
  return result;
}

/** How much the library takes, by kind (bytes). */
export interface LibrarySize {
  pieces: number;
  photos: number;
  pdfPages: number;
  originals: number;
  recognized: number;
  covers: number;
  /** What the browser counts for the app altogether (may be missing). */
  usage?: number;
}

export async function librarySize(): Promise<LibrarySize> {
  const pieces = await db.pieces();
  const size: LibrarySize = { pieces: pieces.length, photos: 0, pdfPages: 0, originals: 0, recognized: 0, covers: 0 };
  const originals = new Set<string>();
  for (const id of pieces.flatMap((p) => p.sheets)) {
    const s = await db.sheet(id);
    if (!s) continue;
    if (s.source) {
      size.pdfPages += s.blob.size;
      if (!originals.has(s.source.original)) {
        originals.add(s.source.original);
        size.originals += (await db.original(s.source.original))?.blob.size ?? 0;
      }
    } else size.photos += s.blob.size;
    const r = await db.result(id);
    if (r) size.recognized += r.page.size + r.json.length;
  }
  for (const c of await db.covers()) size.covers += (c.blob?.size ?? 0) + (c.sheetThumb?.size ?? 0);
  try {
    size.usage = (await navigator.storage?.estimate?.())?.usage;
  } catch {
    // not known
  }
  return size;
}
