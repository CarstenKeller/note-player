// Saving all pieces into one file (ZIP) and reading such a file again, e.g. to move the pieces to
// another device or to keep them safe outside the browser.

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { db, type Piece } from './db';

interface Manifest {
  app: 'notenspieler';
  version: 1;
  pieces: (Piece & { files: { id: string; name: string; type: string; path: string }[] })[];
}

const extOf = (type: string) => (type === 'image/png' ? 'png' : type === 'image/heic' ? 'heic' : 'jpg');

export async function exportAll(): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};
  const manifest: Manifest = { app: 'notenspieler', version: 1, pieces: [] };
  for (const p of await db.pieces()) {
    const entry = { ...p, files: [] as Manifest['pieces'][number]['files'] };
    for (const id of p.sheets) {
      const s = await db.sheet(id);
      if (!s) continue;
      const path = `blaetter/${id}.${extOf(s.blob.type)}`;
      files[path] = new Uint8Array(await s.blob.arrayBuffer());
      entry.files.push({ id, name: s.name, type: s.blob.type, path });
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
  for (const entry of manifest.pieces) {
    if (existing.has(entry.id)) continue;
    const { files: list, ...piece } = entry;
    for (const f of list) {
      const data = files[f.path];
      if (data) await db.saveSheet({ id: f.id, name: f.name, blob: new Blob([data], { type: f.type }) });
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
