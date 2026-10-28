import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { db, newId, type Piece } from './db';
import { importFiles, nameFor, textSheet } from './importer';
import { initBackup } from './autobackup';
import { Library } from './ui/Library';
import { PieceView } from './ui/PieceView';
import './styles.css';

function App() {
  const [open, setOpen] = useState<Piece | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [artists, setArtists] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshCategories = async () => {
    const all = await db.pieces();
    setCategories([...new Set(all.flatMap((p) => p.categories))]);
    setArtists([...new Set(all.map((p) => p.artist ?? '').filter(Boolean))]);
  };
  useEffect(() => void refreshCategories(), [open]);

  const importNew = async (files: File[]) => {
    setError(null);
    setBusy('Die Dateien werden übernommen …');
    try {
      const sheets = await importFiles(files, setBusy);
      const piece: Piece = { id: newId(), name: nameFor(files), created: Date.now(), opened: Date.now(), categories: [], sheets };
      await db.savePiece(piece);
      setOpen(piece);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /** A new piece from pasted text (tabs, chords over lyrics): opened in the guitar mode. */
  const importText = async (text: string, name: string) => {
    setError(null);
    try {
      const pieceName = name || text.split(/\r?\n/).find((l) => l.trim())?.trim().slice(0, 40) || 'Text';
      const sheet = await textSheet(text, pieceName);
      const piece: Piece = { id: newId(), name: pieceName, created: Date.now(), opened: Date.now(), categories: [], sheets: [sheet], instrument: 'guitar' };
      await db.savePiece(piece);
      setOpen(piece);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      {open
        ? <PieceView key={open.id} piece={open} allCategories={categories} allArtists={artists} onBack={() => setOpen(null)} />
        : <Library onOpen={setOpen} onImport={importNew} onText={(t, n) => void importText(t, n)} />}
      {busy && <div class="overlay"><div class="dialog">{busy}</div></div>}
      {error && (
        <div class="overlay" onClick={() => setError(null)}>
          <div class="dialog"><p>{error}</p><div class="actions"><span class="spacer" /><button class="primary">OK</button></div></div>
        </div>
      )}
    </>
  );
}

void initBackup();
render(<App />, document.getElementById('app')!);

// offline use: the service worker keeps all files of the app
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register('./sw.js');
}
