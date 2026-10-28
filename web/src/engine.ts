// The page side of the worker: recognition of sheets (with cache) and rendering of sound.

import type { Request, Response } from './worker';
import { db, type Recognized } from './db';
import type { SheetResult } from './score';
import type { TextPiece } from './guitar/text';

/** Version of the recognition; results of another version are recognized again. */
export const ENGINE = __ENGINE__;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (r: Response) => void>();

type Payload<T> = T extends unknown ? Omit<T, 'id'> : never;

export type SampleKind = 'piano' | 'guitar';

/** The recordings (piano, guitar), sent again to a new worker. */
const samples = new Map<SampleKind, { pitches: number[]; data: Float32Array[]; rate: number }>();

function call(req: Payload<Request>, transfer: Transferable[] = []): Promise<Extract<Response, { ok: true }>> {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<Response>) => {
      pending.get(e.data.id)?.(e.data);
      pending.delete(e.data.id);
    };
    if (req.type !== 'samples') for (const [kind, s] of samples) worker.postMessage({ type: 'samples', id: nextId++, kind, ...s });
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, (r) => (r.ok ? resolve(r) : reject(new Error(r.error))));
    worker!.postMessage({ ...req, id }, transfer);
  });
}

export interface ShownSheet {
  width: number;
  height: number;
  /** Object URL of the straightened page. */
  url: string;
  result: SheetResult;
}

function toShown(r: Recognized): ShownSheet {
  return { width: r.width, height: r.height, url: URL.createObjectURL(r.page), result: JSON.parse(r.json) };
}

/** The recognized sheet: from the cache, or recognized now (takes seconds for a large photo). */
export async function recognizeSheet(sheetId: string): Promise<ShownSheet> {
  const cached = await db.result(sheetId);
  if (cached && cached.engine === ENGINE) return toShown(cached);
  const sheet = await db.sheet(sheetId);
  if (!sheet) throw new Error('Das Blatt ist nicht mehr gespeichert.');
  if (sheet.kind === 'text') {
    // pasted text has no notes: shown as drawn
    const none = { tpq: 480, staves: [], systems: [], events: [] };
    const json = JSON.stringify({ staffSpace: 0, skew: 0, warnings: [], tabs: [], score: none, withoutVocals: none });
    const rec: Recognized = { id: sheetId, engine: ENGINE, width: sheet.w ?? 1, height: sheet.h ?? 1, page: sheet.blob, json };
    await db.saveResult(rec);
    return toShown(rec);
  }
  const r = await call({ type: 'recognize', blob: sheet.blob });
  const rec: Recognized = { id: sheetId, engine: ENGINE, width: r.width!, height: r.height!, page: r.page!, json: r.json! };
  await db.saveResult(rec);
  return toShown(rec);
}

export function sendSamples(kind: SampleKind, pitches: number[], data: Float32Array[], rate: number) {
  samples.set(kind, { pitches, data, rate });
  return call({ type: 'samples', kind, pitches, data, rate });
}

/**
 * Ends the worker when it has nothing to do. The recognition of a large photo leaves a lot of
 * memory behind; on the iPad that can disturb the playback. A new worker starts when needed.
 */
export function releaseWorker(): void {
  if (worker && pending.size === 0) {
    worker.terminate();
    worker = null;
  }
}

export async function render(events: Int32Array, bassStaves: number[], tpq: number, bpm: number, instrument: string) {
  const kind: SampleKind = instrument === 'GUITAR' ? 'guitar' : 'piano';
  const r = await call({ type: 'render', kind, events, bassStaves, tpq, bpm, instrument });
  return { audio: r.audio!, rate: r.rate! };
}

/**
 * The text on a sheet, in the coordinates of the recognized page: the PDF's text layer or the
 * pasted text; for photos and scans read with text recognition (slow, kept afterwards).
 */
export async function sheetText(sheetId: string, page: ShownSheet): Promise<TextPiece[]> {
  const sheet = await db.sheet(sheetId);
  if (sheet?.text && sheet.w) {
    const f = page.width / sheet.w;
    return sheet.text.map((p) => ({
      str: p.str, x0: p.x0 * f, x1: p.x1 * f, y0: p.y0 * f, y1: p.y1 * f,
      chars: p.chars?.map((c) => ({ x0: c.x0 * f, x1: c.x1 * f })),
    }));
  }
  const rec = await db.result(sheetId);
  if (!rec) return [];
  if (rec.ocr) return rec.ocr;
  const { recognizeText, recognizeStrips } = await import('./guitar/ocr');
  // with staves: only the strips above the systems (chord names); else the whole page
  const systems = page.result.score.systems;
  const ss = page.result.staffSpace;
  const ocr = systems.length > 0
    ? await recognizeStrips(rec.page, systems.map((s, i) => ({
      top: Math.max(i > 0 ? systems[i - 1].box[3] + 2 * ss : 0, s.box[1] - 10 * ss),
      bottom: s.box[1] - 0.2 * ss,
    })), 1.5 * ss)
    : await recognizeText(rec.page);
  await db.saveResult({ ...rec, ocr });
  return ocr;
}
