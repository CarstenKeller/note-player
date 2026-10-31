// Saving all pieces into one file (ZIP) and reading such a file again, e.g. to move the pieces to
// another device or to keep them safe outside the browser.

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { db, type Original, type Piece, type Sheet } from './db';

/** A sheet in the backup: its picture is the file at [path]. */
type SheetEntry = { id: string; name: string; type: string; path: string } & Pick<Sheet, 'kind' | 'w' | 'h' | 'text' | 'source'>;

interface Manifest {
  app: 'notenspieler';
  version: 1;
  pieces: (Piece & { files: SheetEntry[]; cover?: { path: string; type: string } })[];
  /** The imported PDF files (not in backups of older versions). */
  originals?: (Omit<Original, 'blob'> & { path: string })[];
}

const extOf = (type: string) => (type === 'image/png' ? 'png' : type === 'image/heic' ? 'heic' : 'jpg');

export async function exportAll(): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};
  const manifest: Manifest = { app: 'notenspieler', version: 1, pieces: [], originals: [] };
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
      const path = `blaetter/${id}.${extOf(s.blob.type)}`;
      files[path] = new Uint8Array(await s.blob.arrayBuffer());
      entry.files.push({ id, name: s.name, type: s.blob.type, path, kind: s.kind, w: s.w, h: s.h, text: s.text, source: s.source });
      if (s.source && !originals.has(s.source.original)) {
        originals.add(s.source.original);
        const o = await db.original(s.source.original);
        if (o) {
          const opath = `originale/${o.id}.pdf`;
          files[opath] = new Uint8Array(await o.blob.arrayBuffer());
          manifest.originals!.push({ id: o.id, name: o.name, pages: o.pages, sheets: o.sheets, path: opath });
        }
      }
    }
    manifest.pieces.push(entry);
  }
  files['notenspieler.json'] = strToU8(JSON.stringify(manifest, null, 1));
  // pictures are compressed already
  return new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' });
}

/** Adds the pieces of a backup; pieces that are already there are left as they are. */
export async function importAll(file: File): Promise<number> {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const raw = files['notenspieler.json'];
  if (!raw) throw new Error('Die Datei ist keine Sicherung des Notenspielers.');
  const manifest = JSON.parse(strFromU8(raw)) as Manifest;
  const existing = new Set((await db.pieces()).map((p) => p.id));
  let added = 0;
  const restored = new Set<string>();
  for (const entry of manifest.pieces) {
    if (existing.has(entry.id)) continue;
    const { files: list, cover, ...piece } = entry;
    const coverData = cover && files[cover.path];
    if (cover && coverData) {
      await db.saveCover({ id: piece.id, source: 'own', query: '', time: Date.now(), blob: new Blob([coverData], { type: cover.type }) });
    }
    for (const f of list) {
      const data = files[f.path];
      if (!data) continue;
      // the original PDF of the sheet, once
      const o = f.source && manifest.originals?.find((x) => x.id === f.source!.original);
      const odata = o && files[o.path];
      if (o && odata && !restored.has(o.id)) {
        restored.add(o.id);
        await db.saveOriginal({ id: o.id, name: o.name, pages: o.pages, sheets: o.sheets, blob: new Blob([odata], { type: 'application/pdf' }) });
      }
      await db.saveSheet({
        id: f.id, name: f.name, blob: new Blob([data], { type: f.type }),
        kind: f.kind, w: f.w, h: f.h, text: f.text, source: odata ? f.source : undefined,
      });
    }
    await db.savePiece({ ...piece, sheets: list.filter((f) => files[f.path]).map((f) => f.id) });
    added++;
  }
  return added;
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
