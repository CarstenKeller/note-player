// The sheets of a piece as one PDF file, to keep or pass on. Pages of an imported PDF are taken
// from the original file (sharp, with its text); photos, scans and pasted text are cut between
// their systems and set on A4 pages with staves of one size, aligned on the left (sheetlayout).

import { db, type Original, type Piece, type Sheet } from './db';
import { recognizeSheet } from './engine';
import { columnsOf, cutSheet, layoutCuts, musicRows, A4, type Cut, type SheetGeometry } from './sheetlayout';

/** A JPEG picture on an A4 page: position and size in millimetres from the top left corner. */
export interface PlacedJpeg { jpeg: Uint8Array; x: number; y: number; w: number; h: number }

/** A page of the new file: a page of an original PDF, a JPEG picture, or an A4 page of pictures. */
export type PdfPart =
  | { pdf: Uint8Array; page: number }
  | { jpeg: Uint8Array; width: number; height: number }
  | { a4: PlacedJpeg[] };

const PT_PER_MM = 72 / 25.4;

const A4_SHORT = 595.28; // points

type JpegPart = Extract<PdfPart, { jpeg: Uint8Array }>;

/**
 * One PDF of the parts. A picture fills a page as wide (upright pictures) or as high (wide
 * pictures) as an A4 page. The pages of an encrypted PDF cannot be copied: for them
 * [picture] gives the picture of part number i.
 */
export async function assemblePdf(parts: PdfPart[], picture?: (i: number) => Promise<JpegPart>): Promise<Uint8Array> {
  // loaded only when needed
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  /** The original files read (null: encrypted or unreadable, its pages become pictures). */
  const sources = new Map<Uint8Array, Awaited<ReturnType<typeof PDFDocument.load>> | null>();
  for (const [i, given] of parts.entries()) {
    let part = given;
    if ('pdf' in part) {
      if (!sources.has(part.pdf)) {
        const src = await PDFDocument.load(part.pdf, { ignoreEncryption: true }).catch(() => null);
        sources.set(part.pdf, src && (!src.isEncrypted || !picture) ? src : null);
      }
      const src = sources.get(part.pdf);
      if (src) {
        const [page] = await out.copyPages(src, [part.page - 1]);
        out.addPage(page);
        continue;
      }
      if (!picture) throw new Error('Das Original-PDF kann nicht gelesen werden.');
      part = await picture(i);
    }
    if ('a4' in part) {
      const page = out.addPage([A4.width * PT_PER_MM, A4.height * PT_PER_MM]);
      for (const p of part.a4) {
        const image = await out.embedJpg(p.jpeg);
        page.drawImage(image, {
          x: p.x * PT_PER_MM, y: (A4.height - p.y - p.h) * PT_PER_MM, width: p.w * PT_PER_MM, height: p.h * PT_PER_MM,
        });
      }
      continue;
    }
    const image = await out.embedJpg(part.jpeg);
    const scale = part.width <= part.height ? A4_SHORT / part.width : A4_SHORT / part.height;
    const w = part.width * scale;
    const h = part.height * scale;
    out.addPage([w, h]).drawImage(image, { x: 0, y: 0, width: w, height: h });
  }
  return out.save();
}

/** The recognized (straightened) page of a sheet and how it is cut; null: no picture. */
async function geometryOf(sheet: Sheet): Promise<{ picture: Blob; g: SheetGeometry } | null> {
  let picture: Blob = sheet.blob;
  let rows: SheetGeometry['rows'] = [];
  let staffSpace = 0;
  /** Width the recognition measures in (the picture may have another size). */
  let measured = 0;
  try {
    const shown = await recognizeSheet(sheet.id);
    URL.revokeObjectURL(shown.url);
    const rec = await db.result(sheet.id);
    if (rec) picture = rec.page;
    measured = shown.width;
    staffSpace = shown.result.staffSpace;
    rows = musicRows(shown.result.score.staves, shown.result.tabs ?? [], staffSpace);
  } catch {
    // not recognized: the picture as it is
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(picture);
  } catch {
    return null;
  }
  try {
    const { width, height } = bitmap;
    // into pixels of the picture
    if (measured > 0 && measured !== width) {
      const f = width / measured;
      staffSpace *= f;
      rows = rows.map((r) => [r[0] * f, r[1] * f, r[2] * f, r[3] * f]);
    }
    // share of dark pixels per row, read from a smaller copy
    const [x0, x1] = columnsOf(rows, staffSpace, width);
    const k = Math.min(1, 1000 / (x1 - x0));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((x1 - x0) * k));
    canvas.height = Math.max(1, Math.round(height * k));
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, x0, 0, x1 - x0, height, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    canvas.width = canvas.height = 0;
    const small = new Float32Array(Math.round(height * k));
    const w = Math.round((x1 - x0) * k);
    for (let y = 0; y < small.length; y++) {
      let dark = 0;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (data[i] + data[i + 1] + data[i + 2] < 3 * 140) dark++;
      }
      small[y] = dark / w;
    }
    const ink = new Float32Array(height);
    for (let y = 0; y < height; y++) ink[y] = small[Math.min(small.length - 1, Math.floor(y * k))];
    return { picture, g: { width, height, staffSpace, rows, ink } };
  } finally {
    bitmap.close();
  }
}

/** A cut of a picture as JPEG. */
async function cutJpeg(bitmap: ImageBitmap, c: Cut): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(c.x1 - c.x0));
  canvas.height = Math.max(1, Math.round(c.y1 - c.y0));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, c.x0, c.y0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  const jpeg = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Das Blatt konnte nicht umgewandelt werden.'))), 'image/jpeg', 0.9));
  canvas.width = canvas.height = 0;
  return new Uint8Array(await jpeg.arrayBuffer());
}

/** Sheets without original PDF, cut between their systems and set on A4 pages. */
async function laidOut(sheets: Sheet[], keepHead: boolean): Promise<PdfPart[]> {
  const items: { picture: Blob; g: SheetGeometry; cuts: Cut[] }[] = [];
  for (const s of sheets) {
    const geo = await geometryOf(s);
    if (geo) items.push({ ...geo, cuts: cutSheet(geo.g, keepHead && items.length === 0) });
  }
  const pages = layoutCuts(items);
  const parts: PdfPart[] = [];
  // one picture in memory at a time (the cuts come in the order of the sheets)
  let open = null as { index: number; bitmap: ImageBitmap } | null;
  try {
    for (const page of pages) {
      const a4: PlacedJpeg[] = [];
      for (const p of page) {
        if (open?.index !== p.sheet) {
          open?.bitmap.close();
          open = { index: p.sheet, bitmap: await createImageBitmap(items[p.sheet].picture) };
        }
        a4.push({ jpeg: await cutJpeg(open.bitmap, p.cut), x: p.x, y: p.y, w: p.w, h: p.h });
      }
      parts.push({ a4 });
    }
  } finally {
    open?.bitmap.close();
  }
  return parts;
}

/** A picture (JPEG, PNG, ...) as a JPEG (drawn on white: transparent parts stay white). */
async function toJpeg(blob: Blob): Promise<JpegPart> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    const jpeg = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Das Blatt konnte nicht umgewandelt werden.'))), 'image/jpeg', 0.9));
    const part = { jpeg: new Uint8Array(await jpeg.arrayBuffer()), width: canvas.width, height: canvas.height };
    // free the canvas memory right away (Safari limits the total canvas size)
    canvas.width = canvas.height = 0;
    return part;
  } finally {
    bitmap.close();
  }
}

/** The sheets of [piece] in one PDF (the original file itself when the piece is just that). */
export async function piecePdf(piece: Piece): Promise<Blob> {
  const sheets = (await Promise.all(piece.sheets.map((id) => db.sheet(id)))).filter((s) => s !== undefined);
  if (sheets.length === 0) throw new Error('Das Stück hat keine gespeicherten Blätter.');
  const originals = new Map<string, Original | undefined>();
  for (const s of sheets) if (s.source && !originals.has(s.source.original)) originals.set(s.source.original, await db.original(s.source.original));

  // all pages of one imported PDF in their order: that file, as it was
  const only = sheets[0].source && originals.get(sheets[0].source.original);
  if (only && sheets.length === only.pages && sheets.every((s, i) => s.source?.original === only.id && s.source.page === i + 1)) {
    return only.blob;
  }

  const bytes = new Map<string, Uint8Array>();
  const parts: PdfPart[] = [];
  /** The pictures of each part (for a page of an encrypted PDF that cannot be copied). */
  const sheetOfPart: Sheet[] = [];
  // sheets without original one after the other are laid out together
  let run: Sheet[] = [];
  const flush = async () => {
    if (run.length === 0) return;
    for (const p of await laidOut(run, sheets[0] === run[0])) {
      parts.push(p);
      sheetOfPart.push(run[0]);
    }
    run = [];
  };
  for (const s of sheets) {
    const original = s.source && originals.get(s.source.original);
    if (s.source && original) {
      await flush();
      if (!bytes.has(original.id)) bytes.set(original.id, new Uint8Array(await original.blob.arrayBuffer()));
      parts.push({ pdf: bytes.get(original.id)!, page: s.source.page });
      sheetOfPart.push(s);
    } else {
      run.push(s);
    }
  }
  await flush();
  return new Blob([await assemblePdf(parts, (i) => toJpeg(sheetOfPart[i].blob))], { type: 'application/pdf' });
}

/** File name for the PDF of a piece: "Name – Interpret.pdf", without characters files may not have. */
export function pdfName(piece: Piece): string {
  const base = piece.artist ? `${piece.name} – ${piece.artist}` : piece.name;
  return base.replace(/[\\/:*?"<>|]+/g, '_').trim() + '.pdf';
}
