// Local storage of the pieces in the browser (IndexedDB). Nothing leaves the device (only the
// title and performer are sent to a search for a cover picture, see covers.ts).

import type { TextPiece } from './guitar/text';
import type { StrumPattern } from './guitar/analyze';

/** A saved piece: its sheets in playing order and the sections ("Rubriken") it is filed under. */
export interface Piece {
  id: string;
  name: string;
  created: number;
  /**
   * When name, performer, sections, favourite or sheets were last changed (for sharing the
   * library between devices: the newer change wins). Not set: [created].
   */
  modified?: number;
  /** When the piece was last opened (for sorting). */
  opened: number;
  categories: string[];
  /** Performer / composer ("Interpret"), optional. */
  artist?: string;
  /** Marked as a favourite. */
  favorite?: boolean;
  /** Ids of the sheets in playing order. */
  sheets: string[];
  /** Quarter notes per minute at 100 %; remembered per piece. */
  bpm?: number;
  /** Speed of the scroll mode, as quarter notes per minute. */
  scrollBpm?: number;
  /** Piano (default): notes as before. Guitar: also chord names and tabs, guitar sound. */
  instrument?: 'piano' | 'guitar';
  guitar?: GuitarSettings;
}

export interface GuitarSettings {
  /**
   * Strum the chords (names above notes or lyrics). Not set: yes, unless the guitar part is
   * written out with tablature (then the names are only for orientation).
   */
  chords?: boolean;
  /** Play a capo found on the sheet ("Capo fret 2": everything sounds two semitones higher). */
  capo?: boolean;
  /** Play the notes and tabs. */
  melody: boolean;
  strum: StrumPattern;
  /** Beats a chord lasts on a song sheet without notes. */
  beatsPerChord: number;
}

export const DEFAULT_GUITAR: GuitarSettings = { melody: true, strum: 'quarter', beatsPerChord: 4 };

/** One sheet: a photo, a picture or a page of a PDF, as it was imported. */
export interface Sheet {
  id: string;
  blob: Blob;
  /** File name it came from (for saving it again). */
  name: string;
  /** 'text': pasted text (tabs, chords over lyrics), drawn as a picture. */
  kind?: 'image' | 'pdf' | 'text';
  /** Size of the picture (for placing [text] on the recognized page). */
  w?: number;
  h?: number;
  /** Text on the sheet with positions in the picture (PDF text layer or pasted text). */
  text?: TextPiece[];
  /** The page of an imported PDF this sheet is (number from 1), kept in the original file. */
  source?: { original: string; page: number };
}

/** An imported PDF file as it was, kept for saving the piece as PDF again. */
export interface Original {
  id: string;
  blob: Blob;
  name: string;
  /** Number of pages of the file. */
  pages: number;
  /** The sheets made from its pages; the file is deleted with the last of them. */
  sheets: string[];
}

/** The picture on the tile of a piece. */
export interface Cover {
  /** Piece id. */
  id: string;
  /**
   * 'web': found by the search for [query]; 'own': chosen by the user; 'none': the search found
   * nothing (tried again after some days) or the user wants no picture from the web.
   */
  source: 'web' | 'own' | 'none';
  /** Title and performer the search was made for (searched again when they change). */
  query: string;
  /** When it was searched. */
  time: number;
  /** The picture (or only its address, when the server does not allow reading it). */
  blob?: Blob;
  url?: string;
  /** Where it was found ("iTunes", "Wikipedia"). */
  from?: string;
  /** A small picture of the head of the first sheet (shown without cover). */
  sheetThumb?: Blob;
  /** The sheet [sheetThumb] was made of. */
  sheetId?: string;
}

/** The recognition of a sheet, kept so that a piece opens quickly the next time. */
export interface Recognized {
  /** Sheet id. */
  id: string;
  /** Version of the recognition; a newer app recognizes the sheet again. */
  engine: string;
  width: number;
  height: number;
  /** The straightened page as it is shown. */
  page: Blob;
  json: string;
  /** Text recognized on the page (for chord names), once it was needed. */
  ocr?: TextPiece[];
  /** What [ocr] contains: absent = chord names only; 2 = also the numbers in tablatures. */
  ocrVersion?: number;
}

const DB_NAME = 'notenspieler';
const STORES = ['pieces', 'sheets', 'results', 'settings', 'originals', 'covers'] as const;
type Store = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      // version 2: the store of original PDF files; 3: cover pictures
      const req = indexedDB.open(DB_NAME, 3);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === 'settings' ? 'key' : 'id' });
      };
      req.onsuccess = () => {
        // a newer app in another tab needs the database: let it go
        req.result.onversionchange = () => req.result.close();
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: Store, mode: IDBTransactionMode = 'readonly'): Promise<IDBObjectStore> {
  return (await open()).transaction(name, mode).objectStore(name);
}

async function get<T>(name: Store, id: string): Promise<T | undefined> {
  return done((await store(name)).get(id)) as Promise<T | undefined>;
}

async function put(name: Store, value: unknown): Promise<void> {
  await done((await store(name, 'readwrite')).put(value));
}

async function del(name: Store, id: string): Promise<void> {
  await done((await store(name, 'readwrite')).delete(id));
}

/**
 * Listeners for changes that a backup should contain: a piece added or deleted, its name,
 * performer, sections or sheets changed (not: opened, tempo).
 */
const changeListeners: (() => void)[] = [];

export function onSignificantChange(listener: () => void): void {
  changeListeners.push(listener);
}

function significantChange(): void {
  for (const l of changeListeners) l();
}

const essentials = (p: Piece) => JSON.stringify([p.name, p.artist ?? '', p.categories, p.sheets, p.instrument ?? 'piano', p.favorite ?? false]);

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const db = {
  async pieces(): Promise<Piece[]> {
    return done((await store('pieces')).getAll()) as Promise<Piece[]>;
  },
  piece: (id: string) => get<Piece>('pieces', id),
  /** [modified]: the time of the change (taken over from another device); else now, if it is one. */
  async savePiece(p: Piece, modified?: number): Promise<void> {
    const old = await get<Piece>('pieces', p.id);
    const changed = !old || essentials(old) !== essentials(p);
    await put('pieces', { ...p, modified: modified ?? (changed ? Date.now() : (old?.modified ?? p.modified)) });
    if (changed) significantChange();
  },
  /** [time]: when it was deleted (taken over from another device); else now. */
  async deletePiece(p: Piece, time = Date.now()): Promise<void> {
    for (const s of p.sheets) await db.deleteSheet(s);
    await del('pieces', p.id);
    await del('covers', p.id);
    // remembered, so that sharing the library deletes it on the other devices too
    const deleted = (await db.setting<Record<string, number>>('deleted')) ?? {};
    deleted[p.id] = Math.max(deleted[p.id] ?? 0, time);
    await db.saveSetting('deleted', deleted);
    significantChange();
  },

  sheet: (id: string) => get<Sheet>('sheets', id),
  saveSheet: (s: Sheet) => put('sheets', s),
  async deleteSheet(id: string): Promise<void> {
    const source = (await get<Sheet>('sheets', id))?.source;
    await del('sheets', id);
    await del('results', id);
    // the original file goes with the last sheet made from it
    const original = source && (await get<Original>('originals', source.original));
    if (original) {
      const sheets = original.sheets.filter((s) => s !== id);
      if (sheets.length > 0) await put('originals', { ...original, sheets });
      else await del('originals', original.id);
    }
  },

  cover: (id: string) => get<Cover>('covers', id),
  saveCover: (c: Cover) => put('covers', c),
  async covers(): Promise<Cover[]> {
    return done((await store('covers')).getAll()) as Promise<Cover[]>;
  },

  original: (id: string) => get<Original>('originals', id),
  saveOriginal: (o: Original) => put('originals', o),

  result: (id: string) => get<Recognized>('results', id),
  saveResult: (r: Recognized) => put('results', r),

  async setting<T>(key: string): Promise<T | undefined> {
    return (await get<{ key: string; value: T }>('settings', key))?.value;
  },
  saveSetting: (key: string, value: unknown) => put('settings', { key, value }),
};

/**
 * Asks the browser to keep the data even when storage runs low. Safari may otherwise delete the
 * data of a website that was not used for some weeks (not of an app on the home screen).
 */
export async function persist(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
