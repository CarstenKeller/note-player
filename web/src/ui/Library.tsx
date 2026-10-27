import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { db, persist, type Piece } from '../db';
import { download, exportAll, importAll } from '../backup';
import { PieceDialog, collator } from './PieceDialog';

const NONE = '\u0000ohne';
type Sort = 'name' | 'recent';

/** The saved pieces: search, sections ("Rubriken"), and opening new sheets. */
export function Library(props: {
  onOpen: (piece: Piece) => void;
  onImport: (files: File[]) => void;
}) {
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('name');
  const [editing, setEditing] = useState<Piece | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const backup = useRef<HTMLInputElement>(null);

  const reload = async () => setPieces(await db.pieces());
  useEffect(() => {
    void reload();
    void db.setting<Sort>('sort').then((s) => s && setSort(s));
    void persist().then(setPersisted);
  }, []);

  const categories = useMemo(() => [...new Set(pieces.flatMap((p) => p.categories))].sort(collator.compare), [pieces]);

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return pieces
      .filter((p) => category === null || (category === NONE ? p.categories.length === 0 : p.categories.includes(category)))
      .filter((p) => {
        const text = (p.name + ' ' + p.categories.join(' ')).toLowerCase();
        return words.every((w) => text.includes(w));
      })
      .sort((a, b) => (sort === 'name' ? collator.compare(a.name, b.name) : b.opened - a.opened));
  }, [pieces, query, category, sort]);

  const chooseSort = (s: Sort) => {
    setSort(s);
    void db.saveSetting('sort', s);
  };

  const picked = (input: HTMLInputElement) => {
    const list = [...(input.files ?? [])];
    input.value = '';
    if (list.length) props.onImport(list);
  };

  const saveBackup = async () => {
    setMessage('Sicherung wird erstellt …');
    try {
      const blob = await exportAll();
      download(blob, `Notenspieler-Sicherung-${new Date().toISOString().slice(0, 10)}.zip`);
      setMessage(null);
    } catch (e) {
      setMessage('Sicherung fehlgeschlagen: ' + (e as Error).message);
    }
  };

  const loadBackup = async (input: HTMLInputElement) => {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    setMessage('Sicherung wird gelesen …');
    try {
      const n = await importAll(f);
      await reload();
      setMessage(n === 1 ? '1 Stück übernommen.' : `${n} Stücke übernommen.`);
    } catch (e) {
      setMessage('Die Sicherung konnte nicht gelesen werden: ' + (e as Error).message);
    }
  };

  return (
    <div class="library">
      <header class="bar">
        <h1>Notenspieler</h1>
        <span class="spacer" />
        <button class="primary" onClick={() => camera.current?.click()}>📷 Foto</button>
        <button class="primary" onClick={() => files.current?.click()}>＋ Bilder / PDF</button>
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => picked(e.currentTarget)} />
        <input ref={files} type="file" accept="image/*,application/pdf,.pdf" multiple hidden onChange={(e) => picked(e.currentTarget)} />
      </header>

      <div class="search">
        <input type="search" placeholder="Stück suchen …" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
        <div class="segmented">
          <button class={sort === 'name' ? 'on' : ''} onClick={() => chooseSort('name')}>A–Z</button>
          <button class={sort === 'recent' ? 'on' : ''} onClick={() => chooseSort('recent')}>Zuletzt</button>
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

      <ul class="pieces">
        {shown.map((p) => (
          <li key={p.id} onClick={() => props.onOpen(p)}>
            <div class="info">
              <div class="name">{p.name}</div>
              <div class="meta">
                {p.categories.map((c) => <span key={c} class="tag">{c}</span>)}
                <span class="muted">{p.sheets.length === 1 ? '1 Blatt' : `${p.sheets.length} Blätter`}</span>
              </div>
            </div>
            <button class="icon" aria-label="Bearbeiten" onClick={(e) => { e.stopPropagation(); setEditing(p); }}>⋯</button>
          </li>
        ))}
      </ul>

      {pieces.length === 0 && (
        <div class="empty">
          <p>Noch keine Stücke gespeichert.</p>
          <p>Fotografiere ein Notenblatt oder öffne Bilder bzw. ein PDF. Mehrere Bilder werden in der gewählten Reihenfolge zu einem Stück.</p>
        </div>
      )}
      {pieces.length > 0 && shown.length === 0 && <div class="empty"><p>Kein Stück gefunden.</p></div>}

      <footer class="footer">
        <button onClick={saveBackup} disabled={pieces.length === 0}>Sicherung speichern</button>
        <button onClick={() => backup.current?.click()}>Sicherung laden</button>
        <input ref={backup} type="file" accept=".zip,application/zip" hidden onChange={(e) => loadBackup(e.currentTarget)} />
        {message && <span class="muted">{message}</span>}
        <span class="spacer" />
        <span class="muted small">
          {persisted === false && 'Tipp: Zum Home-Bildschirm hinzufügen, damit die Stücke dauerhaft gespeichert bleiben. · '}
          Version {__BUILD__}
        </span>
      </footer>

      {editing && (
        <PieceDialog
          piece={editing}
          allCategories={categories}
          onClose={() => setEditing(null)}
          onSave={async (name, cats) => {
            await db.savePiece({ ...editing, name, categories: cats });
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
