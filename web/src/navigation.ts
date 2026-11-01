// Jumps in a piece besides repeats: D.C. (da capo, from the beginning) and D.S. (dal segno,
// from the sign 𝄋), each "al Fine" (to the end mark "Fine") or "al Coda" (at "To Coda" on to
// the coda 𝄌). The words are read from the text of the sheets, the signs by the recognition.

import type { Box, EventJ, ScoreJ } from './score';
import { tokens, type TextLine } from './guitar/text';
import type { Spot } from './repeats';

export type JumpWord = 'DC' | 'DS' | 'FINE' | 'TOCODA' | 'CODA';

/** A jump word on a sheet: what it says and where it stands (page pixels). */
export interface WordMark { word: JumpWord; al?: 'fine' | 'coda'; box: Box }

const clean = (t: string) => t.toLowerCase().replace(/[^a-zäöü.]/g, '');
const isWord = (w: string | undefined, word: string) => w !== undefined && w.replace(/\.$/, '') === word;

/** The jump words in the text of a sheet. */
export function readJumpWords(lines: TextLine[]): WordMark[] {
  const out: WordMark[] = [];
  for (const l of lines) {
    const ts = tokens(l);
    const w = ts.map((t) => clean(t.text));
    for (let i = 0; i < ts.length; i++) {
      const box = (to: number): Box => [ts[i].x0, Math.min(...ts.slice(i, to + 1).map((t) => t.y0)), ts[to].x1, Math.max(...ts.slice(i, to + 1).map((t) => t.y1))];
      // "al Coda" / "al Fine" after a D.C. or D.S. (within the next words)
      const al = (from: number): { al?: 'fine' | 'coda'; end: number } => {
        for (let k = from; k < Math.min(ts.length, from + 3); k++) {
          if (w[k] === 'al' || w[k] === 'a') {
            if (isWord(w[k + 1], 'coda')) return { al: 'coda', end: k + 1 };
            if (isWord(w[k + 1], 'fine')) return { al: 'fine', end: k + 1 };
          }
        }
        return { end: from - 1 };
      };
      let word: JumpWord | null = null;
      let next = i;
      if (/^d\.?s\.?$/.test(w[i]) || (w[i] === 'dal' && isWord(w[i + 1], 'segno'))) {
        word = 'DS';
        next = w[i] === 'dal' ? i + 1 : i;
      } else if (/^d\.?c\.?$/.test(w[i]) || (w[i] === 'da' && isWord(w[i + 1], 'capo'))) {
        word = 'DC';
        next = w[i] === 'da' ? i + 1 : i;
      } else if (w[i] === 'to' && isWord(w[i + 1], 'coda')) {
        out.push({ word: 'TOCODA', box: box(i + 1) });
        i++;
        continue;
      } else if (isWord(w[i], 'fine') && w[i - 1] !== 'al' && w[i - 1] !== 'a') {
        out.push({ word: 'FINE', box: box(i) });
        continue;
      } else if (isWord(w[i], 'coda') && w[i - 1] !== 'al' && w[i - 1] !== 'a' && w[i - 1] !== 'to') {
        out.push({ word: 'CODA', box: box(i) });
        continue;
      }
      if (word) {
        const a = al(next + 1);
        out.push({ word, al: a.al, box: box(Math.max(next, a.end)) });
        i = Math.max(next, a.end);
      }
    }
  }
  return out;
}

/**
 * Where a word stands in the music of its sheet: the line (the system nearest to it) and the
 * measure. A word that ends something (D.C., D.S., To Coda, Fine) stands at the end of its
 * measure: the measure of the last note before its right end; a coda heading stands at the
 * start: the measure of the first note from its left end on.
 */
export function placeOf(word: WordMark, sheet: number, score: ScoreJ, staffSpace: number): Spot | null {
  if (score.systems.length === 0) return null;
  const cy = (word.box[1] + word.box[3]) / 2;
  const dist = (b: Box) => (cy < b[1] ? b[1] - cy : cy > b[3] ? cy - b[3] : 0);
  // above a line belongs to it (the words above a system), below it only when close
  const system = [...score.systems].sort((a, b) => dist(a.box) - dist(b.box) || (cy < a.box[1] ? -1 : 1))[0];
  const events = score.events.filter((e) => e.system === system.index);
  const mid = (e: EventJ) => (e.box[0] + e.box[2]) / 2;
  if (word.word === 'CODA') {
    const first = events.filter((e) => mid(e) >= word.box[0] - 2 * staffSpace).sort((a, b) => mid(a) - mid(b))[0];
    return { sheet, system: system.index, x: word.box[0], measure: first?.measure ?? 0 };
  }
  const last = events.filter((e) => mid(e) <= word.box[2]).sort((a, b) => mid(b) - mid(a))[0];
  return { sheet, system: system.index, x: word.box[2], measure: last?.measure ?? 0 };
}

/** A jump back (D.C. or D.S.) with what follows it. */
export interface Navigation {
  kind: 'DC' | 'DS';
  /** Where it is written: the jump comes at the end of this measure. */
  at: Spot;
  /** Where it goes: the beginning, or the segno. */
  to: Spot;
  /** "al Fine": the piece ends at the end of this measure (the second time). */
  fine?: Spot;
  /** "al Coda": at the end of this measure (the second time) on to [coda]. */
  toCoda?: Spot;
  coda?: Spot;
}

const before = (a: Spot, b: Spot) => a.sheet - b.sheet || a.system - b.system || a.x - b.x;

/** The D.C./D.S. of a piece, from its words and its segno and coda signs. */
export function navigationOf(words: (WordMark & { spot: Spot })[], signs: { kind: 'segno' | 'coda'; spot: Spot }[]): Navigation[] {
  const out: Navigation[] = [];
  const sorted = [...words].sort((a, b) => before(a.spot, b.spot));
  const segnos = signs.filter((s) => s.kind === 'segno').map((s) => s.spot).sort(before);
  const codas = signs.filter((s) => s.kind === 'coda').map((s) => s.spot).sort(before);
  for (const w of sorted) {
    if (w.word !== 'DC' && w.word !== 'DS') continue;
    const to = w.word === 'DC'
      ? { sheet: 0, system: 0, x: 0, measure: 0 }
      : segnos.filter((s) => before(s, w.spot) < 0).at(-1) ?? segnos[0];
    if (!to) continue;
    const nav: Navigation = { kind: w.word, at: w.spot, to };
    const fine = sorted.find((x) => x.word === 'FINE');
    const toCodaWord = sorted.find((x) => x.word === 'TOCODA' && before(x.spot, w.spot) < 0);
    // the coda: its heading or its sign after the D.C./D.S.; the sign before it marks where
    // to leave (when no "To Coda" is written)
    const codaWord = sorted.find((x) => x.word === 'CODA' && before(x.spot, w.spot) > 0);
    const codaSign = codas.find((s) => before(s, w.spot) > 0);
    const leaveSign = codas.filter((s) => before(s, w.spot) < 0 && before(s, to) > 0).at(-1);
    const wantsCoda = w.al === 'coda' || (!w.al && (toCodaWord || leaveSign));
    if (w.al === 'fine' || (!w.al && fine && !wantsCoda)) {
      if (fine) nav.fine = fine.spot;
    } else if (wantsCoda) {
      const leave = toCodaWord?.spot ?? leaveSign;
      const coda = codaSign ?? codaWord?.spot;
      if (leave && coda) {
        nav.toCoda = leave;
        nav.coda = coda;
      }
    }
    out.push(nav);
  }
  return out;
}
