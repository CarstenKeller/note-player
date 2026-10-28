import { useEffect, useRef, useState } from 'preact/hooks';
import {
  canWriteAutomatically, chooseFile, forgetFile, manualMethod, saveNow, setManualMethod, subscribe,
  type BackupState, type ManualMethod,
} from '../autobackup';
import { importAll } from '../backup';
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

function BackupDialog(props: { state: BackupState; onClose: () => void; onRestored?: () => void }) {
  const { state } = props;
  const [method, setMethod] = useState<ManualMethod>('share');
  const [note, setNote] = useState<string | null>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  useEffect(() => void manualMethod().then(setMethod), []);

  const chooseMethod = (m: ManualMethod) => {
    setMethod(m);
    void setManualMethod(m);
  };

  const restore = async (input: HTMLInputElement) => {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    setNote('Sicherung wird gelesen …');
    try {
      const n = await importAll(f);
      setNote(n === 1 ? '1 Stück übernommen.' : `${n} Stücke übernommen (vorhandene bleiben unverändert).`);
      props.onRestored?.();
    } catch (e) {
      setNote('Die Sicherung konnte nicht gelesen werden: ' + (e as Error).message);
    }
  };

  return (
    <div class="overlay" onClick={props.onClose}>
      <div class="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Sicherung</h2>

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
          <strong>Sicherung laden</strong>
          <span class="muted">Übernimmt die Stücke aus einer Sicherungsdatei, z. B. auf einem neuen Gerät. Vorhandene Stücke bleiben unverändert.</span>
          <div class="row">
            <button onClick={() => restoreInput.current?.click()}>Sicherungsdatei wählen …</button>
            <input ref={restoreInput} type="file" accept=".zip,application/zip" hidden onChange={(e) => void restore(e.currentTarget)} />
          </div>
          {note && <span class="muted">{note}</span>}
        </div>

        <div class="actions">
          <span class="spacer" />
          <button onClick={props.onClose}>Schließen</button>
        </div>
      </div>
    </div>
  );
}
