// Pictures for the tiles of the library: a cover found on the web for title and performer
// (iTunes search of Apple, else Wikipedia), a picture chosen by the user, or the head of the
// first sheet. Only title and performer are sent; nothing of the sheets.

import { db, type Cover, type Piece } from './db';

/** Searched again after this time when nothing was found (perhaps offline or a new entry). */
const RETRY_NOTHING = 7 * 24 * 3600 * 1000;

/** Lower case, without accents, brackets ("(Live)") and punctuation. */
export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9ß]+/g, ' ')
    .trim();
}

const sameName = (a: string, b: string) => {
  const x = norm(a);
  const y = norm(b);
  return x.length > 0 && y.length > 0 && (x === y || x.startsWith(y + ' ') || y.startsWith(x + ' '));
};
const sameArtist = (a: string, b: string) => {
  const x = norm(a);
  const y = norm(b);
  return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x));
};

/** The query a cover is searched for. */
export const coverQuery = (p: Piece) => `${p.name.trim()}|${(p.artist ?? '').trim()}`;

interface ItunesResult { trackName?: string; collectionName?: string; artistName?: string; artworkUrl100?: string }

/** The cover of the song in an answer of the iTunes search (title must match; performer too, if known). */
export function pickItunes(results: ItunesResult[], title: string, artist: string): string | null {
  const hit = results.find((r) => r.artworkUrl100 && r.trackName && sameName(r.trackName, title) && (!artist || sameArtist(r.artistName ?? '', artist)));
  // larger picture than the 100 pixels of the answer
  return hit ? hit.artworkUrl100!.replace(/\/\d+x\d+bb\./, '/600x600bb.') : null;
}

interface WikiPage { title: string; index?: number; thumbnail?: { source: string } }

/**
 * A picture of a Wikipedia search answer: a page about the song (its title contains the title
 * of the piece), else, with [artistPage], a page about the performer.
 */
export function pickWikipedia(pages: WikiPage[], title: string, artist: string, artistPage = false): string | null {
  const sorted = [...pages].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).filter((p) => p.thumbnail);
  const hit = artistPage
    ? sorted.find((p) => sameArtist(p.title, artist))
    // without a performer only a page of just that name ("Title (song)"): a word of the title
    // alone would give all kinds of pictures
    : sorted.find((p) => norm(title).length > 0 && (artist ? ` ${norm(p.title)} `.includes(` ${norm(title)} `) : norm(p.title) === norm(title)));
  return hit?.thumbnail?.source ?? null;
}

async function getJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

async function wikipedia(lang: string, search: string): Promise<WikiPage[]> {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search` +
    `&gsrsearch=${encodeURIComponent(search)}&gsrlimit=5&prop=pageimages&piprop=thumbnail&pithumbsize=600`;
  const j = (await getJson(url)) as { query?: { pages?: Record<string, WikiPage> } };
  return Object.values(j.query?.pages ?? {});
}

/**
 * Searches a cover for title and performer. Null: nothing found; an error: the search could not
 * be made (offline).
 */
export async function searchCover(title: string, artist: string): Promise<{ url: string; from: string } | null> {
  let reached = false;
  let failure: unknown = null;
  try {
    const term = encodeURIComponent(`${artist} ${title}`.trim());
    const j = (await getJson(`https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=25`)) as { results?: ItunesResult[] };
    reached = true;
    const url = pickItunes(j.results ?? [], title, artist);
    if (url) return { url, from: 'iTunes' };
  } catch (e) {
    failure = e;
  }
  const langs = navigator.language?.startsWith('de') ? ['de', 'en'] : ['en', 'de'];
  for (const artistPage of artist ? [false, true] : [false]) {
    for (const lang of langs) {
      try {
        const pages = await wikipedia(lang, artistPage ? artist : `${title} ${artist}`.trim());
        reached = true;
        const url = pickWikipedia(pages, title, artist, artistPage);
        if (url) return { url, from: 'Wikipedia' };
      } catch (e) {
        failure = e;
      }
    }
  }
  if (!reached) throw failure ?? new Error('Keine Verbindung');
  return null;
}

/** The picture itself (kept for offline use), or null when the server does not allow reading it. */
async function fetchImage(url: string): Promise<Blob | null> {
  try {
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) return null;
    const b = await r.blob();
    return b.type.startsWith('image/') ? b : null;
  } catch {
    return null;
  }
}

/** A small picture of the head of a sheet (the title area), about 480 pixels wide. */
async function headOf(blob: Blob): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const w = 480;
    const scale = w / bitmap.width;
    const h = Math.round(Math.min(bitmap.height * scale, w * 1.0));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, bitmap.width, h / scale, 0, 0, w, h);
    bitmap.close();
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    canvas.width = canvas.height = 0;
    return out;
  } catch {
    return null;
  }
}

/**
 * Brings the cover of [piece] up to date (search when title or performer changed, head of the
 * first sheet when that changed) and returns it.
 */
export async function updateCover(piece: Piece, searchWeb: boolean): Promise<Cover> {
  const old = await db.cover(piece.id);
  let c: Cover = old ?? { id: piece.id, source: 'none', query: '', time: 0 };
  const firstSheet = piece.sheets[0];
  if (firstSheet && c.sheetId !== firstSheet) {
    const sheet = await db.sheet(firstSheet);
    const thumb = sheet && (await headOf(sheet.blob));
    c = { ...c, sheetThumb: thumb ?? undefined, sheetId: firstSheet };
    await db.saveCover(c);
  }
  const query = coverQuery(piece);
  const due = c.source !== 'own' && c.from !== 'off' && (c.query !== query || (c.source === 'none' && c.from !== 'off' && Date.now() - c.time > RETRY_NOTHING));
  if (searchWeb && due && piece.name.trim()) {
    try {
      const found = await searchCover(piece.name.trim(), (piece.artist ?? '').trim());
      const blob = found && (await fetchImage(found.url));
      c = found
        ? { ...c, source: 'web', query, time: Date.now(), url: found.url, blob: blob ?? undefined, from: found.from }
        : { ...c, source: 'none', query, time: Date.now(), url: undefined, blob: undefined, from: undefined };
      await db.saveCover(c);
    } catch {
      // offline: tried again next time
    }
  }
  return c;
}

/** Sets a picture chosen by the user (null: no picture from the web, the head of the sheet). */
export async function setOwnCover(piece: Piece, image: Blob | null): Promise<void> {
  const old = (await db.cover(piece.id)) ?? { id: piece.id, source: 'none' as const, query: '', time: 0 };
  await db.saveCover(image
    ? { ...old, source: 'own', blob: image, url: undefined, from: undefined, query: coverQuery(piece), time: Date.now() }
    : { ...old, source: 'none', blob: undefined, url: undefined, from: 'off', query: coverQuery(piece), time: Date.now() });
}

/** Lets the search run again (after a picture was chosen or removed). */
export async function resetCover(piece: Piece): Promise<void> {
  const old = await db.cover(piece.id);
  if (old) await db.saveCover({ ...old, source: 'none', query: '', blob: undefined, url: undefined, from: undefined, time: 0 });
}
