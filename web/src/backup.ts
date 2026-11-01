// Saving all pieces into one file (ZIP) and reading such a file again: to keep them safe outside
// the browser, and to share the library with another device (sent e.g. by WhatsApp). Taking over
// such a file merges it: per piece the newer change wins, deletions are taken over too.

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { db, type Original, type Piece, type Sheet } from './db';
import { renderPdfPages } from './importer';

/**
 * A sheet in the backup: its picture is the file at [path]; a page of a PDF that is in the file
 * too has no picture ([path] empty): it is drawn from the PDF again (that saves the space twice).
 */
type SheetEntry = { id: string; name: string; type: string; path: string } & Pick<Sheet, 'kind' | 'w' | 'h' | 'text' | 'source'>;

interface Manifest {
  app: 'notenspieler';
  version: 1;
  pieces: (Piece & { files: SheetEntry[]; cover?: { path: string; type: string } })[];
  /** The imported PDF files (not in backups of older versions). */
  originals?: (Omit<Original, 'blob'> & { path: string })[];
  /** Deleted pieces: id and when (not in backups of older versions). */
  deleted?: Record<string, number>;
}

/** When a piece was last changed (older pieces: when it was made). */
const changedAt = (p: Pick<Piece, 'created' | 'modified'>) => p.modified ?? p.created;

/** What taking over a library file does. */
export interface MergePlan {
  /** Pieces of the file that are new here or changed there later than here. */
  take: string[];
  /** Pieces here that were deleted there later than they were changed here (id, when). */
  remove: { id: string; time: number }[];
  /** The deletions both sides know of afterwards. */
  deleted: Record<string, number>;
}

/**
 * Merging a library file into the library here: per piece the newer change wins; a piece deleted
 * on one side after its last change on the other side is deleted.
 */
export function planMerge(
  here: { pieces: Pick<Piece, 'id' | 'created' | 'modified'>[]; deleted: Record<string, number> },
  there: { pieces: Pick<Piece, 'id' | 'created' | 'modified'>[]; deleted: Record<string, number> },
): MergePlan {
  const local = new Map(here.pieces.map((p) => [p.id, p]));
  const deleted = { ...here.deleted };
  for (const [id, t] of Object.entries(there.deleted)) deleted[id] = Math.max(deleted[id] ?? 0, t);
  const take: string[] = [];
  for (const p of there.pieces) {
    const mine = local.get(p.id);
    // deleted here after it was last changed there
    if ((here.deleted[p.id] ?? -1) >= changedAt(p)) continue;
    if (!mine || changedAt(p) > changedAt(mine)) take.push(p.id);
  }
  const remove: MergePlan['remove'] = [];
  const theirs = new Map(there.pieces.map((p) => [p.id, p]));
  for (const [id, t] of Object.entries(there.deleted)) {
    const mine = local.get(id);
    const again = theirs.get(id);
    if (mine && t >= changedAt(mine) && !(again && changedAt(again) > t)) remove.push({ id, time: t });
  }
  // a piece made again after its deletion is no longer deleted
  for (const id of take) if ((deleted[id] ?? -1) < changedAt(there.pieces.find((p) => p.id === id)!)) delete deleted[id];
  return { take, remove, deleted };
}

const extOf = (type: string) => (type === 'image/png' ? 'png' : type === 'image/heic' ? 'heic' : 'jpg');

export async function exportAll(): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};
  const manifest: Manifest = { app: 'notenspieler', version: 1, pieces: [], originals: [], deleted: (await db.setting<Record<string, number>>('deleted')) ?? {} };
  const originals = new Set<string>();
  for (const p of await db.pieces()) {
    const entry: Manifest['pieces'][number] = { ...p, files: [] };
    // a picture chosen for the tile (found ones are searched again)
    const cover = await db.cover(p.id);
    if (cover?.source === 'own' && cover.blob) {
      const path = `bilder/${p.id}.${extOf(cover.blob.type)}`;
      files[path] = new Uint8Array(await cover.blob.arrayBuffer());
      entry.cover = { path, type: cover.blob.type };
    }
    for (const id of p.sheets) {
      const s = await db.sheet(id);
      if (!s) continue;
      if (s.source && !originals.has(s.source.original)) {
        const o = await db.original(s.source.original);
        if (o) {
          originals.add(o.id);
          const opath = `originale/${o.id}.pdf`;
          files[opath] = new Uint8Array(await o.blob.arrayBuffer());
          manifest.originals!.push({ id: o.id, name: o.name, pages: o.pages, sheets: o.sheets, path: opath });
        }
      }
      // a page of a PDF in the file: drawn from it again
      const fromPdf = s.source !== undefined && originals.has(s.source.original);
      const path = fromPdf ? '' : `blaetter/${id}.${extOf(s.blob.type)}`;
      if (!fromPdf) files[path] = new Uint8Array(await s.blob.arrayBuffer());
      entry.files.push({ id, name: s.name, type: s.blob.type, path, kind: s.kind, w: s.w, h: s.h, text: s.text, source: s.source });
    }
    manifest.pieces.push(entry);
  }
  // pictures and PDFs are compressed already; the list (with the text of the pages) is not
  const zipped: Record<string, Uint8Array | [Uint8Array, { level: 0 | 6 }]> = { ...files };
  zipped['notenspieler.json'] = [strToU8(JSON.stringify(manifest)), { level: 6 }];
  return new Blob([zipSync(zipped, { level: 0 })], { type: 'application/zip' });
}

/** What taking over a library file changed. */
export interface MergeResult { added: number; updated: number; removed: number }

/**
 * Takes over a library file (shared from another device, or a backup): new pieces are added,
 * pieces changed there later replace the ones here, pieces deleted there are deleted here.
 */
export async function importAll(file: File): Promise<MergeResult> {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const raw = files['notenspieler.json'];
  if (!raw) throw new Error('Die Datei ist keine Bibliothek bzw. Sicherung des Notenspielers.');
  const manifest = JSON.parse(strFromU8(raw)) as Manifest;
  const pieces = await db.pieces();
  const here = new Map(pieces.map((p) => [p.id, p]));
  const plan = planMerge(
    { pieces, deleted: (await db.setting<Record<string, number>>('deleted')) ?? {} },
    { pieces: manifest.pieces, deleted: manifest.deleted ?? {} },
  );
  const result: MergeResult = { added: 0, updated: 0, removed: 0 };
  const restored = new Set<string>();
  for (const entry of manifest.pieces) {
    if (!plan.take.includes(entry.id)) continue;
    const { files: list, cover, ...piece } = entry;
    const mine = here.get(piece.id);
    const coverData = cover && files[cover.path];
    if (cover && coverData) {
      await db.saveCover({ id: piece.id, source: 'own', query: '', time: Date.now(), blob: new Blob([coverData], { type: cover.type }) });
    }
    const sheets: string[] = [];
    for (const f of list) {
      if (await db.sheet(f.id)) { sheets.push(f.id); continue; }
      // the original PDF of the sheet, once
      const o = f.source && manifest.originals?.find((x) => x.id === f.source!.original);
      const odata = o && files[o.path];
      if (o && odata && !restored.has(o.id) && !(await db.original(o.id))) {
        restored.add(o.id);
        await db.saveOriginal({ id: o.id, name: o.name, pages: o.pages, sheets: o.sheets, blob: new Blob([odata], { type: 'application/pdf' }) });
      }
      let data: Blob | null = files[f.path] ? new Blob([files[f.path]], { type: f.type }) : null;
      let text = f.text;
      if (!data && f.source && odata) {
        // drawn from its PDF again, as when it was imported
        const [page] = await renderPdfPages(odata.slice(), [f.source.page]);
        if (page) {
          data = page.blob;
          text = f.text ?? page.text;
        }
      }
      if (!data) continue;
      await db.saveSheet({
        id: f.id, name: f.name, blob: data,
        kind: f.kind, w: f.w, h: f.h, text, source: odata || (f.source && (await db.original(f.source.original))) ? f.source : undefined,
      });
      sheets.push(f.id);
    }
    // sheets of the old version that the new one no longer has
    if (mine) for (const id of mine.sheets) if (!sheets.includes(id)) await db.deleteSheet(id);
    await db.savePiece({ ...piece, opened: Math.max(piece.opened ?? 0, mine?.opened ?? 0), sheets }, changedAt(piece));
    if (mine) result.updated++;
    else result.added++;
  }
  for (const { id, time } of plan.remove) {
    const p = here.get(id);
    if (p) {
      await db.deletePiece(p, time);
      result.removed++;
    }
  }
  await db.saveSetting('deleted', plan.deleted);
  return result;
}

/** Name of a library file to share: the date tells which is the newest. */
export const libraryFileName = () => `Notenspieler-Bibliothek-${new Date().toISOString().slice(0, 10)}.zip`;

/**
 * Offers a file for sharing (WhatsApp, mail, AirDrop ...); where a browser cannot share such a
 * file (Chrome on Android shares no ZIP files) it is downloaded instead. A share sheet must open
 * right after a tap: when the file took too long to make, the browser refuses ('tap again').
 */
export async function shareFile(blob: Blob, name: string): Promise<'shared' | 'downloaded' | 'cancelled' | 'tap again'> {
  const file = new File([blob], name, { type: 'application/zip' });
  if (!navigator.canShare?.({ files: [file] })) {
    download(blob, name);
    return 'downloaded';
  }
  try {
    await navigator.share({ files: [file], title: 'Notenspieler-Bibliothek' });
    return 'shared';
  } catch (e) {
    const err = e as DOMException;
    if (err.name === 'AbortError') return 'cancelled';
    if (err.name === 'NotAllowedError') return 'tap again';
    throw e;
  }
}

/** Offers [blob] as a download (on the iPad: "Sichern in Dateien" or sharing). */
export function download(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}
