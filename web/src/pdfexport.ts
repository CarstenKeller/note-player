// The sheets of a piece as one PDF file (one page per sheet), to keep or pass on.

import { db, type Piece } from './db';

/** A page: a JPEG picture and its size in pixels. */
export interface PdfPage {
  jpeg: Uint8Array;
  width: number;
  height: number;
}

const A4_SHORT = 595.28; // points

/**
 * A PDF with each picture on a page of its own, as wide (upright pictures) or as high (wide
 * pictures) as an A4 page.
 */
export function buildPdf(pages: PdfPage[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const put = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, body: () => void) => {
    offsets[n] = length;
    put(`${n} 0 obj\n`);
    body();
    put('\nendobj\n');
  };

  // objects: 1 catalog, 2 page tree, then per page: page, contents, picture
  const first = (i: number) => 3 + 3 * i;
  put('%PDF-1.4\n%');
  put(new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // marks the file as binary
  object(1, () => put('<< /Type /Catalog /Pages 2 0 R >>'));
  object(2, () => put(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${first(i)} 0 R`).join(' ')}] >>`));
  pages.forEach((p, i) => {
    const n = first(i);
    const scale = p.width <= p.height ? A4_SHORT / p.width : A4_SHORT / p.height;
    const w = (p.width * scale).toFixed(2);
    const h = (p.height * scale).toFixed(2);
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    object(n, () => put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`));
    object(n + 1, () => put(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    object(n + 2, () => {
      put(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      put(p.jpeg);
      put('\nendstream');
    });
  });
  const count = first(pages.length);
  const xref = length;
  put(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) put(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  put(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** A picture (JPEG, PNG, ...) as a JPEG page (drawn on white: transparent parts stay white). */
async function toPage(blob: Blob): Promise<PdfPage> {
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
    const page = { jpeg: new Uint8Array(await jpeg.arrayBuffer()), width: canvas.width, height: canvas.height };
    // free the canvas memory right away (Safari limits the total canvas size)
    canvas.width = canvas.height = 0;
    return page;
  } finally {
    bitmap.close();
  }
}

/** The sheets of [piece] as saved (photos, pages of the imported PDF, pasted text) in one PDF. */
export async function piecePdf(piece: Piece): Promise<Blob> {
  const pages: PdfPage[] = [];
  for (const id of piece.sheets) {
    const sheet = await db.sheet(id);
    if (sheet) pages.push(await toPage(sheet.blob));
  }
  if (pages.length === 0) throw new Error('Das Stück hat keine gespeicherten Blätter.');
  return new Blob([buildPdf(pages)], { type: 'application/pdf' });
}

/** File name for the PDF of a piece: "Name – Interpret.pdf", without characters files may not have. */
export function pdfName(piece: Piece): string {
  const base = piece.artist ? `${piece.name} – ${piece.artist}` : piece.name;
  return base.replace(/[\\/:*?"<>|]+/g, '_').trim() + '.pdf';
}
