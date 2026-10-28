// Web worker: runs the recognition and the sound rendering (both from the Kotlin core) without
// blocking the page.

import { WebOmr } from 'omr-core';

const omr = WebOmr.getInstance();

export type Request =
  | { type: 'recognize'; id: number; blob: Blob }
  | { type: 'samples'; id: number; kind: string; pitches: number[]; data: Float32Array[]; rate: number }
  | { type: 'render'; id: number; kind: string; events: Int32Array; bassStaves: number[]; tpq: number; tempoTicks: Int32Array; tempoBpm: Float64Array; instrument: string };

export type Response =
  | { id: number; ok: true; width?: number; height?: number; page?: Blob; json?: string; audio?: Float32Array; rate?: number }
  | { id: number; ok: false; error: string };

const MAX_PIXELS = 16_000_000;

/** The working size, as in the Android app: photos keep at least 2400 px on their short side. */
function maxSideFor(width: number, height: number): number {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (long <= 2400) return 2400;
  const keepShort = Math.floor(long * Math.min(1, 2400 / short));
  const pixelLimit = Math.floor(Math.sqrt((MAX_PIXELS * long) / short));
  return Math.max(2400, Math.min(keepShort, pixelLimit));
}

/** Recordings by kind (piano, guitar). */
const samples = new Map<string, { pitches: number[]; data: Float32Array[]; rate: number }>();

async function recognize(blob: Blob) {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  // transparent parts count as paper
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const gray = new Int32Array(width * height);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = ((rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000) | 0;

  const r = omr.recognize(width, height, gray, maxSideFor(width, height));

  // the straightened page, as it is shown
  const out = new OffscreenCanvas(r.width, r.height);
  const octx = out.getContext('2d')!;
  const img = octx.createImageData(r.width, r.height);
  const px = r.pixels;
  for (let i = 0, j = 0; i < px.length; i++, j += 4) {
    img.data[j] = img.data[j + 1] = img.data[j + 2] = px[i];
    img.data[j + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  const page = await out.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  return { width: r.width, height: r.height, page, json: r.json };
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const req = e.data;
  const reply = (r: Response, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(r, transfer);
  try {
    if (req.type === 'recognize') {
      reply({ id: req.id, ok: true, ...(await recognize(req.blob)) });
    } else if (req.type === 'samples') {
      samples.set(req.kind, { pitches: req.pitches, data: req.data, rate: req.rate });
      reply({ id: req.id, ok: true });
    } else if (req.type === 'render') {
      const bank = samples.get(req.kind);
      if (!bank) throw new Error('Die Klänge sind noch nicht geladen.');
      const audio = omr.render(req.events, req.bassStaves, req.tpq, req.tempoTicks, req.tempoBpm, req.instrument, bank.pitches, bank.data, bank.rate);
      reply({ id: req.id, ok: true, audio, rate: omr.sampleRate }, [audio.buffer]);
    }
  } catch (err) {
    reply({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
