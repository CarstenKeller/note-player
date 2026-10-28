// Turns chosen files (photos, pictures, PDFs) into sheets. Each page of a PDF becomes a sheet.

import { db, newId, type Sheet } from './db';
import type { TextPiece } from './guitar/text';

/** Pages of a PDF are drawn so that their short side has about this many pixels. */
const PDF_SHORT_SIDE = 2400;

export type Progress = (message: string) => void;

const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

export function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
}

async function pdfPages(file: File, progress: Progress): Promise<Sheet[]> {
  progress('PDF wird geöffnet …');
  // loaded only when needed (large)
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const sheets: Sheet[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      progress(`PDF-Seite ${n} von ${doc.numPages} wird gelesen …`);
      const page = await doc.getPage(n);
      const unit = page.getViewport({ scale: 1 });
      const scale = PDF_SHORT_SIDE / Math.min(unit.width, unit.height);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      // the text layer (chord names, text tabs) with positions in the picture
      const text: TextPiece[] = [];
      for (const item of (await page.getTextContent()).items) {
        if (!('str' in item)) continue;
        // music fonts come as control characters: left out
        const str = item.str.replace(/[\u0000-\u001f\uE000-\uF8FF]/g, '');
        if (!str.trim()) continue;
        const tx = pdfjs.Util.transform(viewport.transform, item.transform);
        if (Math.abs(tx[1]) > 0.01 * Math.abs(tx[0])) continue; // turned text
        const size = Math.hypot(tx[2], tx[3]);
        const x0 = tx[4];
        text.push({ str, x0, x1: x0 + (item.width * scale * str.length) / Math.max(1, item.str.length), y0: tx[5] - 0.75 * size, y1: tx[5] + 0.2 * size });
      }
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Die PDF-Seite konnte nicht gezeichnet werden.'))), 'image/jpeg', 0.92));
      sheets.push({ id: newId(), blob, name: `${baseName(file.name)} – Seite ${n}.jpg`, kind: 'pdf', w: canvas.width, h: canvas.height, text });
      // free the canvas memory right away (Safari limits the total canvas size)
      canvas.width = canvas.height = 0;
    }
  } finally {
    void doc.destroy();
  }
  return sheets;
}

/** Stores the files as sheets (in the order given) and returns their ids. */
export async function importFiles(files: File[], progress: Progress): Promise<string[]> {
  const ids: string[] = [];
  for (const f of files) {
    let sheets: Sheet[];
    if (isPdf(f)) sheets = await pdfPages(f, progress);
    else if (f.type.startsWith('video/')) throw new Error('Videos werden in der Web-App noch nicht unterstützt (nur in der Android-App).');
    else if (f.type.startsWith('image/') || f.type === '') sheets = [{ id: newId(), blob: f, name: f.name || 'Foto.jpg' }];
    else throw new Error(`„${f.name}“ ist weder ein Bild noch ein PDF.`);
    for (const s of sheets) {
      await db.saveSheet(s);
      ids.push(s.id);
    }
  }
  return ids;
}

/** A name for a new piece from its files. */
export function nameFor(files: File[]): string {
  const f = files[0];
  // photos from the camera are called "image.jpg" on the iPad
  if (!f || /^(image|IMG_\d+|photo)/i.test(f.name)) {
    return 'Stück vom ' + new Date().toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  return baseName(f.name);
}

const TEXT_FONT_PX = 30;
const TEXT_MARGIN = 48;

/**
 * Pasted text (tabs from the internet, chords over lyrics) as a sheet: drawn as a picture in a
 * monospaced font, with the position of every character kept for reading it.
 */
export async function textSheet(text: string, name: string): Promise<string> {
  const lines = text.replace(/\t/g, '    ').replace(/\s+$/, '').split(/\r?\n/);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = `${TEXT_FONT_PX}px Menlo, "Courier New", Courier, monospace`;
  ctx.font = font;
  const charWidth = ctx.measureText('M').width;
  const lineHeight = Math.round(TEXT_FONT_PX * 1.45);
  const longest = Math.max(20, ...lines.map((l) => l.length));
  canvas.width = Math.ceil(2 * TEXT_MARGIN + longest * charWidth);
  canvas.height = Math.ceil(2 * TEXT_MARGIN + lines.length * lineHeight);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.font = font;
  ctx.textBaseline = 'alphabetic';
  const pieces: TextPiece[] = [];
  lines.forEach((line, i) => {
    const top = TEXT_MARGIN + i * lineHeight;
    const baseline = top + TEXT_FONT_PX;
    // character by character, so that every one is exactly in its column
    [...line].forEach((c, k) => ctx.fillText(c, TEXT_MARGIN + k * charWidth, baseline));
    if (line.trim()) {
      pieces.push({
        str: line,
        x0: TEXT_MARGIN,
        x1: TEXT_MARGIN + line.length * charWidth,
        y0: top,
        y1: top + lineHeight,
        chars: [...line].map((_, k) => ({ x0: TEXT_MARGIN + k * charWidth, x1: TEXT_MARGIN + (k + 1) * charWidth })),
      });
    }
  });
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Der Text konnte nicht gezeichnet werden.'))), 'image/png'));
  const sheet: Sheet = { id: newId(), blob, name: `${name || 'Text'}.png`, kind: 'text', w: canvas.width, h: canvas.height, text: pieces };
  canvas.width = canvas.height = 0;
  await db.saveSheet(sheet);
  return sheet.id;
}
