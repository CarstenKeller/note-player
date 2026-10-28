// Reads the guitar part of a sheet: chord names (above notes or lyrics) and text tabs, and puts
// them on the time line of the sheet.

import type { Box, EventJ, ScoreJ } from '../score';
import { STRINGS, parseChord, voicing, type Chord } from './chords';
import { lineText, tokens, type TextLine, type Token } from './text';

const TPQ = 480;

export interface ChordMark {
  chord: Chord;
  box: Box;
  /** Ticks within the sheet. */
  start: number;
  end: number;
}

export interface TabNote {
  pitches: number[];
  box: Box;
  start: number;
  duration: number;
}

export interface GuitarSheet {
  chords: ChordMark[];
  tabNotes: TabNote[];
  /** Length of the sheet when it has no notes on staves (song sheet, text tabs). */
  length: number;
}

export interface GuitarOptions {
  /** Beats a chord lasts on a song sheet without notes. */
  beatsPerChord: number;
}

// separators that may stand between chords: bar lines, repeat marks, "x2", "N.C."
const SEPARATOR = /^(\||\|\||\/|%|:|\(|\)|-+|x\d+|\d+x|\d+×|×\d+|N\.?C\.?|\[|\]|\|:|:\|)$/i;

/**
 * A chord name written with a small letter, in a line with other chords: German song books
 * write minor chords so ("a" = A minor); a small "c" is usually a "C" (the two differ only in
 * size, text recognition mixes them up).
 */
function lowerCaseChord(text: string): Chord | null {
  if (!/^[a-h]/.test(text)) return null;
  const rest = text.slice(1);
  if (text[0] === 'c') return parseChord('C' + rest);
  return parseChord(text[0].toUpperCase() + (rest.startsWith('m') ? rest : 'm' + rest));
}

/**
 * Above staves only chord names stand (and perhaps some unreadable bits of chord diagrams):
 * every word that is a chord name counts.
 */
function chordTokensAboveStaff(l: TextLine): { token: Token; chord: Chord }[] {
  return tokens(l)
    .map((t) => ({ token: t, chord: parseChord(t.text) ?? (/^c/.test(t.text) ? parseChord('C' + t.text.slice(1)) : null) }))
    .filter((c): c is { token: Token; chord: Chord } => c.chord !== null);
}

/** The chords of a line in which nothing but chords (and separators) stands; else none. */
function chordTokens(l: TextLine): { token: Token; chord: Chord }[] {
  const all = tokens(l).filter((t) => !SEPARATOR.test(t.text));
  if (all.length === 0) return [];
  const strict = all.map((t) => parseChord(t.text));
  if (!strict.some(Boolean)) return [];
  const chords = all.map((t, k) => ({ token: t, chord: strict[k] ?? lowerCaseChord(t.text) }));
  if (chords.some((c) => !c.chord)) return [];
  return chords as { token: Token; chord: Chord }[];
}

// a text tab line: optional string name, a bar or colon, then mostly dashes and fret numbers
const TAB_LINE = /^\s*([A-Ga-g][#b]?)?\s*[|:]?\s*([-0-9|hpbrx/\\~*().<>sv^=+ ]{6,})\|?\s*$/;

function isTabLine(l: TextLine): boolean {
  const text = lineText(l);
  const m = TAB_LINE.exec(text);
  if (!m) return false;
  const body = m[2].replace(/\s/g, '');
  return body.length >= 6 && (body.match(/-/g)?.length ?? 0) >= 0.4 * body.length;
}

/** Reads blocks of six text tab lines (high e on top) into notes. */
function readTabBlock(lines: TextLine[], startTick: number): { notes: TabNote[]; end: number } {
  // column of each character from its position (works for text and recognized photos)
  const widths = lines.flatMap((l) => l.chars.map((c) => c.x1 - c.x0)).filter((w) => w > 0).sort((a, b) => a - b);
  const cw = widths[Math.floor(widths.length / 2)] || 1;
  const startX = (l: TextLine) => {
    const m = TAB_LINE.exec(lineText(l));
    const bodyStart = m ? lineText(l).indexOf(m[2]) : 0;
    return l.chars[Math.max(0, bodyStart)]?.x0 ?? 0;
  };
  const x0 = Math.min(...lines.map(startX));
  const columns = new Map<number, { frets: Map<number, number>; box: Box }>();
  lines.forEach((l, row) => {
    const string = 5 - row; // top line = high e (index 5 in STRINGS)
    const text = lineText(l);
    const m = TAB_LINE.exec(text);
    const bodyStart = m ? text.indexOf(m[2]) : 0;
    let i = bodyStart;
    while (i < l.chars.length) {
      if (!/[0-9]/.test(l.chars[i].c)) { i++; continue; }
      let j = i;
      while (j < l.chars.length && /[0-9]/.test(l.chars[j].c) && j - i < 2) j++;
      const fret = Number(l.chars.slice(i, j).map((c) => c.c).join(''));
      const col = Math.round((l.chars[i].x0 - x0) / cw);
      const entry = columns.get(col) ?? { frets: new Map(), box: [Infinity, Infinity, -Infinity, -Infinity] as Box };
      entry.frets.set(string, fret);
      entry.box = [Math.min(entry.box[0], l.chars[i].x0), Math.min(entry.box[1], l.y0), Math.max(entry.box[2], l.chars[j - 1].x1), Math.max(entry.box[3], l.y1)];
      columns.set(col, entry);
      i = j;
    }
  });
  const cols = [...columns.keys()].sort((a, b) => a - b);
  if (cols.length === 0) return { notes: [], end: startTick };
  // the most frequent distance between two notes is taken as an eighth note
  const gaps = cols.slice(1).map((c, k) => c - cols[k]);
  const count = new Map<number, number>();
  for (const g of gaps) count.set(g, (count.get(g) ?? 0) + 1);
  const unit = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 2;
  const notes: TabNote[] = [];
  let t = startTick;
  cols.forEach((c, k) => {
    const gap = k + 1 < cols.length ? cols[k + 1] - c : unit * 2;
    const duration = Math.max(TPQ / 4, Math.round((gap / unit) * 2) * (TPQ / 4));
    const e = columns.get(c)!;
    const pitches = [...e.frets.entries()].map(([s, f]) => STRINGS[s] + f).sort((a, b) => a - b);
    notes.push({ pitches, box: e.box, start: t, duration });
    t += duration;
  });
  return { notes, end: t };
}

/**
 * The guitar part of one sheet. [score] gives the time of chords written above notes;
 * without staves (a song sheet or text tabs) the chords and tabs follow one after the other.
 */
export function analyzeSheet(lines: TextLine[], score: ScoreJ | null, staffSpace: number, opts: GuitarOptions): GuitarSheet {
  const hasStaves = !!score && score.staves.length > 0 && score.events.length > 0;
  const chords: ChordMark[] = [];
  const tabNotes: TabNote[] = [];
  let length = 0;

  if (hasStaves) {
    const ss = staffSpace || 10;
    for (const l of lines) {
      // a line of text above a staff (a title, a tempo mark) has (almost) no chord names
      const found = chordTokensAboveStaff(l);
      if (found.length === 0 || found.length < 0.5 * tokens(l).length) continue;
      for (const { token, chord } of found) {
        // the system right below the chord name
        const sys = score!.systems
          .map((s) => ({ s, gap: s.box[1] - token.y1 }))
          .filter(({ s, gap }) => gap > -0.5 * ss && gap < 12 * ss && token.x1 > s.box[0] && token.x0 < s.box[2])
          .sort((a, b) => a.gap - b.gap)[0]?.s;
        if (!sys) continue;
        const start = tickAt(score!.events.filter((e) => e.system === sys.index), token.x0, ss);
        if (start === null) continue;
        chords.push({ chord, box: [token.x0, token.y0, token.x1, token.y1], start, end: start });
      }
    }
    chords.sort((a, b) => a.start - b.start);
    const total = score!.events.reduce((m, e) => Math.max(m, e.start + e.duration), 0);
    chords.forEach((c, k) => (c.end = k + 1 < chords.length ? chords[k + 1].start : total));
    return { chords: chords.filter((c) => c.end > c.start), tabNotes, length: total };
  }

  // a song sheet or text tabs: in reading order
  let t = 0;
  for (let i = 0; i < lines.length; i++) {
    if (isTabLine(lines[i])) {
      let j = i;
      while (j < lines.length && isTabLine(lines[j])) j++;
      // blocks of six lines (a bass tab has four and is left out)
      for (let k = i; k + 6 <= j; k += 6) {
        const block = readTabBlock(lines.slice(k, k + 6), t);
        tabNotes.push(...block.notes);
        t = block.end;
      }
      i = j - 1;
      continue;
    }
    for (const { token, chord } of chordTokens(lines[i])) {
      const end = t + opts.beatsPerChord * TPQ;
      chords.push({ chord, box: [token.x0, token.y0, token.x1, token.y1], start: t, end });
      t = end;
    }
  }
  length = t;
  return { chords, tabNotes, length };
}

/** The time of a chord written at [x]: the note it stands above, or between two notes. */
function tickAt(events: EventJ[], x: number, ss: number): number | null {
  if (events.length === 0) return null;
  let best: EventJ | null = null;
  for (const e of events) if (!best || Math.abs(e.box[0] - x) < Math.abs(best.box[0] - x)) best = e;
  if (best && Math.abs(best.box[0] - x) <= 2.5 * ss) return best.start;
  const left = events.filter((e) => e.box[0] <= x).sort((a, b) => b.box[0] - a.box[0])[0];
  const right = events.filter((e) => e.box[0] > x).sort((a, b) => a.box[0] - b.box[0])[0];
  if (left && right && right.box[0] > left.box[0]) {
    const f = (x - left.box[0]) / (right.box[0] - left.box[0]);
    return Math.round((left.start + f * (right.start - left.start)) / (TPQ / 4)) * (TPQ / 4);
  }
  return (left ?? right).start;
}

export type StrumPattern = 'once' | 'quarter' | 'eighth';

/** The strokes of a chord: once, on every beat (down), or on every eighth (down and up). */
export function strums(c: ChordMark, pattern: StrumPattern): { start: number; duration: number; strum: number; pitches: number[] }[] {
  const pitches = voicing(c.chord);
  if (pattern === 'once') return [{ start: c.start, duration: c.end - c.start, strum: 1, pitches }];
  const step = pattern === 'quarter' ? TPQ : TPQ / 2;
  const out = [];
  let k = 0;
  for (let t = c.start; t < c.end; t += step, k++) {
    out.push({ start: t, duration: Math.min(step, c.end - t), strum: pattern === 'eighth' && k % 2 === 1 ? -1 : 1, pitches });
  }
  return out;
}
