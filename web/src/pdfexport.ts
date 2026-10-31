// The sheets of a piece as one PDF file (one page per sheet), to keep or pass on. Pages of an
// imported PDF are taken from the original file (sharp, with its text); photos and pasted text
// become pages with their picture.

import { db, type Original, type Piece } from './db';

/** A page of the new file: a page of an original PDF, or a JPEG picture. */
export type PdfPart =
  | { pdf: Uint8Array; page: number }
  | { jpeg: Uint8Array; width: number; height: number };

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
    const image = await out.embedJpg(part.jpeg);
    const scale = part.width <= part.height ? A4_SHORT / part.width : A4_SHORT / part.height;
    const w = part.width * scale;
    const h = part.height * scale;
    out.addPage([w, h]).drawImage(image, { x: 0, y: 0, width: w, height: h });
  }
  return out.save();
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
  for (const s of sheets) {
    const original = s.source && originals.get(s.source.original);
    if (s.source && original) {
      if (!bytes.has(original.id)) bytes.set(original.id, new Uint8Array(await original.blob.arrayBuffer()));
      parts.push({ pdf: bytes.get(original.id)!, page: s.source.page });
    } else {
      parts.push(await toJpeg(s.blob));
    }
  }
  return new Blob([await assemblePdf(parts, (i) => toJpeg(sheets[i].blob))], { type: 'application/pdf' });
}

/** File name for the PDF of a piece: "Name – Interpret.pdf", without characters files may not have. */
export function pdfName(piece: Piece): string {
  const base = piece.artist ? `${piece.name} – ${piece.artist}` : piece.name;
  return base.replace(/[\\/:*?"<>|]+/g, '_').trim() + '.pdf';
}
