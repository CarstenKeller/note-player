import { useEffect, useRef, useState } from 'preact/hooks';
import {
  canWriteAutomatically, chooseFile, forgetFile, manualMethod, saveNow, setManualMethod, subscribe,
  type BackupState, type ManualMethod,
} from '../autobackup';
import { exportAll, importAll, libraryFileName, shareFile } from '../backup';
import { db } from '../db';
import { librarySize, optimizePhotos, type LibrarySize } from '../optimize';
import { Icon, IconButton } from './Icon';

const when = (t?: number) =>
  t ? new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

/**
 * The state of the backup as a small symbol: a green tick when everything is saved, a warning
 * sign otherwise (tap: what is wrong, and saving by hand). With [settings], also the settings
 * button (where to save, loading a backup).
 */
export function BackupStatus(props: { settings?: boolean; onRestored?: () => void }) {
  const [state, setState] = useState<BackupState>({ status: 'ok' });
  const [open, setOpen] = useState(false);
  useEffect(() => subscribe(setState), []);

  const symbol = <Icon name={state.status === 'ok' ? 'check' : state.status === 'saving' ? 'sync' : 'warn'} />;
  const title = state.status === 'ok'
    ? (state.savedAt ? `Gesichert am ${when(state.savedAt)}` : 'Nichts zu sichern')
    : state.status === 'saving' ? 'Wird gesichert …' : 'Nicht gesichert – antippen';

  return (
    <>
      <button class={'backup-status ' + state.status} title={title} aria-label={title} onClick={() => setOpen(true)}>{symbol}</button>
      {props.settings && <IconButton iconOnly icon="settings" label="Einstellungen" onClick={() => setOpen(true)} />}
      {open && <BackupDialog state={state} onClose={() => setOpen(false)} onRestored={props.onRestored} />}
    </>
  );
}

/** Bytes as megabytes, for people. */
const mb = (bytes: number) => `${(bytes / 1e6).toLocaleString('de-DE', { maximumFractionDigits: bytes < 1e7 ? 1 : 0 })} MB`;

function BackupDialog(props: { state: BackupState; onClose: () => void; onRestored?: () => void }) {
  const { state } = props;
  const [method, setMethod] = useState<ManualMethod>('share');
  const [note, setNote] = useState<string | null>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  useEffect(() => void manualMethod().then(setMethod), []);
  const [coverSearch, setCoverSearch] = useState(true);
  useEffect(() => void db.setting<boolean>('coverSearch').then((v) => v !== undefined && setCoverSearch(v)), []);
  const chooseCoverSearch = async (on: boolean) => {
    setCoverSearch(on);
    await db.saveSetting('coverSearch', on);
    window.dispatchEvent(new Event('covers-changed'));
  };

  const chooseMethod = (m: ManualMethod) => {
    setMethod(m);
    void setManualMethod(m);
  };

  const restore = async (input: HTMLInputElement) => {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    setNote('Die Bibliothek wird übernommen …');
    try {
      const r = await importAll(f);
      const parts = [
        r.added > 0 && (r.added === 1 ? '1 Stück neu' : `${r.added} Stücke neu`),
        r.updated > 0 && (r.updated === 1 ? '1 Stück aktualisiert' : `${r.updated} Stücke aktualisiert`),
        r.removed > 0 && (r.removed === 1 ? '1 Stück gelöscht' : `${r.removed} Stücke gelöscht`),
      ].filter(Boolean);
      setNote(parts.length > 0 ? parts.join(', ') + '.' : 'Alles war schon auf dem neuesten Stand.');
      props.onRestored?.();
    } catch (e) {
      setNote('Die Datei konnte nicht gelesen werden: ' + (e as Error).message);
    }
  };

  // how much the library takes; making the photos smaller
  const [size, setSize] = useState<LibrarySize | null>(null);
  const [optimizing, setOptimizing] = useState<string | null>(null);
  const [optimizeNote, setOptimizeNote] = useState<string | null>(null);
  useEffect(() => void librarySize().then(setSize), []);
  const optimize = async () => {
    setOptimizeNote(null);
    try {
      const r = await optimizePhotos((done, of) => setOptimizing(of === 0 ? 'Keine Fotos zu prüfen …' : `Foto ${Math.min(done + 1, of)} von ${of} wird geprüft …`));
      setOptimizeNote(r.smaller + r.kept === 0
        ? 'Alle Fotos sind schon geprüft.'
        : `${r.smaller} von ${r.smaller + r.kept} Fotos verkleinert: ${mb(r.before)} → ${mb(r.after)}.` +
          (r.kept > 0 ? ` ${r.kept === 1 ? '1 bleibt' : `${r.kept} bleiben`}, wie ${r.kept === 1 ? 'es ist' : 'sie sind'} (Kamerafoto: verlustfrei nicht kleiner; oder die Erkennung wäre nicht genau dieselbe).` : ''));
    } catch (e) {
      setOptimizeNote('Nicht möglich: ' + (e as Error).message);
    } finally {
      setOptimizing(null);
      setSize(await librarySize());
      props.onRestored?.();
    }
  };

  // sharing the library: the file is made first; the share sheet may need a second tap
  const [sharing, setSharing] = useState<{ step: 'making' } | { step: 'ready'; blob: Blob; name: string } | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const offer = async (blob: Blob, name: string) => {
    const r = await shareFile(blob, name);
    if (r === 'tap again') {
      setSharing({ step: 'ready', blob, name });
      return;
    }
    setSharing(null);
    setShareNote(r === 'downloaded'
      ? `„${name}“ liegt jetzt bei den Downloads. In WhatsApp: Anhängen → Dokument → die Datei wählen.`
      : r === 'shared' ? 'Geteilt.' : null);
  };
  const share = async () => {
    setShareNote(null);
    setSharing({ step: 'making' });
    try {
      await offer(await exportAll(), libraryFileName());
    } catch (e) {
      setSharing(null);
      setShareNote('Teilen nicht möglich: ' + (e as Error).message);
    }
  };

  return (
    <div class="overlay" onClick={props.onClose}>
      <div class="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Sicherung und Teilen</h2>

        <div class={'backup-line ' + state.status}>
          <span class="backup-symbol"><Icon name={state.status === 'ok' ? 'check' : state.status === 'saving' ? 'sync' : 'warn'} /></span>
          <span>
            {state.status === 'ok' && (state.savedAt ? `Alles gesichert (zuletzt am ${when(state.savedAt)}).` : 'Noch nichts zu sichern.')}
            {state.status === 'saving' && 'Wird gesichert …'}
            {(state.status === 'unsaved' || state.status === 'error') && (state.message ?? 'Noch nicht gesichert.')}
          </span>
        </div>
        <div class="row">
          <button class="primary" onClick={() => void saveNow()} disabled={state.status === 'saving'}>Jetzt sichern</button>
        </div>

        <div class="field">
          <strong>Speicherort</strong>
          {canWriteAutomatically ? (
            <>
              <span class="muted">
                {state.fileName
                  ? <>Nach jeder Änderung wird automatisch in <b>{state.fileName}</b> gespeichert.</>
                  : 'Noch keine Datei gewählt. Nach der Wahl wird nach jeder Änderung automatisch dorthin gespeichert.'}
              </span>
              <div class="row">
                <button onClick={() => void chooseFile()}>{state.fileName ? 'Andere Datei wählen …' : 'Speicherort wählen …'}</button>
                {state.fileName && <button onClick={() => void forgetFile()}>Automatik beenden</button>}
              </div>
            </>
          ) : (
            <>
              <span class="muted">
                Safari (iPad, iPhone, Mac) erlaubt einer Web-App nicht, selbständig in eine Datei zu
                schreiben. Die Sicherung wird deshalb nach jeder Änderung im Hintergrund vorbereitet,
                und das Symbol zeigt ein Warnzeichen, bis sie mit einem Tippen auf „Jetzt sichern“ gespeichert ist.
              </span>
              <label class="row">
                <input type="radio" name="method" checked={method === 'share'} onChange={() => chooseMethod('share')} />
                <span>Über „Teilen“ → „In Dateien sichern“: Ort beim Sichern wählen (z. B. ein Ordner in iCloud Drive).</span>
              </label>
              <label class="row">
                <input type="radio" name="method" checked={method === 'download'} onChange={() => chooseMethod('download')} />
                <span>Als Download: landet im Download-Ordner von Safari (festzulegen in den iPad-Einstellungen bei Safari unter „Downloads“).</span>
              </label>
            </>
          )}
        </div>

        <div class="field">
          <strong>Speicher</strong>
          {size ? (
            <span class="muted">
              {size.pieces === 1 ? '1 Stück' : `${size.pieces} Stücke`}: {mb(size.photos + size.originals + size.pdfPages + size.recognized + size.covers)} –
              Fotos und Bilder {mb(size.photos)}, Original-PDFs {mb(size.originals)}, PDF-Seiten als Bild {mb(size.pdfPages)},
              erkannte Seiten {mb(size.recognized)}, Kachelbilder {mb(size.covers)}.
              {' '}Die Datei zum Teilen enthält davon etwa {mb(size.photos + size.originals)} (PDF-Seiten und erkannte Seiten werden auf dem anderen Gerät neu erzeugt).
              {size.usage !== undefined && <> Der Browser zählt für die App insgesamt {mb(size.usage)}.</>}
            </span>
          ) : <span class="muted">Wird berechnet …</span>}
          <span class="muted">
            „Fotos verkleinern“ speichert Screenshots und als PNG gespeicherte Bilder so, wie die
            Erkennung sie liest: in Graustufen, ohne Verlust und nicht größer als die Auflösung, mit
            der sie arbeitet – die Erkennung sieht danach dieselben Bildpunkte. Jedes Bild wird zur
            Sicherheit neu erkannt und nur ersetzt, wenn Note für Note dasselbe herauskommt.
            Kamerafotos (JPEG) wären so nicht kleiner und bleiben, wie sie sind. „Original sichern“
            liefert danach das Graustufenbild.
          </span>
          <div class="row">
            <button onClick={() => void optimize()} disabled={optimizing !== null}>{optimizing ?? 'Fotos verkleinern …'}</button>
          </div>
          {optimizeNote && <span class="muted">{optimizeNote}</span>}
        </div>

        <div class="field">
          <strong>Bibliothek mit anderen Geräten teilen</strong>
          <span class="muted">
            „Bibliothek teilen“ schickt alle Stücke als eine Datei, z. B. per WhatsApp an dich selbst.
            Auf dem anderen Gerät die Datei speichern und mit „Bibliothek übernehmen“ öffnen: Neue
            Stücke kommen dazu, bei Stücken, die auf beiden Geräten geändert wurden, gilt die neuere
            Änderung, und gelöschte Stücke werden auch dort gelöscht. Auch eine Sicherungsdatei lässt
            sich so übernehmen.
          </span>
          <div class="row">
            {sharing?.step === 'ready' ? (
              <button class="primary" onClick={() => void offer(sharing.blob, sharing.name)}>Jetzt teilen</button>
            ) : (
              <button onClick={() => void share()} disabled={sharing?.step === 'making'}>
                {sharing?.step === 'making' ? 'Datei wird erstellt …' : 'Bibliothek teilen …'}
              </button>
            )}
            <button onClick={() => restoreInput.current?.click()}>Bibliothek übernehmen …</button>
            <input ref={restoreInput} type="file" hidden onChange={(e) => void restore(e.currentTarget)} />
          </div>
          {shareNote && <span class="muted">{shareNote}</span>}
          {note && <span class="muted">{note}</span>}
        </div>

        <div class="field">
          <strong>Bilder der Kacheln</strong>
          <label class="row">
            <input type="checkbox" checked={coverSearch} onChange={(e) => void chooseCoverSearch(e.currentTarget.checked)} />
            <span>
              Cover-Bilder im Internet suchen: Titel und Interpret werden an die iTunes-Suche von Apple
              und an Wikipedia geschickt (sonst nichts). Ohne Treffer oder ausgeschaltet zeigt die
              Kachel den Kopf des Notenblatts.
            </span>
          </label>
        </div>

        <div class="actions">
          <span class="spacer" />
          <button onClick={props.onClose}>Schließen</button>
        </div>
      </div>
    </div>
  );
}
