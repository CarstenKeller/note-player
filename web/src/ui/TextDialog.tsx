import { useState } from 'preact/hooks';

/** Pasting text: tabs (e|---0---) or a song text with chord names above the lines. */
export function TextDialog(props: { withName?: boolean; onDone: (text: string, name: string) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  return (
    <div class="overlay" onClick={props.onClose}>
      <div class="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Text einfügen</h2>
        <p class="muted">
          Gitarren-Tabs (Zeilen wie „e|---0---3---|“) oder ein Liedtext mit Akkorden über den Zeilen,
          z. B. aus dem Internet kopiert. Das Stück wird im Gitarren-Modus geöffnet.
        </p>
        {props.withName && (
          <label class="field">
            Name
            <input value={name} placeholder="Name des Stücks" onInput={(e) => setName(e.currentTarget.value)} />
          </label>
        )}
        <textarea class="paste" value={text} spellcheck={false} placeholder={'Am        G\nIch hab den Text hier ...\n\ne|-----0---------|\nB|---1---1-------|\nG|-2-------2-----|\nD|---------------|\nA|---------------|\nE|---------------|'}
          onInput={(e) => setText(e.currentTarget.value)} />
        <div class="actions">
          <span class="spacer" />
          <button onClick={props.onClose}>Abbrechen</button>
          <button class="primary" disabled={!text.trim()} onClick={() => props.onDone(text, name.trim())}>Übernehmen</button>
        </div>
      </div>
    </div>
  );
}
