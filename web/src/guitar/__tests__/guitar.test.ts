import { describe, expect, it } from 'vitest';
import { parseChord, voicing } from '../chords';
import { analyzeSheet, strums } from '../analyze';
import { linesFromPieces, linesFromPlain } from '../text';
import { readTabStaves, readTuning } from '../tabs';
import { STRINGS } from '../chords';

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

describe('tempo marks and capo', () => {
  it('reads a tempo mark without the note symbol (lost in PDFs) and a capo', async () => {
    const { readMarks } = await import('../analyze');
    const m = readMarks(plain(' = 98\nIntro\n*Capo fret 2\nAll chords relative to capo'), null, 0);
    expect(m.tempos).toEqual([{ tick: 0, bpm: 98 }]);
    expect(m.capo).toBe(2);
    expect(readMarks(plain('Kapodaster 3. Bund'), null, 0).capo).toBe(3);
    expect(readMarks(plain('Capo II'), null, 0).capo).toBe(2);
    expect(readMarks(plain('J = 120 Moderately'), null, 0).tempos[0].bpm).toBe(120);
    // a sentence with "=" and numbers is no tempo mark
    expect(readMarks(plain('Track 12 of the album with a total length that is = 120 minutes long'), null, 0).tempos).toEqual([]);
  });
});

describe('tempo map', () => {
  it('converts ticks and seconds with tempo changes', async () => {
    const { TempoMap } = await import('../../score');
    const t = new TempoMap([{ tick: 0, bpm: 60 }, { tick: 960, bpm: 120 }], 480);
    expect(t.seconds(960)).toBeCloseTo(2);
    expect(t.seconds(1920)).toBeCloseTo(3);
    expect(t.tick(3)).toBeCloseTo(1920);
    expect(t.tick(1)).toBeCloseTo(480);
    expect(t.scaled(2).seconds(1920)).toBeCloseTo(1.5);
  });
});

describe('tablature under notes', () => {
  // a staff of notes (staff 1) above a tablature, a vocal staff (0) above that
  const box = (x: number): [number, number, number, number] => [x - 5, 140, x + 5, 160];
  const ev = (staff: number, x: number, start: number, pitches: number[]) =>
    ({ start, duration: 480, pitches, holds: [], box: box(x), staff, system: 0, measure: 0 });
  const staff = (index: number, top: number) => ({ index, system: 0, box: [0, top, 1000, top + 40] as [number, number, number, number], clef: 'TREBLE' as const, key: 0, vocal: index === 0 });
  const score = {
    tpq: 480,
    staves: [staff(0, 0), staff(1, 100)],
    systems: [],
    events: [ev(0, 200, 0, [72]), ev(1, 200, 0, [64]), ev(1, 300, 480, [67, 71])],
  };
  // lines 15 apart from y 200; the box reaches 0.7 spacings beyond the outer lines
  const tab: [number, number, number, number] = [-10, 200 - 10.5, 1010, 275 + 10.5];
  const digit = (str: string, x: number, line: number) => ({ str, x0: x - 3, x1: x + 3, y0: 200 + 15 * line - 5, y1: 200 + 15 * line + 5 });

  it('reads string and fret, with the rhythm of the notes above', () => {
    const r = readTabStaves([digit('2', 200, 3), digit('0', 300, 2), digit('0', 300, 1), digit('(3)', 400, 0)], [tab], score, 10, STRINGS);
    expect(r.guitarStaves).toEqual([1]);
    expect(r.covered.map((e) => e.start)).toEqual([0, 480]);
    // D string fret 2 = E3; G and B string open
    expect(r.notes.map((n) => `${n.pitches.map(name).join('+')}@${n.start}`)).toEqual(['E3@0', 'G3+B3@480']);
  });

  it('takes numbers from text recognition only when they agree with the note above', () => {
    const ocr = (d: ReturnType<typeof digit>) => ({ ...d, ocr: true });
    // E3 above "2" on the D string agrees; "8" for "0" on the G string does not (D#4 is no G)
    const r = readTabStaves([ocr(digit('2', 200, 3)), ocr(digit('8', 300, 2))], [tab], score, 10, STRINGS);
    expect(r.notes.map((n) => n.pitches.map(name).join('+'))).toEqual(['E3']);
    expect(r.covered.map((e) => e.start)).toEqual([0]);
  });

  it('reads the tuning written on the sheet', () => {
    expect(readTuning(plain('Tuning (low to high): C G D G B♭ D'))?.map(name)).toEqual(['C2', 'G2', 'D3', 'G3', 'A#3', 'D4']);
    expect(readTuning(plain('Drop D tuning'))?.map(name)).toEqual(['D2', 'A2', 'D3', 'G3', 'B3', 'E4']);
    expect(readTuning(plain('Moderately'))).toBeNull();
  });
});
