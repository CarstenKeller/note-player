// Turns chosen files (photos, pictures, PDFs) into sheets. Each page of a PDF becomes a sheet.

import { db, newId, type Sheet } from './db';

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
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Die PDF-Seite konnte nicht gezeichnet werden.'))), 'image/jpeg', 0.92));
      // free the canvas memory right away (Safari limits the total canvas size)
      canvas.width = canvas.height = 0;
      sheets.push({ id: newId(), blob, name: `${baseName(file.name)} – Seite ${n}.jpg` });
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
