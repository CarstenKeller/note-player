import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { db, type Piece } from '../db';
import { recognizeSheet, releaseWorker, type ShownSheet } from '../engine';
import { importFiles } from '../importer';
import { INSTRUMENTS, Player } from '../audio';
import { joinSheets, secondsOf, type Box, type EventJ, type PieceEvent, type PieceScore } from '../score';
import { keepAwake } from '../wakelock';
import { download } from '../backup';
import { PieceDialog } from './PieceDialog';
import { BackupStatus } from './BackupStatus';

/** Without a setting, 100 % means 120 quarter notes per minute (tempo marks are not read). */
const DEFAULT_BPM = 120;
const MAX_ZOOM = 4;

interface SheetState {
  id: string;
  shown?: ShownSheet;
  error?: string;
}

type Mode = 'play' | 'scroll';

const player = new Player();

/** Part of a page that is shown: without the empty margins, page numbers and footers. */
interface Crop { top: number; bottom: number }

export function PieceView(props: { piece: Piece; allCategories: string[]; allArtists: string[]; onBack: () => void }) {
  const [piece, setPiece] = useState(props.piece);
  const [sheets, setSheets] = useState<SheetState[]>(props.piece.sheets.map((id) => ({ id })));
  const [working, setWorking] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('play');

  const [playing, setPlaying] = useState(false);
  const [preparing, setPreparing] = useState(false);
  /** The events sounding now (indices into score.events); only updated when they change. */
  const [litNow, setLitNow] = useState<number[]>([]);
  const [startTick, setStartTick] = useState(0);
  const [tempoPercent, setTempoPercent] = useState(100);
  const [includeVocals, setIncludeVocals] = useState(false);
  const [instrument, setInstrument] = useState('GRAND_PIANO');
  const [error, setError] = useState<string | null>(null);

  const [scrolling, setScrolling] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [panel, setPanel] = useState(false);
  const [sheetMenu, setSheetMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showWarnings, setShowWarnings] = useState(false);
  /** Frame all recognized notes (to see what was read). */
  const [outline, setOutline] = useState(true);
  /** Leave out the margins of the pages (title area of later pages, footers, page numbers). */
  const [cropPages, setCropPages] = useState(true);

  const container = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const pageEls = useRef<(HTMLDivElement | null)[]>([]);

  const baseBpm = piece.bpm ?? DEFAULT_BPM;
  const bpm = Math.max(10, Math.round((baseBpm * tempoPercent) / 100));
  const scrollBpm = piece.scrollBpm ?? baseBpm;

  const savePiece = async (p: Piece) => {
    setPiece(p);
    await db.savePiece(p);
  };

  // remember when the piece was opened; settings
  useEffect(() => {
    void savePiece({ ...props.piece, opened: Date.now() });
    void db.setting<string>('instrument').then((i) => i && setInstrument(i));
    void db.setting<boolean>('outline').then((v) => v !== undefined && setOutline(v));
    void db.setting<boolean>('crop').then((v) => v !== undefined && setCropPages(v));
    player.onEnded = () => {
      setPlaying(false);
      setLitNow([]);
      keepAwake(false);
    };
    return () => {
      player.stop();
      player.onEnded = null;
      keepAwake(false);
    };
  }, []);

  // recognize the sheets that are not recognized yet, one after the other
  useEffect(() => {
    const todo = sheets.findIndex((s) => !s.shown && !s.error);
    if (todo < 0) {
      setWorking(null);
      // the recognition leaves a lot of memory in the worker: start afresh for the sound
      releaseWorker();
      return;
    }
    let cancelled = false;
    setWorking(sheets.length > 1 ? `Blatt ${todo + 1} von ${sheets.length} wird erkannt …` : 'Die Noten werden erkannt …');
    const id = sheets[todo].id;
    recognizeSheet(id)
      .then((shown) => !cancelled && setSheets((all) => all.map((s) => (s.id === id ? { ...s, shown } : s))))
      .catch((e: Error) => !cancelled && setSheets((all) => all.map((s) => (s.id === id ? { ...s, error: e.message } : s))));
    return () => {
      cancelled = true;
    };
  }, [sheets]);

  const score: PieceScore = useMemo(
    () => joinSheets(sheets.map((s) => (s.shown ? (includeVocals ? s.shown.result.score : s.shown.result.withoutVocals) : null))),
    [sheets, includeVocals],
  );
  const hasVocals = sheets.some((s) => s.shown?.result.score.staves.some((st) => st.vocal));
  const warnings = sheets.flatMap((s, i) => [
    ...(s.shown?.result.warnings ?? []).map((w) => (sheets.length > 1 ? `Blatt ${i + 1}: ${w}` : w)),
    ...(s.error ? [`Blatt ${i + 1}: ${s.error}`] : []),
  ]);
  const noteCount = score.events.filter((e) => e.pitches.length > 0).length;
  /** All sheets are recognized (or failed); before that, the music is not complete. */
  const ready = sheets.length > 0 && sheets.every((s) => s.shown || s.error);

  /** Measure numbers through the whole piece (for "ab Takt n"). */
  const measureOf = useMemo(() => {
    const numbers = new Map<string, number>();
    for (const e of score.events) {
      const key = `${e.sheet}/${e.system}/${e.measure}`;
      if (!numbers.has(key)) numbers.set(key, numbers.size + 1);
    }
    return (e: PieceEvent) => numbers.get(`${e.sheet}/${e.system}/${e.measure}`) ?? 1;
  }, [score]);

  const crops: Crop[] = useMemo(() => sheets.map((s, i) => {
    const shown = s.shown;
    if (!shown) return { top: 0, bottom: 1 };
    const staves = shown.result.score.staves;
    if (!cropPages || staves.length === 0) return { top: 0, bottom: shown.height };
    const ss = shown.result.staffSpace;
    // room for chord names, fingering and notes on ledger lines above and below the staves;
    // the first page keeps its title
    const top = i === 0 ? 0 : Math.max(0, Math.min(...staves.map((st) => st.box[1])) - 5 * ss);
    const bottom = Math.min(shown.height, Math.max(...staves.map((st) => st.box[3])) + 4 * ss);
    return { top, bottom: Math.max(bottom, top + 1) };
  }), [sheets, cropPages]);

  // the sound is prepared as soon as the music is complete, so that starting is immediate
  useEffect(() => {
    if (ready && noteCount > 0) player.prepare(score, bpm, instrument).catch(() => undefined);
  }, [ready, score, bpm, instrument]);

  // --- playback --------------------------------------------------------------------------

  const stop = () => {
    player.stop();
    setPlaying(false);
    setLitNow([]);
    keepAwake(false);
  };

  const play = async (from = startTick) => {
    player.unlock(); // in the tap itself (Safari)
    if (noteCount === 0 || !ready) return;
    setError(null);
    setPreparing(true);
    try {
      await player.prepare(score, bpm, instrument);
      player.play(from);
      setPlaying(true);
      keepAwake(true);
    } catch (e) {
      setError('Abspielen nicht möglich: ' + (e as Error).message);
    } finally {
      setPreparing(false);
    }
  };

  // a changed tempo, sound or voice selection while playing: continue at the same place
  const restartRef = useRef(false);
  useEffect(() => {
    if (!restartRef.current) {
      restartRef.current = true;
      return;
    }
    if (player.playing) {
      const at = Math.round(player.currentTick());
      player.stop();
      void play(at);
    }
  }, [bpm, instrument, score]);

  // position while playing, and the page follows the music
  const lastSystem = useRef<number>(-1);
  useEffect(() => {
    if (!playing) return;
    lastSystem.current = -1;
    let frame = 0;
    let shown = '';
    const step = () => {
      const t = player.currentTick();
      // re-draw only when other notes sound (not 60 times a second)
      const now: number[] = [];
      score.events.forEach((e, k) => {
        if (e.pitches.length > 0 && t >= e.start && t < e.start + Math.max(e.duration, 1)) now.push(k);
      });
      const key = now.join(',');
      if (key !== shown) {
        shown = key;
        setLitNow(now);
      }
      follow(t);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, zoom, score]);

  /** Scrolls so that the line being played is in view (only when a new line begins). */
  const follow = (t: number) => {
    const idx = score.systems.findIndex((s) => t >= s.start && t < s.end);
    if (idx < 0 || idx === lastSystem.current) return;
    lastSystem.current = idx;
    const sys = score.systems[idx];
    const box = boxOnScreen(sys.sheet, sys.box);
    const c = container.current;
    if (!box || !c) return;
    const top = box.top - c.clientHeight * 0.15;
    if (box.top < c.scrollTop + c.clientHeight * 0.05 || box.bottom > c.scrollTop + c.clientHeight * 0.9) {
      c.scrollTo({ top, behavior: 'smooth' });
    }
  };

  /** Position of a box of a page inside the scrolling content (CSS pixels). */
  const boxOnScreen = (sheet: number, b: Box) => {
    const el = pageEls.current[sheet];
    const shown = sheets[sheet]?.shown;
    if (!el || !shown) return null;
    const scale = el.clientWidth / shown.width;
    const top = crops[sheet].top;
    return { top: el.offsetTop + (b[1] - top) * scale, bottom: el.offsetTop + (b[3] - top) * scale };
  };

  // --- scroll mode ----------------------------------------------------------------------

  const touching = useRef(0);
  useEffect(() => {
    if (!scrolling) return;
    const c = container.current!;
    keepAwake(true);
    // speed: the whole piece in the time it lasts at the chosen tempo (the empty space below
    // the music lets the last line move up); without recognized music, a screen in two minutes
    const pixelsPerSecond = () => {
      const travel = Math.max(1, c.scrollHeight - c.clientHeight * 0.6);
      const seconds = score.totalTicks > 0 ? secondsOf(score.totalTicks, scrollBpm, score.tpq) : 120 * (inner.current!.clientHeight / c.clientHeight);
      return travel / Math.max(10, seconds);
    };
    let pos = c.scrollTop;
    let last = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      // moved by hand (or the finger is on the page): continue from there
      if (Math.abs(c.scrollTop - pos) > 2 || touching.current > 0) pos = c.scrollTop;
      else {
        pos += pixelsPerSecond() * dt;
        c.scrollTop = pos;
      }
      if (c.scrollTop + c.clientHeight >= c.scrollHeight - 1) {
        setScrolling(false);
        return;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      keepAwake(false);
    };
  }, [scrolling, scrollBpm, score, zoom]);

  const switchMode = (m: Mode) => {
    if (m === mode) return;
    stop();
    setScrolling(false);
    setMode(m);
  };

  // --- tapping on the music ---------------------------------------------------------------

  const tapPage = (sheet: number, e: MouseEvent) => {
    if (mode === 'scroll') {
      setScrolling(!scrolling);
      return;
    }
    const el = pageEls.current[sheet];
    const shown = sheets[sheet]?.shown;
    if (!el || !shown) return;
    const r = el.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * shown.width;
    const crop = crops[sheet];
    const y = crop.top + ((e.clientY - r.top) / r.height) * (crop.bottom - crop.top);
    // the nearest note of that page (rests too, so a piece can start with one)
    let best: PieceEvent | null = null;
    let bestDist = Infinity;
    for (const ev of score.events) {
      if (ev.sheet !== sheet) continue;
      const dx = Math.max(ev.box[0] - x, 0, x - ev.box[2]);
      const dy = Math.max(ev.box[1] - y, 0, y - ev.box[3]);
      const dist = dx * dx + 4 * dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = ev;
      }
    }
    const limit = (shown.result.staffSpace * 6) ** 2;
    if (!best || bestDist > limit) return;
    setStartTick(best.start);
    if (playing) player.play(best.start);
  };

  // --- zoom (buttons and two fingers) ---------------------------------------------------

  const applyZoom = (z: number, cx?: number, cy?: number) => {
    const c = container.current;
    const nz = Math.min(MAX_ZOOM, Math.max(1, z));
    if (!c) return setZoom(nz);
    const px = cx ?? c.clientWidth / 2;
    const py = cy ?? c.clientHeight / 2;
    const ratio = nz / zoomRef.current;
    const left = (c.scrollLeft + px) * ratio - px;
    const top = (c.scrollTop + py) * ratio - py;
    zoomRef.current = nz;
    inner.current!.style.width = `${nz * 100}%`;
    c.scrollLeft = left;
    c.scrollTop = top;
  };
  const zoomRef = useRef(1);
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const touchDist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const onTouchStart = (e: TouchEvent) => {
    touching.current = e.touches.length;
    if (e.touches.length === 2) pinch.current = { dist: touchDist(e.touches), zoom: zoomRef.current };
  };
  const onTouchMove = (e: TouchEvent) => {
    if (e.touches.length !== 2 || !pinch.current) return;
    e.preventDefault();
    const r = container.current!.getBoundingClientRect();
    const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
    const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
    applyZoom((pinch.current.zoom * touchDist(e.touches)) / pinch.current.dist, cx, cy);
  };
  const onTouchEnd = (e: TouchEvent) => {
    touching.current = e.touches.length;
    if (e.touches.length < 2 && pinch.current) {
      pinch.current = null;
      setZoom(zoomRef.current);
    }
  };
  const zoomBy = (f: number) => {
    applyZoom(zoomRef.current * f);
    setZoom(zoomRef.current);
  };

  // --- sheets ---------------------------------------------------------------------------

  const camera = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replacing = useRef(-1);

  const changeSheets = async (ids: string[], removed: string[] = []) => {
    stop();
    for (const id of removed) await db.deleteSheet(id);
    await savePiece({ ...piece, sheets: ids });
    setSheets(ids.map((id) => sheets.find((s) => s.id === id) ?? { id }));
    setStartTick(0);
  };

  const addFiles = async (input: HTMLInputElement) => {
    const list = [...(input.files ?? [])];
    input.value = '';
    if (!list.length) return;
    try {
      const ids = await importFiles(list, setWorking);
      await changeSheets([...piece.sheets, ...ids]);
    } catch (e) {
      setWorking(null);
      setError((e as Error).message);
    }
  };

  const replaceFile = async (input: HTMLInputElement) => {
    const list = [...(input.files ?? [])];
    input.value = '';
    const i = replacing.current;
    if (!list.length || i < 0) return;
    try {
      const ids = await importFiles(list, setWorking);
      const next = [...piece.sheets];
      const old = next.splice(i, 1, ...ids);
      await changeSheets(next, old);
    } catch (e) {
      setWorking(null);
      setError((e as Error).message);
    }
  };

  const move = (i: number, d: number) => {
    const next = [...piece.sheets];
    const [s] = next.splice(i, 1);
    next.splice(i + d, 0, s);
    void changeSheets(next);
  };

  const saveOriginal = async (i: number) => {
    const s = await db.sheet(piece.sheets[i]);
    if (s) download(s.blob, s.name);
  };

  // --- what is lit up ---------------------------------------------------------------------

  const lit: PieceEvent[] = useMemo(() => litNow.map((k) => score.events[k]).filter(Boolean), [litNow, score]);
  /** The chosen start: the notes there are marked while the music stands. */
  const startEvents = useMemo(
    () => (playing || startTick === 0 ? [] : score.events.filter((e) => e.start === startTick && e.pitches.length > 0)),
    [playing, startTick, score],
  );
  const startMeasure = useMemo(() => {
    const e = score.events.find((x) => x.start >= startTick);
    return e ? measureOf(e) : 1;
  }, [score, startTick, measureOf]);
  /** Recognized notes and rests per page, for the frames (the vocal line too, even if not played). */
  const notesBySheet = useMemo(
    () => sheets.map((s) => (outline && mode === 'play' && s.shown ? s.shown.result.score.events : [])),
    [outline, sheets, mode],
  );

  const mark = (e: EventJ, shown: ShownSheet, cls: string, k: number | string) => {
    const pad = shown.result.staffSpace * (cls === 'note' ? 0.15 : 0.4);
    const w = shown.width;
    const h = shown.height;
    return (
      <div key={k} class={'mark ' + cls} style={{
        left: `${((e.box[0] - pad) / w) * 100}%`,
        top: `${((e.box[1] - pad) / h) * 100}%`,
        width: `${((e.box[2] - e.box[0] + 2 * pad) / w) * 100}%`,
        height: `${((e.box[3] - e.box[1] + 2 * pad) / h) * 100}%`,
      }} />
    );
  };

  const setSetting = (key: string, value: boolean, set: (v: boolean) => void) => {
    set(value);
    void db.saveSetting(key, value);
  };

  const status = working ?? (sheets.length > 0 && sheets.every((s) => s.shown || s.error)
    ? (noteCount > 0 ? `${noteCount} Noten erkannt` : 'Keine Noten erkannt')
    : '');

  return (
    <div class="piece">
      <header class="bar">
        <button class="icon" aria-label="Zurück" onClick={() => { stop(); props.onBack(); }}>‹</button>
        <button class="title" onClick={() => setEditing(true)} title="Name und Rubriken">
          <span class="name">{piece.name}</span>
          {piece.artist && <span class="muted"> – {piece.artist}</span>}
          {piece.categories.length > 0 && <span class="muted small"> · {piece.categories.join(', ')}</span>}
        </button>
        <span class="spacer" />
        <span class="muted small status">{status}</span>
        <BackupStatus />
        <button onClick={() => setSheetMenu(!sheetMenu)}>Blätter ▾</button>
      </header>

      {sheetMenu && (
        <div class="menu" onClick={(e) => e.stopPropagation()}>
          <div class="row">
            <button onClick={() => camera.current?.click()}>📷 Blatt fotografieren</button>
            <button onClick={() => files.current?.click()}>＋ Bilder / PDF anhängen</button>
          </div>
          {piece.sheets.map((id, i) => (
            <div class="row sheet" key={id}>
              <span>Blatt {i + 1}{sheets[i]?.error ? ' – nicht erkannt' : ''}</span>
              <span class="spacer" />
              <button class="icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label="nach oben">↑</button>
              <button class="icon" disabled={i === piece.sheets.length - 1} onClick={() => move(i, 1)} aria-label="nach unten">↓</button>
              <button onClick={() => { replacing.current = i; replaceInput.current?.click(); }}>Ersetzen</button>
              <button onClick={() => saveOriginal(i)}>Original sichern</button>
              <button class="danger-outline" disabled={piece.sheets.length === 1} onClick={() => changeSheets(piece.sheets.filter((x) => x !== id), [id])}>Entfernen</button>
            </div>
          ))}
          <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { setSheetMenu(false); void addFiles(e.currentTarget); }} />
          <input ref={files} type="file" accept="image/*,application/pdf,.pdf" multiple hidden onChange={(e) => { setSheetMenu(false); void addFiles(e.currentTarget); }} />
          <input ref={replaceInput} type="file" accept="image/*,application/pdf,.pdf" hidden onChange={(e) => { setSheetMenu(false); void replaceFile(e.currentTarget); }} />
        </div>
      )}

      {(warnings.length > 0 || error) && (
        <div class="warnings" onClick={() => setShowWarnings(!showWarnings)}>
          {error && <div class="error">{error}</div>}
          {warnings.length > 0 && (showWarnings
            ? warnings.map((w, i) => <div key={i}>⚠ {w}</div>)
            : <div>⚠ {warnings.length === 1 ? '1 Hinweis' : `${warnings.length} Hinweise`} zur Erkennung (antippen)</div>)}
        </div>
      )}

      <div class="pages" ref={container} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
        <div class={'pages-inner' + (cropPages ? ' cropped' : '')} ref={inner} style={{ width: `${zoom * 100}%`, paddingBottom: mode === 'scroll' ? '60vh' : 0 }}>
          {sheets.map((s, i) => (
            <div class="page" key={s.id} ref={(el) => (pageEls.current[i] = el)} onClick={(e) => tapPage(i, e)}
              style={s.shown ? { aspectRatio: `${s.shown.width} / ${crops[i].bottom - crops[i].top}` } : undefined}>
              {s.shown ? (
                <div class="sheet" style={{
                  top: `${(-crops[i].top / (crops[i].bottom - crops[i].top)) * 100}%`,
                  height: `${(s.shown.height / (crops[i].bottom - crops[i].top)) * 100}%`,
                }}>
                  <img src={s.shown.url} alt={`Blatt ${i + 1}`} draggable={false} />
                  {notesBySheet[i]?.map((e, k) => mark(e, s.shown!, 'note', 'n' + k))}
                  {startEvents.filter((e) => e.sheet === i).map((e, k) => mark(e, s.shown!, 'start', 's' + k))}
                  {lit.filter((e) => e.sheet === i).map((e, k) => mark(e, s.shown!, 'lit', 'l' + k))}
                </div>
              ) : (
                <div class="placeholder">{s.error ? `Blatt ${i + 1} konnte nicht erkannt werden: ${s.error}` : `Blatt ${i + 1} wird erkannt …`}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {panel && (
        <div class="panel">
          <div class="row">
            <span>Grundtempo (100 %)</span>
            <span class="spacer" />
            <button onClick={() => savePiece({ ...piece, bpm: Math.max(20, baseBpm - 4) })}>−</button>
            <span class="value">♩ = {baseBpm}</span>
            <button onClick={() => savePiece({ ...piece, bpm: Math.min(300, baseBpm + 4) })}>+</button>
          </div>
          <div class="row">
            <span>Klang</span>
            <span class="spacer" />
            <select value={instrument} onChange={(e) => { setInstrument(e.currentTarget.value); void db.saveSetting('instrument', e.currentTarget.value); }}>
              {INSTRUMENTS.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
            </select>
          </div>
          {hasVocals && (
            <label class="row">
              <span>Gesangsstimme mitspielen</span>
              <span class="spacer" />
              <input type="checkbox" checked={includeVocals} onChange={(e) => setIncludeVocals(e.currentTarget.checked)} />
            </label>
          )}
          <label class="row">
            <span>Erkannte Noten umrahmen (beim Abspielen)</span>
            <span class="spacer" />
            <input type="checkbox" checked={outline} onChange={(e) => setSetting('outline', e.currentTarget.checked, setOutline)} />
          </label>
          <label class="row">
            <span>Seitenränder ausblenden (Kopf- und Fußzeilen)</span>
            <span class="spacer" />
            <input type="checkbox" checked={cropPages} onChange={(e) => setSetting('crop', e.currentTarget.checked, setCropPages)} />
          </label>
          <div class="row">
            <span>Ansicht</span>
            <span class="spacer" />
            <button onClick={() => zoomBy(1 / 1.25)} disabled={zoom <= 1}>−</button>
            <span class="value">{Math.round(zoom * 100)} %</span>
            <button onClick={() => zoomBy(1.25)} disabled={zoom >= MAX_ZOOM}>+</button>
          </div>
        </div>
      )}

      <footer class="controls">
        <div class="segmented">
          <button class={mode === 'play' ? 'on' : ''} onClick={() => switchMode('play')}>Abspielen</button>
          <button class={mode === 'scroll' ? 'on' : ''} onClick={() => switchMode('scroll')}>Scrollen</button>
        </div>
        {mode === 'play' ? (
          <>
            <button class="primary big" disabled={noteCount === 0 || preparing || !ready} onClick={() => (playing ? stop() : void play())}>
              {preparing || !ready ? '…' : playing ? '■' : '▶'}
            </button>
            <button onClick={() => setTempoPercent(Math.max(25, tempoPercent - 10))}>−</button>
            <span class="value" title={`♩ = ${bpm}`}>{tempoPercent} %</span>
            <button onClick={() => setTempoPercent(Math.min(200, tempoPercent + 10))}>+</button>
            {startTick > 0
              ? <button class="start-chip" onClick={() => setStartTick(0)} title="Wieder vom Anfang">ab Takt {startMeasure} ✕</button>
              : <span class="muted small hint">Startstelle: Note antippen</span>}
          </>
        ) : (
          <>
            <button class="primary big" onClick={() => setScrolling(!scrolling)}>{scrolling ? '❚❚' : '▶'}</button>
            <button onClick={() => savePiece({ ...piece, scrollBpm: Math.max(10, scrollBpm - 4) })}>−</button>
            <span class="value" title="Scrollgeschwindigkeit als Tempo">♩ = {scrollBpm}</span>
            <button onClick={() => savePiece({ ...piece, scrollBpm: Math.min(300, scrollBpm + 4) })}>+</button>
            <button onClick={() => { container.current?.scrollTo({ top: 0 }); }} title="Zum Anfang">⤒</button>
          </>
        )}
        <span class="spacer" />
        <button class={panel ? 'on' : ''} onClick={() => setPanel(!panel)} aria-label="Einstellungen">⚙</button>
      </footer>

      {editing && (
        <PieceDialog
          piece={piece}
          allCategories={props.allCategories}
          allArtists={props.allArtists}
          onClose={() => setEditing(false)}
          onSave={async (name, artist, categories) => {
            await savePiece({ ...piece, name, artist: artist || undefined, categories });
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}
