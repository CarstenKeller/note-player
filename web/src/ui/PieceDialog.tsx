import { useState } from 'preact/hooks';
import type { Piece } from '../db';
import { download } from '../backup';
import { pdfName, piecePdf } from '../pdfexport';

/** Name and sections ("Rubriken") of a piece; saving its sheets as PDF; optionally deleting it. */
export function PieceDialog(props: {
  piece: Piece;
  allCategories: string[];
  allArtists: string[];
  onSave: (name: string, artist: string, categories: string[]) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(props.piece.name);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const savePdf = async () => {
    setPdfBusy(true);
    setPdfError(null);
    try {
      download(await piecePdf(props.piece), pdfName(props.piece));
    } catch (e) {
      setPdfError('PDF nicht möglich: ' + (e as Error).message);
    } finally {
      setPdfBusy(false);
    }
  };
  const [artist, setArtist] = useState(props.piece.artist ?? '');
  const [chosen, setChosen] = useState<string[]>(props.piece.categories);
  const [known, setKnown] = useState<string[]>(() => [...new Set([...props.allCategories, ...props.piece.categories])].sort(collator.compare));
  const [fresh, setFresh] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const toggle = (c: string) => setChosen(chosen.includes(c) ? chosen.filter((x) => x !== c) : [...chosen, c]);
  const add = () => {
    const c = fresh.trim();
    if (!c) return;
    if (!known.includes(c)) setKnown([...known, c].sort(collator.compare));
    if (!chosen.includes(c)) setChosen([...chosen, c]);
    setFresh('');
  };

  return (
    <div class="overlay" onClick={props.onClose}>
      <div class="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Stück</h2>
        <label class="field">
          Name
          <input value={name} onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        <label class="field">
          Interpret
          <input value={artist} list="artists" placeholder="z. B. Queen, Falco, Mozart" onInput={(e) => setArtist(e.currentTarget.value)} />
          <datalist id="artists">
            {props.allArtists.map((a) => <option key={a} value={a} />)}
          </datalist>
        </label>
        <div class="field">
          Rubriken
          <div class="chips">
            {known.map((c) => (
              <button key={c} class={'chip' + (chosen.includes(c) ? ' on' : '')} onClick={() => toggle(c)}>{c}</button>
            ))}
            {known.length === 0 && <span class="muted">Noch keine Rubriken – unten eine anlegen.</span>}
          </div>
          <div class="row">
            <input placeholder="Neue Rubrik, z. B. Pop, Klassik, Weihnachten" value={fresh}
              onInput={(e) => setFresh(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
            <button onClick={add} disabled={!fresh.trim()}>Hinzufügen</button>
          </div>
        </div>
        {pdfError && <div class="error">{pdfError}</div>}
        <div class="actions">
          {props.onDelete && (confirmDelete
            ? <button class="danger" onClick={props.onDelete}>Wirklich löschen?</button>
            : <button class="danger-outline" onClick={() => setConfirmDelete(true)}>Löschen</button>)}
          <button disabled={pdfBusy} onClick={() => void savePdf()}>{pdfBusy ? 'PDF wird erstellt …' : 'Als PDF sichern'}</button>
          <span class="spacer" />
          <button onClick={props.onClose}>Abbrechen</button>
          <button class="primary" onClick={() => {
            // a typed but not yet added section counts too
            const c = fresh.trim();
            props.onSave(name.trim() || props.piece.name, artist.trim(), c && !chosen.includes(c) ? [...chosen, c] : chosen);
          }}>Speichern</button>
        </div>
      </div>
    </div>
  );
}

export const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });
