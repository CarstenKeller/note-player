// The page side of the worker: recognition of sheets (with cache) and rendering of sound.

import type { Request, Response } from './worker';
import { db, type Recognized } from './db';
import type { SheetResult } from './score';

/** Version of the recognition; results of another version are recognized again. */
export const ENGINE = __ENGINE__;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (r: Response) => void>();

type Payload<T> = T extends unknown ? Omit<T, 'id'> : never;

/** The piano recordings, sent again to a new worker. */
let samples: { pitches: number[]; data: Float32Array[]; rate: number } | null = null;

function call(req: Payload<Request>, transfer: Transferable[] = []): Promise<Extract<Response, { ok: true }>> {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<Response>) => {
      pending.get(e.data.id)?.(e.data);
      pending.delete(e.data.id);
    };
    if (samples && req.type !== 'samples') worker.postMessage({ type: 'samples', id: nextId++, ...samples });
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
  const r = await call({ type: 'recognize', blob: sheet.blob });
  const rec: Recognized = { id: sheetId, engine: ENGINE, width: r.width!, height: r.height!, page: r.page!, json: r.json! };
  await db.saveResult(rec);
  return toShown(rec);
}

export function sendSamples(pitches: number[], data: Float32Array[], rate: number) {
  samples = { pitches, data, rate };
  return call({ type: 'samples', pitches, data, rate });
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
  const r = await call({ type: 'render', events, bassStaves, tpq, bpm, instrument });
  return { audio: r.audio!, rate: r.rate! };
}
