// Chord names (as printed above lyrics or notes) and how a guitar plays them.

const LETTERS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11, H: 11 };

export interface Chord {
  name: string;
  /** Pitch class of the root (0 = C). */
  root: number;
  /** Pitch class of the bass note (the root unless written "C/E"). */
  bass: number;
  /** Intervals above the root in semitones, including 0. */
  intervals: number[];
}

// root, accidental, the rest (quality and extensions), optional bass after "/"
const CHORD_RE = /^([A-H])([#♯b♭]?)((?:maj|Maj|M|min|mi|m|dim|°|o|aug|\+|sus|add|ø|Δ|△|[0-9]|[#♯b♭+\-]|\(|\)|,|\/(?![A-H]))*)(?:\/([A-H])([#♯b♭]?))?$/;

function accidental(a: string): number {
  return a === '#' || a === '♯' ? 1 : a === 'b' || a === '♭' ? -1 : 0;
}

/** Reads a chord name; null if the text is no chord name. */
export function parseChord(text: string): Chord | null {
  let t = text.trim();
  // "(Am)": an optional chord
  if (t.startsWith('(') && t.endsWith(')')) t = t.slice(1, -1);
  const m = CHORD_RE.exec(t);
  if (!m) return null;
  const root = (LETTERS[m[1]] + accidental(m[2]) + 12) % 12;
  const rest = m[3];
  const bass = m[4] ? (LETTERS[m[4]] + accidental(m[5] ?? '') + 12) % 12 : root;
  const intervals = qualityIntervals(rest);
  if (!intervals) return null;
  return { name: t, root, bass, intervals };
}

/** The intervals of a chord quality such as "m7", "maj7", "sus4", "7b9", "(2)". */
function qualityIntervals(q: string): number[] | null {
  let s = q.replace(/[()]/g, ' ').replace(/,/g, ' ').trim();
  let third = 4;
  let fifth = 7;
  const add: number[] = [];
  let seventh: number | null = null;
  let noThird = false;
  const take = (re: RegExp) => {
    const m = re.exec(s);
    if (m) s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
    return m;
  };
  if (take(/^(maj|Maj|M|Δ|△)(7|9|11|13)?/)) {
    seventh = 11;
  } else if (take(/^(min|mi|m)(?!aj)/)) {
    third = 3;
    if (take(/^\s*(maj|Maj|M|Δ)7?/)) seventh = 11;
  } else if (take(/^(dim|°|o)/)) {
    third = 3; fifth = 6;
    if (take(/^\s*7/)) seventh = 9;
  } else if (take(/^ø/)) {
    third = 3; fifth = 6; seventh = 10;
  } else if (take(/^(aug|\+)/)) {
    fifth = 8;
  }
  s = s.trim();
  // extensions: 7, 9, 11, 13 (dominant), 6, add9, sus2/sus4, b5/#5, b9/#9, (2)
  let m: RegExpExecArray | null;
  while (s.length > 0) {
    if ((m = /^(7|9|11|13)/.exec(s))) {
      if (seventh === null) seventh = 10;
      const n = Number(m[1]);
      if (n >= 9) add.push(14);
      if (n >= 11) add.push(17);
      if (n >= 13) add.push(21);
    } else if ((m = /^6/.exec(s))) add.push(9);
    else if ((m = /^add\s*(2|4|9|11)/.exec(s))) add.push({ 2: 2, 4: 5, 9: 14, 11: 17 }[m[1] as '2' | '4' | '9' | '11']);
    else if ((m = /^sus\s*(2|4)?/.exec(s))) { noThird = true; add.push(m[1] === '2' ? 2 : 5); }
    else if ((m = /^(#|♯|\+)5/.exec(s))) fifth = 8;
    else if ((m = /^(b|♭|-)5/.exec(s))) fifth = 6;
    else if ((m = /^(b|♭|-)9/.exec(s))) add.push(13);
    else if ((m = /^(#|♯|\+)9/.exec(s))) add.push(15);
    else if ((m = /^(#|♯|\+)11/.exec(s))) add.push(18);
    else if ((m = /^(b|♭|-)13/.exec(s))) add.push(20);
    else if ((m = /^2/.exec(s))) add.push(2);
    else if ((m = /^4/.exec(s))) add.push(5);
    else if ((m = /^(maj|Maj|M|Δ)7/.exec(s))) seventh = 11;
    else if ((m = /^\s+/.exec(s))) { /* space */ }
    else return null;
    s = s.slice(m[0].length);
  }
  const iv = [0, fifth, ...(noThird ? [] : [third]), ...(seventh !== null ? [seventh] : []), ...add];
  return [...new Set(iv.map((i) => i % 12))].sort((a, b) => a - b);
}

export function isChordToken(text: string): boolean {
  return parseChord(text) !== null;
}

/** Open strings of a guitar in standard tuning (MIDI): E2 A2 D3 G3 B3 E4. */
export const STRINGS = [40, 45, 50, 55, 59, 64];

// common shapes (frets from the low E string; -1 = not played) for the usual open chords
const SHAPES: Record<string, number[]> = {
  'C': [-1, 3, 2, 0, 1, 0], 'C7': [-1, 3, 2, 3, 1, 0], 'Cmaj7': [-1, 3, 2, 0, 0, 0], 'Cadd9': [-1, 3, 2, 0, 3, 0],
  'D': [-1, -1, 0, 2, 3, 2], 'Dm': [-1, -1, 0, 2, 3, 1], 'D7': [-1, -1, 0, 2, 1, 2], 'Dm7': [-1, -1, 0, 2, 1, 1],
  'Dmaj7': [-1, -1, 0, 2, 2, 2], 'Dsus4': [-1, -1, 0, 2, 3, 3], 'Dsus2': [-1, -1, 0, 2, 3, 0],
  'E': [0, 2, 2, 1, 0, 0], 'Em': [0, 2, 2, 0, 0, 0], 'E7': [0, 2, 0, 1, 0, 0], 'Em7': [0, 2, 0, 0, 0, 0],
  'Esus4': [0, 2, 2, 2, 0, 0], 'F': [1, 3, 3, 2, 1, 1], 'Fmaj7': [-1, -1, 3, 2, 1, 0],
  'G': [3, 2, 0, 0, 0, 3], 'G7': [3, 2, 0, 0, 0, 1], 'A': [-1, 0, 2, 2, 2, 0], 'Am': [-1, 0, 2, 2, 1, 0],
  'A7': [-1, 0, 2, 0, 2, 0], 'Am7': [-1, 0, 2, 0, 1, 0], 'Asus4': [-1, 0, 2, 2, 3, 0], 'Asus2': [-1, 0, 2, 2, 0, 0],
  'Amaj7': [-1, 0, 2, 1, 2, 0], 'B7': [-1, 2, 1, 2, 0, 2],
};

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function shapeKey(c: Chord): string | null {
  const iv = c.intervals.join(',');
  const kinds: Record<string, string> = {
    '0,4,7': '', '0,3,7': 'm', '0,4,7,10': '7', '0,3,7,10': 'm7', '0,4,7,11': 'maj7',
    '0,5,7': 'sus4', '0,2,7': 'sus2', '0,2,4,7': 'add9',
  };
  const kind = kinds[iv];
  if (kind === undefined || c.bass !== c.root) return null;
  return NAMES[c.root] + kind;
}

/**
 * The notes (MIDI, low to high) a guitarist would play: a common open shape where there is
 * one, otherwise a shape found on the first frets (bass on the lowest suitable string).
 */
export function voicing(c: Chord): number[] {
  const key = shapeKey(c);
  const shape = key ? SHAPES[key] : undefined;
  if (shape) return shape.map((f, s) => (f < 0 ? -1 : STRINGS[s] + f)).filter((p) => p >= 0);
  const pcs = new Set(c.intervals.map((i) => (c.root + i) % 12));
  // look for a playable shape within a span of four frets, starting with the lowest position
  for (let base = 0; base <= 9; base++) {
    const frets: number[] = [];
    let bassString = -1;
    for (let s = 0; s < 6; s++) {
      if (bassString < 0) {
        // the bass on the lowest string that can play it
        const f = [...Array(5).keys()].map((k) => base + k).find((fr) => (STRINGS[s] + fr) % 12 === c.bass);
        if (f !== undefined && s <= 2) { bassString = s; frets.push(f); } else frets.push(-1);
        continue;
      }
      const f = [...Array(5).keys()].map((k) => base + k).find((fr) => pcs.has((STRINGS[s] + fr) % 12));
      frets.push(f ?? -1);
    }
    const played = frets.filter((f) => f >= 0);
    const covered = new Set(frets.map((f, s) => (f < 0 ? -1 : (STRINGS[s] + f) % 12)).filter((p) => p >= 0));
    if (bassString >= 0 && played.length >= 4 && [...pcs].every((p) => covered.has(p) || pcs.size > 4)) {
      return frets.map((f, s) => (f < 0 ? -1 : STRINGS[s] + f)).filter((p) => p >= 0);
    }
  }
  // fallback: close position around C3
  return [48 + c.bass, ...c.intervals.map((i) => 55 + ((c.root + i) % 12))].sort((a, b) => a - b);
}
