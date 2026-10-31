import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { db, persist, type Cover, type Piece } from '../db';
import { updateCover } from '../covers';
import { BackupStatus } from './BackupStatus';
import { Icon, IconButton } from './Icon';
import { TextDialog } from './TextDialog';
import { PieceDialog, collator } from './PieceDialog';

const NONE = '\u0000ohne';
type Sort = 'name' | 'recent';
type View = 'tiles' | 'list';
type Group = 'category' | 'artist' | 'favorite';

/** The picture of a tile: a cover, or else the head of the first sheet. */
interface TilePicture { src: string; sheet: boolean }

/** [web]: pictures found on the web are shown (the search is on). */
function pictureOf(c: Cover, web: boolean): TilePicture | null {
  if (c.source === 'own' && c.blob) return { src: URL.createObjectURL(c.blob), sheet: false };
  if (web && c.source === 'web' && c.blob) return { src: URL.createObjectURL(c.blob), sheet: false };
  if (web && c.source === 'web' && c.url) return { src: c.url, sheet: false };
  if (c.sheetThumb) return { src: URL.createObjectURL(c.sheetThumb), sheet: true };
  return null;
}

/** Whether covers are searched on the web (setting, default yes). */
export const COVER_SEARCH = 'coverSearch';

/** The saved pieces: search, sections ("Rubriken"), and opening new sheets. */
export function Library(props: {
  onOpen: (piece: Piece) => void;
  onImport: (files: File[]) => void;
  onText: (text: string, name: string) => void;
}) {
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [artist, setArtist] = useState<string>('');
  const [sort, setSort] = useState<Sort>('name');
  const [view, setView] = useState<View>('tiles');
  const [group, setGroup] = useState<Group>('category');
  const [pictures, setPictures] = useState<Record<string, TilePicture>>({});
  /** Bumped to search the pictures again (a picture was chosen, the setting changed). */
  const [coverRound, setCoverRound] = useState(0);
  const [editing, setEditing] = useState<Piece | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [pasting, setPasting] = useState(false);
  const files = useRef<HTMLInputElement>(null);

  const reload = async () => setPieces(await db.pieces());
  useEffect(() => {
    void reload();
    void db.setting<Sort | 'artist'>('sort').then((s) => s && setSort(s === 'recent' ? 'recent' : 'name'));
    void db.setting<View>('view').then((v) => v && setView(v));
    void db.setting<Group>('group').then((g) => g && setGroup(g));
    const again = () => setCoverRound((n) => n + 1);
    window.addEventListener('covers-changed', again);
    return () => window.removeEventListener('covers-changed', again);
  }, []);

  // the pictures of the tiles: what is stored at once, then brought up to date one by one
  useEffect(() => {
    if (pieces.length === 0) return;
    let cancelled = false;
    const urls: string[] = [];
    let searchWeb = true;
    const show = (c: Cover) => {
      // (a newer round shows the pictures; the addresses of this one are given up)
      if (cancelled) return;
      const pic = pictureOf(c, searchWeb);
      if (pic?.src.startsWith('blob:')) urls.push(pic.src);
      setPictures((all) => {
        const next = { ...all };
        if (pic) next[c.id] = pic;
        else delete next[c.id];
        return next;
      });
    };
    void (async () => {
      searchWeb = (await db.setting<boolean>(COVER_SEARCH)) ?? true;
      for (const c of await db.covers()) show(c);
      for (const p of pieces) {
        if (cancelled) return;
        show(await updateCover(p, searchWeb));
      }
    })();
    return () => {
      cancelled = true;
      // after a moment: the pictures are shown until the new ones are there
      setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 5000);
    };
  }, [pieces, coverRound]);

  useEffect(() => {
    void persist().then(setPersisted);
  }, []);

  const categories = useMemo(() => [...new Set(pieces.flatMap((p) => p.categories))].sort(collator.compare), [pieces]);
  const artists = useMemo(() => [...new Set(pieces.map((p) => p.artist ?? '').filter(Boolean))].sort(collator.compare), [pieces]);

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return pieces
      .filter((p) => category === null || (category === NONE ? p.categories.length === 0 : p.categories.includes(category)))
      .filter((p) => !artist || p.artist === artist)
      .filter((p) => {
        const text = (p.name + ' ' + (p.artist ?? '') + ' ' + p.categories.join(' ')).toLowerCase();
        return words.every((w) => text.includes(w));
      })
      .sort((a, b) => (sort === 'recent' ? b.opened - a.opened : collator.compare(a.name, b.name)));
  }, [pieces, query, category, artist, sort]);

  /** The pieces in sections: by section ("Rubrik"; a piece may be in several), performer or favourite. */
  const groups = useMemo((): { title: string; pieces: Piece[] }[] => {
    if (group === 'favorite') {
      return [
        { title: 'Favoriten', pieces: shown.filter((p) => p.favorite) },
        { title: 'Weitere Stücke', pieces: shown.filter((p) => !p.favorite) },
      ].filter((g) => g.pieces.length > 0);
    }
    if (group === 'artist') {
      const names = [...new Set(shown.map((p) => p.artist ?? '').filter(Boolean))].sort(collator.compare);
      return [
        ...names.map((a) => ({ title: a, pieces: shown.filter((p) => p.artist === a) })),
        { title: 'Ohne Interpret', pieces: shown.filter((p) => !p.artist) },
      ].filter((g) => g.pieces.length > 0);
    }
    const cats = category !== null && category !== NONE ? [category] : categories;
    return [
      ...cats.map((c) => ({ title: c, pieces: shown.filter((p) => p.categories.includes(c)) })),
      { title: 'Ohne Rubrik', pieces: shown.filter((p) => p.categories.length === 0) },
    ].filter((g) => g.pieces.length > 0);
  }, [shown, group, categories, category]);

  const choose = <T,>(key: string, value: T, set: (v: T) => void) => {
    set(value);
    void db.saveSetting(key, value);
  };

  const toggleFavorite = async (p: Piece) => {
    await db.savePiece({ ...p, favorite: !p.favorite || undefined });
    await reload();
  };

  const picked = (input: HTMLInputElement) => {
    const list = [...(input.files ?? [])];
    input.value = '';
    if (list.length) props.onImport(list);
  };

  return (
    <div class="library">
      <header class="bar">
        <h1>Notenspieler</h1>
        <BackupStatus settings onRestored={() => void reload()} />
        <span class="spacer" />
        <IconButton class="primary" icon="camera" label="Foto" onClick={() => camera.current?.click()} />
        <IconButton class="primary" icon="open" label="Bilder / PDF" onClick={() => files.current?.click()} />
        <IconButton class="primary" icon="text" label="Text" onClick={() => setPasting(true)} />
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => picked(e.currentTarget)} />
        <input ref={files} type="file" accept="image/*,application/pdf,.pdf" multiple hidden onChange={(e) => picked(e.currentTarget)} />
      </header>

      <div class="search">
        <input type="search" placeholder="Stück oder Interpret suchen …" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
        {artists.length > 0 && (
          <select value={artist} onChange={(e) => setArtist(e.currentTarget.value)} aria-label="Interpret">
            <option value="">Alle Interpreten</option>
            {artists.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        <div class="segmented" role="group" aria-label="Gliedern">
          <IconButton class={group === 'category' ? 'on' : ''} icon="folder" label="Rubrik" onClick={() => choose('group', 'category', setGroup)} />
          <IconButton class={group === 'artist' ? 'on' : ''} icon="person" label="Interpret" onClick={() => choose('group', 'artist', setGroup)} />
          <IconButton class={group === 'favorite' ? 'on' : ''} icon="star" label="Favoriten" onClick={() => choose('group', 'favorite', setGroup)} />
        </div>
        <div class="segmented" role="group" aria-label="Sortieren">
          <IconButton iconOnly class={sort === 'name' ? 'on' : ''} icon="sortName" label="Nach Name sortieren" onClick={() => choose('sort', 'name', setSort)} />
          <IconButton iconOnly class={sort === 'recent' ? 'on' : ''} icon="clock" label="Zuletzt geöffnet zuerst" onClick={() => choose('sort', 'recent', setSort)} />
        </div>
        <div class="segmented" role="group" aria-label="Ansicht">
          <IconButton iconOnly class={view === 'tiles' ? 'on' : ''} icon="tiles" label="Kacheln" onClick={() => choose('view', 'tiles', setView)} />
          <IconButton iconOnly class={view === 'list' ? 'on' : ''} icon="list" label="Liste" onClick={() => choose('view', 'list', setView)} />
        </div>
      </div>

      {pieces.length > 0 && (
        <div class="chips categories">
          <button class={'chip' + (category === null ? ' on' : '')} onClick={() => setCategory(null)}>Alle ({pieces.length})</button>
          {categories.map((c) => (
            <button key={c} class={'chip' + (category === c ? ' on' : '')} onClick={() => setCategory(category === c ? null : c)}>
              {c} ({pieces.filter((p) => p.categories.includes(c)).length})
            </button>
          ))}
          {pieces.some((p) => p.categories.length === 0) && categories.length > 0 && (
            <button class={'chip' + (category === NONE ? ' on' : '')} onClick={() => setCategory(category === NONE ? null : NONE)}>Ohne Rubrik</button>
          )}
        </div>
      )}

      <div class="pieces">
        {groups.map((g) => (
          <section key={g.title}>
            <h2 class="group">{g.title} <span class="muted small">({g.pieces.length})</span></h2>
            {view === 'tiles' ? (
              <ul class="tiles">
                {g.pieces.map((p) => (
                  <li key={p.id} onClick={() => props.onOpen(p)}>
                    <div class={'cover' + (pictures[p.id]?.sheet ? ' sheet' : '')}>
                      {pictures[p.id] ? <img src={pictures[p.id].src} alt="" loading="lazy" /> : <span class="placeholder"><Icon name="note" /></span>}
                      <button class={'fav' + (p.favorite ? ' on' : '')} title={p.favorite ? 'Kein Favorit mehr' : 'Als Favorit markieren'}
                        aria-label={p.favorite ? 'Kein Favorit mehr' : 'Als Favorit markieren'}
                        onClick={(e) => { e.stopPropagation(); void toggleFavorite(p); }}>
                        <Icon name={p.favorite ? 'starOn' : 'star'} />
                      </button>
                    </div>
                    <div class="caption">
                      <div class="text">
                        <div class="name">{p.name}</div>
                        {p.artist && <div class="artist muted">{p.artist}</div>}
                      </div>
                      <IconButton iconOnly icon="more" label="Bearbeiten" onClick={(e) => { e.stopPropagation(); setEditing(p); }} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <ul class="rows">
                {g.pieces.map((p) => (
                  <li key={p.id} onClick={() => props.onOpen(p)}>
                    <div class="info">
                      <div class="name">{p.name}{p.artist && <span class="artist"> – {p.artist}</span>}</div>
                      <div class="meta">
                        {p.categories.map((c) => <span key={c} class="tag">{c}</span>)}
                        <span class="muted">{p.sheets.length === 1 ? '1 Blatt' : `${p.sheets.length} Blätter`}</span>
                      </div>
                    </div>
                    <IconButton iconOnly class={'fav' + (p.favorite ? ' on' : '')} icon={p.favorite ? 'starOn' : 'star'}
                      label={p.favorite ? 'Kein Favorit mehr' : 'Als Favorit markieren'}
                      onClick={(e) => { e.stopPropagation(); void toggleFavorite(p); }} />
                    <IconButton iconOnly icon="more" label="Bearbeiten" onClick={(e) => { e.stopPropagation(); setEditing(p); }} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {pieces.length === 0 && (
        <div class="empty">
          <p>Noch keine Stücke gespeichert.</p>
          <p>Fotografiere ein Notenblatt oder öffne Bilder bzw. ein PDF. Mehrere Bilder werden in der gewählten Reihenfolge zu einem Stück.</p>
        </div>
      )}
      {pieces.length > 0 && shown.length === 0 && <div class="empty"><p>Kein Stück gefunden.</p></div>}

      <footer class="footer">
        <span class="spacer" />
        <span class="muted small">
          {persisted === false && 'Tipp: Zum Home-Bildschirm hinzufügen, damit die Stücke dauerhaft gespeichert bleiben. · '}
          Version {__BUILD__}
        </span>
      </footer>

      {pasting && <TextDialog withName onClose={() => setPasting(false)} onDone={(text, name) => { setPasting(false); props.onText(text, name); }} />}
      {editing && (
        <PieceDialog
          piece={editing}
          allCategories={categories}
          allArtists={artists}
          onClose={() => setEditing(null)}
          onCoverChanged={() => setCoverRound((n) => n + 1)}
          onSave={async (name, artistName, cats, favorite) => {
            await db.savePiece({ ...editing, name, artist: artistName || undefined, categories: cats, favorite: favorite || undefined });
            setEditing(null);
            await reload();
          }}
          onDelete={async () => {
            await db.deletePiece(editing);
            setEditing(null);
            await reload();
          }}
        />
      )}
    </div>
  );
}
