// Text recognition (tesseract.js) for photos and scans without a text layer: finds chord names
// and text tabs. Loaded only when needed; its files are served by the app (public/ocr).

import type { TextPiece } from './text';

type TesseractWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;

let workerPromise: Promise<TesseractWorker> | null = null;

const url = (path: string) => new URL(path, document.baseURI).href;

function worker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM } = await import('tesseract.js');
      const w = await createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: url('./ocr/worker.min.js'),
        corePath: url('./ocr/'),
        langPath: url('./ocr/'),
        gzip: true,
      });
      // keep runs of spaces: text tabs and chord lines are aligned with spaces
      await w.setParameters({ preserve_interword_spaces: '1' });
      return w;
    })();
    workerPromise.catch(() => (workerPromise = null));
  }
  return workerPromise;
}

interface Box { x0: number; y0: number; x1: number; y1: number }
interface OcrSymbol { text: string; bbox: Box }
interface OcrWord { text: string; bbox: Box; symbols?: OcrSymbol[] }

/** The words on a picture with their boxes (in the picture's pixels). */
export async function recognizeText(image: Blob): Promise<TextPiece[]> {
  const w = await worker();
  await w.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '3' as never });
  const { data } = await w.recognize(image, {}, { blocks: true, text: false });
  return piecesOf(data, 0, 1);
}

/** Letters, signs and digits of chord names. */
const CHORD_CHARS = 'ABCDEFGHabcdefghmMajsu#b0123456789()/+-°ø';

/** Digits of fret numbers in tablatures. */
export const FRET_CHARS = '0123456789';

export interface Strip {
  top: number;
  bottom: number;
  /** Lines to paint over before reading (the lines of a tablature). */
  lines?: number[];
}

/**
 * Chord names (or with [chars] = FRET_CHARS fret numbers) in strips of a page (the strips above the staves, where chord names stand). The
 * strips are enlarged and read with only the characters of chord names, which reads them much
 * better between notes and chord diagrams than reading the whole page.
 */
export async function recognizeStrips(image: Blob, strips: Strip[], letterHeight: number, chars = CHORD_CHARS): Promise<TextPiece[]> {
  const w = await worker();
  // fret numbers stand scattered on the tablature: 'sparse text'
  await w.setParameters({ tessedit_char_whitelist: chars, tessedit_pageseg_mode: (chars === FRET_CHARS ? '11' : '6') as never });
  const bitmap = await createImageBitmap(image);
  const pieces: TextPiece[] = [];
  try {
    for (const s of strips) {
      const top = Math.max(0, Math.floor(s.top));
      const height = Math.min(bitmap.height, Math.ceil(s.bottom)) - top;
      if (height < 8) continue;
      // text recognition works best with letters of about 40 pixels
      const scale = Math.min(3, Math.max(1, 40 / Math.max(1, letterHeight)));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, top, bitmap.width, height, 0, 0, canvas.width, canvas.height);
      if (s.lines?.length) removeLines(ctx, s.lines.map((y) => (y - top) * scale), letterHeight * scale);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('strip'))), 'image/png'));
      canvas.width = canvas.height = 0;
      const { data } = await w.recognize(blob, {}, { blocks: true, text: false });
      pieces.push(...piecesOf(data, top, scale));
    }
  } finally {
    bitmap.close();
  }
  return pieces;
}

/**
 * Paints over the lines of a tablature (at the heights [ys]): the long dark runs in the rows
 * around each line. The numbers on a line are short runs and stay.
 */
function removeLines(ctx: CanvasRenderingContext2D, ys: number[], letterHeight: number): void {
  const { width, height } = ctx.canvas;
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;
  const dark = (i: number) => d[i] + d[i + 1] + d[i + 2] < 3 * 160;
  const minRun = Math.max(4, 1.2 * letterHeight);
  const reach = Math.max(2, Math.round(letterHeight / 8));
  for (const y of ys) {
    for (let row = Math.max(0, Math.round(y) - reach); row <= Math.min(height - 1, Math.round(y) + reach); row++) {
      let x = 0;
      while (x < width) {
        if (!dark((row * width + x) * 4)) { x++; continue; }
        let end = x;
        while (end < width && dark((row * width + end) * 4)) end++;
        if (end - x >= minRun) for (let k = x; k < end; k++) d.fill(255, (row * width + k) * 4, (row * width + k) * 4 + 3);
        x = end;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function piecesOf(data: any, top: number, scale: number): TextPiece[] {
  const pieces: TextPiece[] = [];
  const X = (x: number) => x / scale;
  const Y = (y: number) => top + y / scale;
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        for (const word of line.words as unknown as OcrWord[]) {
          const text = word.text.trim();
          if (!text) continue;
          const symbols = word.symbols?.filter((s) => s.text.length === 1);
          const chars = symbols && symbols.length === text.length ? symbols.map((s) => ({ x0: X(s.bbox.x0), x1: X(s.bbox.x1) })) : undefined;
          pieces.push({ str: text, x0: X(word.bbox.x0), y0: Y(word.bbox.y0), x1: X(word.bbox.x1), y1: Y(word.bbox.y1), chars, ocr: true });
        }
      }
    }
  }
  return pieces;
}

/** Frees the memory of the text recognition. */
export async function releaseOcr(): Promise<void> {
  const p = workerPromise;
  workerPromise = null;
  if (p) await (await p).terminate();
}
