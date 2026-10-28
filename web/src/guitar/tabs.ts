// Reading tablature staves (six lines with fret numbers) under a staff of notes: the numbers
// give string and fret, the notes above them the rhythm.

import type { Box, EventJ, ScoreJ } from '../score';
import { STRINGS } from './chords';
import { lineText, type TextLine, type TextPiece } from './text';

const LETTERS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11, H: 11 };

/**
 * The tuning written on the sheet, low string first ("Tuning (low to high): C G D G B♭ D",
 * "Drop D"); null when none is given (standard tuning).
 */
export function readTuning(lines: TextLine[]): number[] | null {
  for (let i = 0; i < lines.length; i++) {
    const text = lineText(lines[i]);
    if (/drop\s*d\b/i.test(text)) return [38, 45, 50, 55, 59, 64];
    if (!/tuning|stimmung/i.test(text)) continue;
    // the names may follow on the same or the next line
    for (const t of [text.replace(/^.*?(tuning|stimmung)[^:]*:?/i, ''), lineText(lines[i + 1] ?? { y0: 0, y1: 0, chars: [] })]) {
      const names = t.split(/[\s,–-]+/).filter((w) => /^[A-H][#b♭♯]?$/.test(w));
      if (names.length === 6) {
        return names.map((n, s) => {
          const pc = (LETTERS[n[0]] + (n[1] === '#' || n[1] === '♯' ? 1 : n[1] === 'b' || n[1] === '♭' ? -1 : 0) + 12) % 12;
          // the octave closest to the standard tuning of that string
          const std = STRINGS[s];
          let p = std - ((std - pc) % 12 + 12) % 12;
          if (std - p > 6) p += 12;
          return p;
        });
      }
    }
  }
  return null;
}

export interface TabRead {
  notes: { pitches: number[]; box: Box; start: number; duration: number }[];
  /** Staves of notes with a tablature below (the guitar's part). */
  guitarStaves: number[];
  /** The notes of those staves that are played from the tablature (the others from the notes). */
  covered: EventJ[];
}

/**
 * The fret numbers in the tablatures of a sheet. [tabs] are the boxes of the tablature staves
 * (six lines; the box reaches a little beyond the outer lines), [pieces] the text on the page.
 */
export function readTabStaves(pieces: TextPiece[], tabs: Box[], score: ScoreJ, staffSpace: number, tuning: number[], capo = 0): TabRead {
  const ss = staffSpace || 10;
  const notes: TabRead['notes'] = [];
  const guitarStaves: number[] = [];
  const covered: EventJ[] = [];
  for (const tab of tabs) {
    // the lines: the box reaches 0.7 line spacings beyond the outer lines
    const spacing = (tab[3] - tab[1]) / 6.4;
    const firstLine = tab[1] + 0.7 * spacing;
    // the staff of notes right above it gives the rhythm
    const staff = score.staves
      .filter((s) => s.box[3] <= tab[1] + spacing && tab[1] - s.box[3] < 16 * ss && s.box[2] > tab[0] && s.box[0] < tab[2])
      .sort((a, b) => b.box[3] - a.box[3])[0];
    if (!staff) continue;
    guitarStaves.push(staff.index);
    const events = score.events.filter((e) => e.staff === staff.index && e.pitches.length > 0);
    // numbers on the lines: one per fret (a two-digit fret is one piece of text, or two
    // digits side by side)
    const digits = pieces
      .flatMap(splitDigits)
      // (not in the "TAB" at the start of the lines)
      .filter((d) => d.cx > tab[0] + ss + 2 * spacing && d.cx < tab[2] && d.cy > tab[1] && d.cy < tab[3]);
    const byColumn = new Map<EventJ, { strings: Map<number, number>; box: Box; ocr: boolean }>();
    for (const d of digits) {
      const string = Math.round((d.cy - firstLine) / spacing); // 0 = top line = highest string
      if (string < 0 || string > 5) continue;
      const ev = nearestEvent(events, d.cx, 1.5 * ss);
      if (!ev) continue;
      const entry = byColumn.get(ev) ?? { strings: new Map(), box: [Infinity, Infinity, -Infinity, -Infinity] as Box, ocr: false };
      entry.ocr ||= d.ocr;
      entry.strings.set(5 - string, d.fret);
      entry.box = [Math.min(entry.box[0], d.x0), Math.min(entry.box[1], d.y0), Math.max(entry.box[2], d.x1), Math.max(entry.box[3], d.y1)];
      byColumn.set(ev, entry);
    }
    for (const [ev, e] of byColumn) {
      const pitches = [...e.strings.entries()].map(([s, f]) => tuning[s] + f).sort((a, b) => a - b);
      // numbers read by text recognition are often wrong (6 for 8, 0 for 3): taken only when
      // they agree with the note above (in any octave; with a capo the notes may be written
      // as sounding or as fingered)
      if (e.ocr && ![0, capo].some((shift) => pitches.some((p) => ev.pitches.some((q) => (p + shift - q) % 12 === 0)))) continue;
      notes.push({ pitches, box: e.box, start: ev.start, duration: ev.duration });
      // the numbers stand for all notes of that column (two voices are two notes at one x)
      const x = (ev.box[0] + ev.box[2]) / 2;
      covered.push(...events.filter((o) => o.start === ev.start && Math.abs((o.box[0] + o.box[2]) / 2 - x) < 0.5 * ss));
    }
  }
  notes.sort((a, b) => a.start - b.start);
  return { notes, guitarStaves, covered };
}

/** The fret numbers in a piece of text, each with its box ("10" is one, "3 5" two). */
function splitDigits(p: TextPiece): { fret: number; cx: number; cy: number; x0: number; x1: number; y0: number; y1: number; ocr: boolean }[] {
  const out = [];
  const n = p.str.length;
  const box = (i: number) => p.chars?.[i] ?? { x0: p.x0 + ((p.x1 - p.x0) * i) / n, x1: p.x0 + ((p.x1 - p.x0) * (i + 1)) / n };
  let i = 0;
  let inParens = false;
  while (i < n) {
    // a fret in parentheses is held over (tied), not struck again
    if (p.str[i] === '(') inParens = true;
    if (p.str[i] === ')') inParens = false;
    if (!/[0-9]/.test(p.str[i])) { i++; continue; }
    let j = i;
    while (j < n && /[0-9]/.test(p.str[j]) && j - i < 2) j++;
    const fret = Number(p.str.slice(i, j));
    const x0 = box(i).x0;
    const x1 = box(j - 1).x1;
    if (fret <= 24 && !inParens) out.push({ fret, cx: (x0 + x1) / 2, cy: (p.y0 + p.y1) / 2, x0, x1, y0: p.y0, y1: p.y1, ocr: p.ocr === true });
    i = j;
  }
  return out;
}

function nearestEvent(events: EventJ[], x: number, maxDist: number): EventJ | null {
  let best: EventJ | null = null;
  let dist = Infinity;
  for (const e of events) {
    const d = Math.abs((e.box[0] + e.box[2]) / 2 - x);
    if (d < dist) { dist = d; best = e; }
  }
  return dist <= maxDist ? best : null;
}
