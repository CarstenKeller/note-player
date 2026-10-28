import { describe, expect, it } from 'vitest';
import { parseChord, voicing } from '../chords';
import { analyzeSheet, strums } from '../analyze';
import { linesFromPieces, linesFromPlain } from '../text';

const N = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const name = (p: number) => N[p % 12] + (Math.floor(p / 12) - 1);
const plain = (text: string) => linesFromPlain(text, { left: 0, top: 0, charWidth: 10, lineHeight: 20 });

describe('chord names', () => {
  it('reads common names', () => {
    expect(parseChord('C#m7')).toMatchObject({ root: 1, bass: 1, intervals: [0, 3, 7, 10] });
    expect(parseChord('D/F#')).toMatchObject({ root: 2, bass: 6 });
    expect(parseChord('E(2)')?.intervals).toEqual([0, 2, 4, 7]);
    expect(parseChord('Bbmaj7')).toMatchObject({ root: 10, intervals: [0, 4, 7, 11] });
    expect(parseChord('Hm')?.root).toBe(11);
  });
  it('rejects words', () => {
    for (const w of ['the', 'Heute', 'N.C.', 'x2', 'Gitarre']) expect(parseChord(w)).toBeNull();
  });
  it('plays open shapes', () => {
    expect(voicing(parseChord('Am')!).map(name)).toEqual(['A2', 'E3', 'A3', 'C4', 'E4']);
    expect(voicing(parseChord('G')!).map(name)).toEqual(['G2', 'B2', 'D3', 'G3', 'B3', 'G4']);
  });
});

describe('song sheet without notes', () => {
  it('takes lines of chords only, each chord for the given beats', () => {
    const g = analyzeSheet(plain('Am      G\nIch singe am Abend ein Lied\nc   F   G7\nam Morgen geht es weiter'), null, 0, { beatsPerChord: 4 });
    expect(g.chords.map((c) => `${c.chord.name}@${c.start}`)).toEqual(['Am@0', 'G@1920', 'C@3840', 'F@5760', 'G7@7680']);
    expect(g.length).toBe(9600);
  });
  it('reads a small "a" as A minor (German song books)', () => {
    const g = analyzeSheet(plain('C   a   F   G'), null, 0, { beatsPerChord: 2 });
    expect(g.chords.map((c) => c.chord.root + ':' + c.chord.intervals.join(','))).toEqual(['0:0,4,7', '9:0,3,7', '5:0,4,7', '7:0,4,7']);
  });
  it('keeps a lyrics line with "Am" out', () => {
    expect(analyzeSheet(plain('Am Abend singen wir'), null, 0, { beatsPerChord: 4 }).chords).toEqual([]);
  });
});

describe('text tabs', () => {
  it('reads six lines into notes, the most frequent distance as an eighth', () => {
    const tab = 'e|-----0-----0---|\nB|---1---1-----1-|\nG|-2-------2-----|\nD|---------------|\nA|-0-------------|\nE|---------------|';
    const g = analyzeSheet(plain(tab), null, 0, { beatsPerChord: 4 });
    expect(g.tabNotes.map((n) => n.pitches.map(name).join('+') + '@' + n.start + '/' + n.duration).join(' '))
      .toBe('A2+A3@0/240 C4@240/240 E4@480/240 C4@720/240 A3@960/240 E4@1200/240 C4@1440/480');
  });
  it('leaves four-line bass tabs out', () => {
    const tab = 'G|-----|\nD|--2--|\nA|-----|\nE|-0---|';
    expect(analyzeSheet(plain(tab), null, 0, { beatsPerChord: 4 }).tabNotes).toEqual([]);
  });
});

describe('chords above staves', () => {
  // one staff with four quarter notes per measure, chord names above two measures
  const ev = (start: number, x: number) => ({ start, duration: 480, pitches: [64], holds: [], box: [x, 100, x + 10, 110] as [number, number, number, number], staff: 0, system: 0, measure: Math.floor(start / 1920) });
  const score = {
    tpq: 480,
    staves: [{ index: 0, system: 0, box: [0, 100, 1000, 140] as [number, number, number, number], clef: 'TREBLE' as const, key: 0, vocal: false }],
    systems: [{ index: 0, box: [0, 100, 1000, 140] as [number, number, number, number], start: 0, end: 3840 }],
    events: [ev(0, 100), ev(480, 200), ev(960, 300), ev(1440, 400), ev(1920, 520), ev(2400, 620), ev(2880, 720), ev(3360, 820)],
  };
  it('puts a chord on the note below it', () => {
    const lines = linesFromPieces([
      { str: 'C', x0: 101, x1: 111, y0: 60, y1: 80 },
      { str: 'G', x0: 519, x1: 530, y0: 60, y1: 80 },
      { str: '7', x0: 531, x1: 537, y0: 55, y1: 68 }, // raised
    ]);
    const g = analyzeSheet(lines, score, 10, { beatsPerChord: 4 });
    expect(g.chords.map((c) => `${c.chord.name}@${c.start}-${c.end}`)).toEqual(['C@0-1920', 'G7@1920-3840']);
    expect(strums(g.chords[0], 'eighth').map((s) => s.start + (s.strum > 0 ? 'v' : '^')).join(' ')).toBe('0v 240^ 480v 720^ 960v 1200^ 1440v 1680^');
  });
});
