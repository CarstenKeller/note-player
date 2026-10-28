// Automatic backup of all pieces into a ZIP file after every significant change.
//
// Where the browser allows it (Chrome, Edge – the File System Access API), the file is chosen
// once and then written in the background. Safari (iPad, iPhone, Mac) does not allow a web page
// to write a file without a tap; there the backup is prepared in the background and saved with
// one tap (share dialog → "In Dateien sichern", or a download).

import { db, onSignificantChange } from './db';
import { download, exportAll } from './backup';

export type BackupStatus = 'ok' | 'saving' | 'unsaved' | 'error';

export interface BackupState {
  status: BackupStatus;
  /** What went wrong, or why a tap is needed. */
  message?: string;
  savedAt?: number;
  /** Name of the chosen file (automatic saving). */
  fileName?: string;
}

/** How the backup is saved where it cannot be written automatically. */
export type ManualMethod = 'share' | 'download';

interface Info {
  changedAt: number;
  savedAt: number;
}

interface WritableHandle extends FileSystemFileHandle {
  queryPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>;
}

declare global {
  interface Window {
    showSaveFilePicker?(o: { suggestedName?: string; types?: { description: string; accept: Record<string, string[]> }[] }): Promise<FileSystemFileHandle>;
  }
}

/** The browser can write a chosen file automatically (not Safari). */
export const canWriteAutomatically = typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';

const FILE_NAME = 'Notenspieler-Sicherung.zip';
const DELAY_MS = 2000;

let state: BackupState = { status: 'ok' };
const listeners = new Set<(s: BackupState) => void>();
let info: Info = { changedAt: 0, savedAt: 0 };
let handle: WritableHandle | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
/** A ZIP of the current state, ready for a tap (Safari needs the share call right in the tap). */
let ready: { blob: Blob; at: number } | null = null;

function set(s: Partial<BackupState>) {
  state = { ...state, ...s, fileName: handle?.name, savedAt: info.savedAt || undefined };
  for (const l of listeners) l(state);
}

export function subscribe(l: (s: BackupState) => void): () => void {
  listeners.add(l);
  l(state);
  return () => listeners.delete(l);
}

export const backupState = () => state;

async function saveInfo() {
  await db.saveSetting('backupInfo', info);
}

const unsaved = () => info.changedAt > info.savedAt;

const MANUAL_MESSAGE =
  'Es gibt Änderungen, die noch nicht in der Sicherungsdatei stehen. Safari erlaubt einer ' +
  'Web-App nicht, ohne Antippen in eine Datei zu speichern – bitte „Jetzt sichern“ antippen.';

function messageFor(e: unknown): string {
  const err = e as Error;
  if (err?.name === 'NotAllowedError') return 'Der Browser hat das Speichern in die Sicherungsdatei nicht erlaubt. Bitte antippen und erlauben.';
  if (err?.name === 'NotFoundError') return 'Die Sicherungsdatei wurde nicht gefunden (verschoben oder gelöscht?). Bitte den Speicherort neu wählen.';
  if (err?.name === 'QuotaExceededError') return 'Am Speicherort ist nicht genug Platz für die Sicherung.';
  return 'Die Sicherung ist fehlgeschlagen: ' + (err?.message || String(e));
}

/** Writes the backup into the chosen file. [interactive]: called from a tap (may ask). */
async function writeFile(interactive: boolean): Promise<void> {
  if (!handle) return;
  const started = Date.now();
  set({ status: 'saving', message: undefined });
  try {
    let perm = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
    if (perm !== 'granted' && interactive) perm = (await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
    if (perm !== 'granted') {
      set({ status: 'error', message: 'Der Browser fragt nach dem Neustart wieder um Erlaubnis, in die Sicherungsdatei zu schreiben. Bitte antippen und „Jetzt sichern“ wählen.' });
      return;
    }
    const blob = await exportAll();
    const w = await handle.createWritable();
    await w.write(blob);
    await w.close();
    info.savedAt = Math.max(started, info.changedAt);
    await saveInfo();
    set({ status: unsaved() ? 'unsaved' : 'ok', message: undefined });
    if (unsaved()) schedule();
  } catch (e) {
    set({ status: 'error', message: messageFor(e) });
  }
}

/** Builds the ZIP ahead of a tap (Safari). */
async function prepareManual(): Promise<void> {
  try {
    const at = Date.now();
    const blob = await exportAll();
    ready = { blob, at };
  } catch (e) {
    set({ status: 'error', message: messageFor(e) });
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (handle) void writeFile(false);
    else {
      set({ status: 'unsaved', message: MANUAL_MESSAGE });
      void prepareManual();
    }
  }, DELAY_MS);
}

/** Starts watching for changes. */
export async function initBackup(): Promise<void> {
  info = (await db.setting<Info>('backupInfo')) ?? { changedAt: 0, savedAt: 0 };
  handle = (await db.setting<WritableHandle>('backupHandle')) ?? null;
  onSignificantChange(() => {
    info.changedAt = Date.now();
    void saveInfo();
    ready = null;
    set({ status: handle ? 'saving' : 'unsaved', message: handle ? undefined : MANUAL_MESSAGE });
    schedule();
  });
  // pieces from before the automatic backup existed: not saved yet
  if (!info.savedAt && !info.changedAt && (await db.pieces()).length > 0) info.changedAt = Date.now();
  if (unsaved()) schedule();
  else set({ status: 'ok' });
}

export async function manualMethod(): Promise<ManualMethod> {
  return (await db.setting<ManualMethod>('backupMethod')) ?? 'share';
}

export async function setManualMethod(m: ManualMethod): Promise<void> {
  await db.saveSetting('backupMethod', m);
}

/** Saves now; to be called directly from a tap. */
export async function saveNow(): Promise<void> {
  if (handle) return writeFile(true);
  const method = await manualMethod();
  const started = Date.now();
  // the share dialog must be opened right in the tap: use the prepared file if it is current
  const blob = ready && ready.at >= info.changedAt ? ready.blob : null;
  set({ status: 'saving' });
  try {
    const zip = blob ?? (await exportAll());
    const file = new File([zip], FILE_NAME, { type: 'application/zip' });
    if (method === 'share' && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Notenspieler-Sicherung' });
    } else {
      download(zip, FILE_NAME);
    }
    info.savedAt = Math.max(started, blob ? ready!.at : started);
    if (info.savedAt < info.changedAt) info.savedAt = info.changedAt;
    await saveInfo();
    set({ status: 'ok', message: undefined });
  } catch (e) {
    const err = e as Error;
    if (err?.name === 'AbortError') {
      // closed the share dialog without saving
      set({ status: unsaved() ? 'unsaved' : 'ok', message: unsaved() ? MANUAL_MESSAGE : undefined });
    } else if (err?.name === 'NotAllowedError' && !blob) {
      // took too long to prepare: the file is ready now, a second tap works
      ready = null;
      await prepareManual();
      set({ status: 'unsaved', message: 'Die Sicherung ist vorbereitet – bitte noch einmal „Jetzt sichern“ antippen.' });
    } else {
      set({ status: 'error', message: messageFor(e) });
    }
  }
}

/** Chooses the file for automatic saving (Chrome, Edge); to be called from a tap. */
export async function chooseFile(): Promise<void> {
  if (!window.showSaveFilePicker) return;
  try {
    const h = (await window.showSaveFilePicker({
      suggestedName: FILE_NAME,
      types: [{ description: 'ZIP-Datei', accept: { 'application/zip': ['.zip'] } }],
    })) as WritableHandle;
    handle = h;
    await db.saveSetting('backupHandle', h);
    await writeFile(true);
  } catch (e) {
    if ((e as Error)?.name !== 'AbortError') set({ status: 'error', message: messageFor(e) });
  }
}

/** Back to saving with a tap (forgets the chosen file). */
export async function forgetFile(): Promise<void> {
  handle = null;
  await db.saveSetting('backupHandle', null);
  set({ status: unsaved() ? 'unsaved' : 'ok', message: unsaved() ? MANUAL_MESSAGE : undefined });
}
